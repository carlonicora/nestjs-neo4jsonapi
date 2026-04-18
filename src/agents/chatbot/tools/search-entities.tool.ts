import { Injectable } from "@nestjs/common";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { ToolFactory, ToolCallRecord, UserContext } from "./tool.factory";
import { CatalogField } from "../interfaces/graph.catalog.interface";

const FilterOpEnum = z.enum([
  "eq", "ne", "in", "like", "gt", "gte", "lt", "lte", "isNull", "isNotNull",
]);

const inputSchema = z.object({
  type: z.string().describe("Entity type name."),
  text: z.string().optional().describe("Fuzzy match on the entity's configured text search fields."),
  filters: z
    .array(
      z.object({
        field: z.string(),
        op: FilterOpEnum,
        value: z
          .union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.array(z.number())])
          .optional(),
      }),
    )
    .optional(),
  sort: z
    .array(
      z.object({
        field: z.string(),
        direction: z.enum(["asc", "desc"]),
      }),
    )
    .optional(),
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
  constructor(private readonly factory: ToolFactory) {}

  build(ctx: UserContext, recorder: ToolCallRecord[]): DynamicStructuredTool {
    return new DynamicStructuredTool({
      name: "search_entities",
      description: "Finds records of a given type, optionally filtered, sorted, and fuzzy-searched.",
      schema: inputSchema,
      func: async (input) => JSON.stringify(await this.invoke(input, ctx, recorder)),
    });
  }

  async invoke(
    input: z.infer<typeof inputSchema>,
    ctx: UserContext,
    recorder: ToolCallRecord[],
  ): Promise<unknown> {
    return this.factory.capture({ tool: "search_entities", input }, async () => {
      const entity = this.factory.resolveEntity(input.type, ctx);
      if ("error" in entity) return entity;

      const byName = new Map<string, CatalogField>(entity.fields.map((f) => [f.name, f]));
      const filters = input.filters ?? [];
      for (const f of filters) {
        const def = byName.get(f.field);
        if (!def) return { error: `Field "${f.field}" is not available on ${entity.type}.` };
        const allowed = TYPE_TO_OP_ALLOWED[def.type] ?? new Set();
        if (!allowed.has(f.op)) {
          return {
            error: `Operator "${f.op}" is not valid for field "${f.field}" of type ${def.type}.`,
          };
        }
      }
      for (const s of input.sort ?? []) {
        const def = byName.get(s.field);
        if (!def || !def.sortable) return { error: `Field "${s.field}" is not available for sort.` };
      }

      const textFilters: typeof filters = [];
      if (input.text) {
        if (!entity.textSearchFields?.length) {
          return { error: `Text search is not configured for "${entity.type}".` };
        }
        for (const field of entity.textSearchFields) {
          if (!byName.has(field)) continue;
          textFilters.push({ field, op: "like", value: input.text });
        }
      }

      const svc = this.factory.resolveService(entity.type);
      if (!svc) return { error: `Service not available for "${entity.type}".` };

      const limit = Math.min(Math.max(input.limit ?? 10, 1), 50);
      const records = await svc.findRecords({
        filters: [...filters, ...textFilters],
        orderByFields: input.sort,
        limit,
      });

      return {
        items: records.map((r: any) => ({
          id: r.id,
          type: entity.type,
          summary: entity.summary ? entity.summary(r) : String(r.name ?? r.id),
          fields: Object.fromEntries(entity.fields.map((f) => [f.name, r[f.name]])),
        })),
      };
    }, recorder);
  }
}
