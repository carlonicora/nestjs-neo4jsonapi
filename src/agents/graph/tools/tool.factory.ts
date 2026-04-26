import { Injectable, Logger } from "@nestjs/common";
import { GraphCatalogService } from "../services/graph.catalog.service";
import { EntityServiceRegistry } from "../../../common/registries/entity.service.registry";
import { CatalogEntity } from "../interfaces/graph.catalog.interface";

export interface UserContext {
  companyId: string;
  userId: string;
  userModuleIds: string[];
}

export interface ToolCallRecord {
  tool: string;
  input: Record<string, unknown>;
  durationMs: number;
  error?: string;
  /** When set, the tool result included one or more bridge fanouts. */
  materialised?: Array<{ relName: string; count: number }>;
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
      this.logger.log(`tool.factory: unknownType="${type}" suggested="${suggestion}"`);
      return {
        error: `Entity type "${type}" is not available. Did you mean "${suggestion}"?`,
        suggestion,
      };
    }

    this.logger.log(
      `tool.factory: unknownType="${type}" no suggestion. accessibleTypes=${JSON.stringify(accessible)}`,
    );

    return {
      error: accessible.length
        ? `Entity type "${type}" is not available. Available types include: ${accessible.slice(0, 5).join(", ")}.`
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
        recorder.push({
          tool: record.tool,
          input: record.input,
          durationMs,
          ...(resultError ? { error: resultError } : {}),
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
        this.logger.warn(`tool-call FAILED: ${record.tool} in ${durationMs}ms message=${err.message}`);
        throw err;
      },
    );
  }
}
