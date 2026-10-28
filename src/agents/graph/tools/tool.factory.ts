import { Injectable, Logger } from "@nestjs/common";
import { GraphCatalogService } from "../services/graph.catalog.service";
import { EntityServiceRegistry } from "../../../common/registries/entity.service.registry";
import {
  externalSourceUnavailableResult,
  isExternalSourceUnavailableError,
} from "../../../common/interfaces/external.entity.source.interface";
import { CatalogEntity } from "../interfaces/graph.catalog.interface";

export interface UserContext {
  companyId: string;
  userId: string;
  userModuleIds: string[];
  /** Id of the scope-root node the whole run is confined to. Absent = unscoped. */
  scopeId?: string;
  /** JSON:API type of the scope root, e.g. "campaigns". Present iff scopeId is. */
  scopeType?: string;
  /**
   * Neo4j label of the scope root, e.g. "Campaign". Carried alongside
   * `scopeType` (the catalog resolves both at build time) so cost attribution
   * does not have to re-derive it through the model registry.
   */
  scopeLabel?: string;
}

/**
 * A record a successful tool call returned, as the tool returned it. "detail"
 * is a single top-level record (read_entity); "list" is one of an items array
 * (search_entities, traverse, bridge envelopes alike).
 */
export interface RecordedEntity {
  type: string;
  id: string;
  fields: Record<string, unknown>;
  stage: "list" | "detail";
}

export interface ToolCallRecord {
  tool: string;
  input: Record<string, unknown>;
  durationMs: number;
  error?: string;
  /** When set, the tool result included one or more bridge fanouts. */
  materialised?: Array<{ relName: string; count: number }>;
  /**
   * True when the call walked a relationship and got linked records back:
   * set by read_entity when its include returned at least one record across
   * all relationships. traverse counts by tool name; search_entities never
   * sets it. Read by the graph node's traversal detector.
   */
  walkedEdge?: boolean;
  /**
   * Records the call returned, harvested by capture() from a successful
   * result. The graph node fills its output entities' fields from these, so
   * field values are the tool's own, never the model's copy.
   */
  entities?: RecordedEntity[];
}

function asRecordedEntity(value: unknown, stage: RecordedEntity["stage"]): RecordedEntity | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || typeof v.type !== "string") return null;
  if (!v.fields || typeof v.fields !== "object" || Array.isArray(v.fields)) return null;
  return { type: v.type, id: v.id, fields: v.fields as Record<string, unknown>, stage };
}

/** Top-level { id, type, fields } → one detail entity; items[] → list entities. */
function recordedEntitiesOf(result: unknown): RecordedEntity[] {
  if (!result || typeof result !== "object") return [];
  const out: RecordedEntity[] = [];
  const detail = asRecordedEntity(result, "detail");
  if (detail) out.push(detail);
  const items = (result as Record<string, unknown>).items;
  if (Array.isArray(items)) {
    for (const item of items) {
      const listed = asRecordedEntity(item, "list");
      if (listed) out.push(listed);
    }
  }
  return out;
}

