import { Injectable } from "@nestjs/common";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { ToolFactory, ToolCallRecord, UserContext } from "./tool.factory";
import { CatalogEntity, CatalogField } from "../interfaces/graph.catalog.interface";
import { GraphSearchService } from "../services/graph.search.service";
import { GraphCatalogService } from "../services/graph.catalog.service";
import { ToolFieldFormatterService } from "../services/field-formatting";
import { materialiseBridge } from "../services/materialise-bridge";
import { EntityServiceRegistry } from "../../../common/registries/entity.service.registry";
import { ScopeGuard } from "../services/scope.guard";
import {
  coerceFilters,
  coerceSort,
  filterOperatorError,
  MAX_LIST_LIMIT,
  NormalisedFilter,
  NormalisedSort,
  serviceFilterCapabilities,
  truncationNote,
} from "./traverse.tool";

/** What a search_entities call actually ran: the coerced filters and sort and the clamped limit. */
export interface SearchEntitiesApplied {
  filters: NormalisedFilter[];
  sort: NormalisedSort[];
  limit: number;
}

const inputSchema = z
  .object({
    type: z.string().describe("Entity type name."),
    filters: z.any().optional(),
    sort: z.any().optional(),
    limit: z.number().int().optional(),
  })
  .strict();

export { inputSchema as searchEntitiesInputSchema };

@Injectable()
export class SearchEntitiesTool {
  constructor(
    private readonly factory: ToolFactory,
    // Injected for DI compatibility with GraphModule; no longer used at runtime
    // now that name resolution lives in resolve_entity.
    private readonly _search: GraphSearchService,
    private readonly catalog: GraphCatalogService,
    private readonly registry: EntityServiceRegistry,
    private readonly scopeGuard: ScopeGuard,
    // ToolFieldFormatterService is deliberately the LAST constructor parameter
    // so existing positional call sites keep working.
    private readonly formatter: ToolFieldFormatterService,
  ) {}

  build(ctx: UserContext, recorder: ToolCallRecord[]): DynamicStructuredTool {
    return new DynamicStructuredTool({
      name: "search_entities",
      description:
        "Find records of a known type by filter and sort. Use this when you already have the type (from resolve_entity or because the user referred to a kind of record without identifying a specific one). To look up a specific record by its label, call resolve_entity first.",
      schema: inputSchema,
      func: async (input) => JSON.stringify(await this.invoke(input, ctx, recorder)),
    });
  }

