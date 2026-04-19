import { Injectable } from "@nestjs/common";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { ToolFactory, ToolCallRecord, UserContext } from "./tool.factory";
import { CatalogField } from "../interfaces/graph.catalog.interface";
import { ChatbotSearchService } from "../services/chatbot.search.service";

const FilterOpEnum = z.enum(["eq", "ne", "in", "like", "gt", "gte", "lt", "lte", "isNull", "isNotNull"]);

const inputSchema = z.object({
  type: z.string().describe("Entity type name."),
  text: z.string().optional().describe("Fuzzy match on the entity's configured text search fields."),
  filters: z
    .array(
      z.object({
        field: z.string(),
        op: FilterOpEnum,
        value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.array(z.number())]).optional(),
      }),
    )
    .optional(),
  sort: z.array(z.object({ field: z.string(), direction: z.enum(["asc", "desc"]) })).optional(),
  limit: z.number().int().optional(),
});

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
    private readonly search: ChatbotSearchService,
  ) {}

  build(ctx: UserContext, recorder: ToolCallRecord[]): DynamicStructuredTool {
    return new DynamicStructuredTool({
      name: "search_entities",
      description: "Finds records of a given type, optionally filtered, sorted, and fuzzy-searched.",
      schema: inputSchema,
      func: async (input) => JSON.stringify(await this.invoke(input, ctx, recorder)),
    });
  }

  async invoke(input: z.infer<typeof inputSchema>, ctx: UserContext, recorder: ToolCallRecord[]): Promise<unknown> {
    return this.factory.capture(
      { tool: "search_entities", input },
      async () => {
        const entity = this.factory.resolveEntity(input.type, ctx);
        if ("error" in entity) return entity;

        const byName = new Map<string, CatalogField>(entity.fields.map((f) => [f.name, f]));
        const filters = input.filters ?? [];
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
        const sortableFieldNames = entity.fields.filter((f) => f.sortable).map((f) => f.name).join(", ");
        for (const s of input.sort ?? []) {
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

        // Filter-only path — no text cascade
        if (!input.text) {
          const records = await svc.findRecords({
            filters,
            orderByFields: input.sort,
            limit,
          });
          return this.buildOutput(entity, records, "none", new Map<string, number>());
        }

        // Text path — cascading search
        const cascade = await this.search.runCascadingSearch({
          entity,
          text: input.text,
          companyId: ctx.companyId,
          limit,
        });

        if (!cascade.items.length) {
          return { matchMode: cascade.matchMode, items: [] };
        }

        const ids = cascade.items.map((i) => i.id);
        const records = await svc.findRecords({
          filters: [...filters, { field: "id", op: "in", value: ids }],
          orderByFields: input.sort,
          limit,
        });

        const scoreById = new Map<string, number>();
        for (const i of cascade.items) {
          if (i.score != null) scoreById.set(i.id, i.score);
        }

        return this.buildOutput(entity, records, cascade.matchMode, scoreById);
      },
      recorder,
    );
  }

  private buildOutput(entity: any, records: any[], matchMode: string, scoreById: Map<string, number>) {
    const items = records.map((r) => ({
      id: r.id,
      type: entity.type,
      summary: entity.summary ? entity.summary(r) : String(r.name ?? r.id),
      fields: Object.fromEntries(entity.fields.map((f: any) => [f.name, r[f.name]])),
      score: scoreById.has(r.id) ? scoreById.get(r.id)! : null,
    }));
    return { matchMode, items };
  }
}