function normaliseTypeName(input: string): string {
  // Strip a trailing "es" or "s" so "boms" / "bom" / "bomes" all collapse to "bom".
  return input.replace(/(es|s)$/i, "").toLowerCase();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev: number[] = new Array(n + 1);
  const curr: number[] = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

@Injectable()
export class ToolFactory {
  private readonly logger = new Logger(ToolFactory.name);

  constructor(
    private readonly catalog: GraphCatalogService,
    private readonly registry: EntityServiceRegistry,
  ) {}

  resolveEntity(type: string, ctx: UserContext): CatalogEntity | { error: string; suggestion?: string } {
    const detail = this.catalog.getEntityDetail(type, ctx.userModuleIds);
    if (detail) return detail;

    const accessible = this.catalog.getAccessibleTypes(ctx.userModuleIds);
    const suggestion = this.findClosest(type, accessible);

    if (suggestion) {
      // Trivial variants (case, punctuation, singular/plural-s, one-char typo)
      // are resolved transparently — small models reliably relay even
      // imperative "retry" errors to the user instead of retrying, so the
      // correction must be deterministic, not prompted.
      const trivial = levenshtein(normaliseTypeName(type), normaliseTypeName(suggestion)) <= 1;
      if (trivial) {
        const corrected = this.catalog.getEntityDetail(suggestion, ctx.userModuleIds);
        if (corrected) {
          this.logger.log(`tool.factory: auto-corrected entity type "${type}" -> "${suggestion}"`);
          return corrected;
        }
      }

      this.logger.log(`tool.factory: unknownType="${type}" suggested="${suggestion}"`);
      return {
        // Imperative phrasing: question-shaped errors ("Did you mean…?") get
        // relayed verbatim to the user by smaller models instead of retried.
        error: `Entity type "${type}" is not available. Retry this call now with type "${suggestion}".`,
        suggestion,
      };
    }

    this.logger.log(`tool.factory: unknownType="${type}" no suggestion. accessibleTypes=${JSON.stringify(accessible)}`);

    return {
      error: accessible.length
        ? `Entity type "${type}" is not available. The available types are: ${accessible.join(", ")}.`
        : `Entity type "${type}" is not available.`,
    };
  }

  private findClosest(input: string, candidates: string[]): string | null {
    if (!candidates.length) return null;
    const normInput = normaliseTypeName(input);
    let best: { type: string; distance: number } | null = null;
    for (const c of candidates) {
      const d = levenshtein(normInput, normaliseTypeName(c));
      if (best === null || d < best.distance) best = { type: c, distance: d };
    }
    return best && best.distance <= 2 ? best.type : null;
  }

  resolveService(type: string) {
    return this.registry.get(type);
  }

  /**
   * Runs one tool call and records it. An ExternalSourceUnavailableError (an
   * external source that did not answer) resolves to the value
   * `{ error, code, retryable: true }` instead of rejecting, so the operator
   * keeps running and the caller is told the source is down, never that the
   * record does not exist. Every other rejection is rethrown.
   */
  capture<T>(
    record: { tool: string; input: Record<string, unknown> },
    fn: () => Promise<T>,
    recorder: ToolCallRecord[],
  ): Promise<T> {
    const start = Date.now();
    this.logger.log(`tool-call START: ${record.tool} input=${JSON.stringify(record.input)}`);
    return fn().then(
      (result) => {
        const durationMs = Date.now() - start;
        const resultError =
          result && typeof result === "object" && "error" in (result as any)
            ? String((result as any).error)
            : undefined;
        const entities = resultError ? [] : recordedEntitiesOf(result);
        recorder.push({
          tool: record.tool,
          input: record.input,
          durationMs,
          ...(resultError ? { error: resultError } : {}),
          ...(entities.length ? { entities } : {}),
        });
        const hint =
          result && typeof result === "object" && "items" in (result as any) && Array.isArray((result as any).items)
            ? `items=${(result as any).items.length}`
            : resultError
              ? `error=${resultError}`
              : "ok";
        this.logger.log(`tool-call END: ${record.tool} in ${durationMs}ms ${hint}`);
        return result;
      },
      (err) => {
        const durationMs = Date.now() - start;
        recorder.push({
          tool: record.tool,
          input: record.input,
          durationMs,
          error: err.message,
        });
        if (isExternalSourceUnavailableError(err)) {
          this.logger.warn(
            `tool-call END: ${record.tool} in ${durationMs}ms ${err.code}: ${err.cause instanceof Error ? err.cause.message : String(err.cause ?? err.message)}`,
          );
          return externalSourceUnavailableResult(err) as T;
        }
        this.logger.warn(`tool-call FAILED: ${record.tool} in ${durationMs}ms message=${err.message}`);
        throw err;
      },
    );
  }
}
