import { Injectable } from "@nestjs/common";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { ToolFactory, ToolCallRecord, UserContext } from "./tool.factory";
import { CatalogEntity, CatalogField } from "../interfaces/graph.catalog.interface";
import { GraphSearchService } from "../services/graph.search.service";
import { GraphCatalogService } from "../services/graph.catalog.service";
import { buildToolFieldsOutput } from "../services/field-formatting";
import { materialiseBridge } from "../services/materialise-bridge";
import { EntityServiceRegistry } from "../../../common/registries/entity.service.registry";
import { coerceFilters, coerceSort } from "./traverse.tool";

const inputSchema = z
  .object({
    type: z.string().describe("Entity type name."),
    filters: z.any().optional(),
    sort: z.any().optional(),
    limit: z.number().int().optional(),
  })
  .strict();

const TYPE_TO_OP_ALLOWED: Record<string, Set<string>> = {
  string: new Set(["eq", "ne", "in", "like", "isNull", "isNotNull"]),
  number: new Set(["eq", "ne", "in", "gt", "gte", "lt", "lte", "isNull", "isNotNull"]),
  boolean: new Set(["eq", "ne", "isNull", "isNotNull"]),
  date: new Set(["eq", "ne", "gt", "gte", "lt", "lte", "isNull", "isNotNull"]),
  datetime: new Set(["eq", "ne", "gt", "gte", "lt", "lte", "isNull", "isNotNull"]),
};

@Injectable()
export class SearchEntitiesTool {
  constructor(
    private readonly factory: ToolFactory,
    // Injected for DI compatibility with GraphModule; no longer used at runtime
    // now that name resolution lives in resolve_entity.
    private readonly _search: GraphSearchService,
    private readonly catalog: GraphCatalogService,
    private readonly registry: EntityServiceRegistry,
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
    const filters = coerceFilters(input.filters);
    const sort = coerceSort(input.sort);
    const localMaterialised: Array<{ relName: string; count: number }> = [];

    const result = await this.factory.capture(
      { tool: "search_entities", input: { ...input, filters, sort } },
      async () => {
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
          const allowed = TYPE_TO_OP_ALLOWED[def.type] ?? new Set();
          if (!allowed.has(f.op)) {
            return {
              error: `Operator "${f.op}" is not valid for field "${f.field}" of type ${def.type}. Allowed operators: [${Array.from(allowed).join(", ")}].`,
            };
          }
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

        const svc = this.factory.resolveService(entity.type);
        if (!svc) return { error: `Service not available for "${entity.type}".` };

        const limit = Math.min(Math.max(input.limit ?? 10, 1), 50);

        const records = await svc.findRecords({
          filters,
          orderByFields: sort,
          limit,
        });

        return await this.buildOutput(entity, records, ctx, localMaterialised);
      },
      recorder,
    );

    if (localMaterialised.length && recorder.length) {
      recorder[recorder.length - 1].materialised = localMaterialised;
    }
    return result;
  }

  private async buildOutput(
    entity: CatalogEntity,
    records: any[],
    ctx: UserContext,
    localMaterialised: Array<{ relName: string; count: number }>,
  ) {
    const baseItems = records.map((r) => ({
      id: r.id,
      type: entity.type,
      summary: entity.summary ? entity.summary(r) : String(r.name ?? r.id),
      fields: buildToolFieldsOutput(entity.fields, r),
      score: null as number | null,
    }));

    if (!entity.bridge) return { matchMode: "none", items: baseItems };

    // Bridge fanout: each item is materialised. The `score` field is preserved
    // on the envelope so the search_entities response shape doesn't drift.
    const items = await Promise.all(
      baseItems.map(({ score, ...item }) =>
        materialiseBridge({
          bridge: entity,
          record: { id: item.id, fields: item.fields },
          ctx,
          deps: { catalog: this.catalog, registry: this.registry },
          onMaterialised: (relName, count) => localMaterialised.push({ relName, count }),
        }).then((m) => ({ ...m, score })),
      ),
    );
    return { matchMode: "none", items };
  }
}