  async invoke(input: z.infer<typeof inputSchema>, ctx: UserContext, recorder: ToolCallRecord[]): Promise<unknown> {
    const coerced = coerceFilters(input.filters);
    const filters = "error" in coerced ? [] : coerced.filters;
    const coercedSort = coerceSort(input.sort);
    const sort = "error" in coercedSort ? [] : coercedSort.sort;
    const localMaterialised: Array<{ relName: string; count: number }> = [];

    const result = await this.factory.capture(
      {
        tool: "search_entities",
        input: {
          ...input,
          filters: "error" in coerced ? input.filters : filters,
          sort: "error" in coercedSort ? input.sort : sort,
        },
      },
      async () => {
        if ("error" in coerced) return { error: coerced.error };
        if ("error" in coercedSort) return { error: coercedSort.error };
        const described = recorder.some(
          (c) => c.tool === "describe_entity" && (c.input as { type?: string }).type === input.type,
        );
        const entity = this.factory.resolveEntity(input.type, ctx);
        if ("error" in entity) return entity;
        if (!described) {
          return {
            error: `You must call describe_entity({ type: "${input.type}" }) before searching ${input.type}. The schema is included below — either call describe_entity({ type: "${input.type}" }) to record the contract and retry this search, or proceed using the listed fields and relationships. Never stop on this error.`,
            schema: { fields: entity.fields, relationships: entity.relationships },
          };
        }

        // Resolved before validation: a service that declares filter
        // capabilities decides which operators run (capabilities win).
        const svc = this.factory.resolveService(entity.type);
        const capabilities = serviceFilterCapabilities(svc);

        const byName = new Map<string, CatalogField>(entity.fields.map((f) => [f.name, f]));
        const validFieldNames = entity.fields.map((f) => f.name).join(", ");
        const relationshipNames = entity.relationships.map((r) => r.name).join(", ");
        for (const f of filters) {
          const def = byName.get(f.field);
          if (!def) {
            return {
              error: `Field "${f.field}" is not available on ${entity.type}. Valid fields for filter/sort on ${entity.type}: [${validFieldNames}]. To reach records connected via a relationship, use the traverse tool — relationships on ${entity.type}: [${relationshipNames || "none"}]. Dotted paths like "account.name" are never valid here.`,
            };
          }
          const opError = filterOperatorError({ field: def, op: f.op, entityType: entity.type, capabilities });
          if (opError) return { error: opError };
        }
        const sortableFieldNames = entity.fields
          .filter((f) => f.sortable)
          .map((f) => f.name)
          .join(", ");
        for (const s of sort ?? []) {
          const def = byName.get(s.field);
          if (!def || !def.sortable) {
            return {
              error: `Field "${s.field}" is not available for sort on ${entity.type}. Sortable fields on ${entity.type}: [${sortableFieldNames || "none"}].`,
            };
          }
        }

        if (!svc) return { error: `Service not available for "${entity.type}".` };

        const limit = Math.min(Math.max(input.limit ?? 10, 1), MAX_LIST_LIMIT);

        // An inline hop is not a descriptor relationship, so it cannot be read
        // through the repository: it takes the ScopeGuard.filter path below.
        const scopeRelKey =
          entity.scope?.path.length === 1 && !entity.scope.path[0].inline ? entity.scope.path[0].key : undefined;
        const useScopedRead = !!ctx.scopeId && entity.scope?.rootType === ctx.scopeType;

        // A 1-hop scope is expressible as a relationship read, which reuses the
        // entity's own repository (and therefore its ownership rules). Deeper
        // chains fall back to an unrestricted read plus a ScopeGuard filter.
        // Probe one extra record so truncation is visible to the model:
        // without this, a silently clipped list is reported as complete.
        // The scoped relationship read never sets ToolCallRecord.walkedEdge:
        // it runs on every scoped search, so counting it would silence the
        // graph node's traversal detector.
        const fetched =
          useScopedRead && scopeRelKey
            ? await svc.findRelatedRecords({
                relationship: scopeRelKey,
                id: ctx.scopeId!,
                filters,
                orderByFields: sort,
                limit: limit + 1,
              })
            : await this.filterInScope(
                entity.type,
                await svc.findRecords({
                  filters,
                  orderByFields: sort,
                  limit: limit + 1,
                }),
                ctx,
              );
        const hasMore = fetched.length > limit;
        const records = hasMore ? fetched.slice(0, limit) : fetched;

        const applied: SearchEntitiesApplied = { filters, sort, limit };
        const output = await this.buildOutput(entity, records, ctx, localMaterialised, applied);
        return hasMore
          ? {
              ...output,
              hasMore: true,
              note: truncationNote(limit),
            }
          : output;
      },
      recorder,
    );

    if (localMaterialised.length && recorder.length) {
      recorder[recorder.length - 1].materialised = localMaterialised;
    }
    return result;
  }

  /**
   * Drop records outside the run's scope. An unscoped run short-circuits
   * before the guard is consulted — the same contract ScopeGuard.filter
   * applies internally, restated here so an unscoped run never depends on it.
   */
  private async filterInScope(type: string, records: any[], ctx: UserContext): Promise<any[]> {
    if (!ctx.scopeId || !ctx.scopeType) return records;
    return this.scopeGuard.filter({ type, records, ctx });
  }

  private async buildOutput(
    entity: CatalogEntity,
    records: any[],
    ctx: UserContext,
    localMaterialised: Array<{ relName: string; count: number }>,
    applied: SearchEntitiesApplied,
  ) {
    const baseItems = records.map((r) => {
      const { fields, availableOnRead, generated } = this.formatter.build({ entity, record: r, stage: "list" });
      return {
        id: r.id,
        type: entity.type,
        summary: entity.summary ? entity.summary(r) : String(r.name ?? r.id),
        fields,
        ...(availableOnRead ? { availableOnRead } : {}),
        ...(generated ? { generated } : {}),
        score: null as number | null,
      };
    });

    if (!entity.bridge) return { applied, items: baseItems };

    // Bridge fanout: each item is materialised. The `score` field is preserved
    // on the envelope so the search_entities response shape doesn't drift.
    const items = await Promise.all(
      baseItems.map(({ score, ...item }) =>
        materialiseBridge({
          bridge: entity,
          record: { id: item.id, fields: item.fields },
          ctx,
          deps: {
            catalog: this.catalog,
            registry: this.registry,
            scopeGuard: this.scopeGuard,
            formatter: this.formatter,
          },
          onMaterialised: (relName, count) => localMaterialised.push({ relName, count }),
        }).then((m) => ({ ...m, ...(item.generated ? { generated: item.generated } : {}), score })),
      ),
    );
    return { applied, items };
  }
}
