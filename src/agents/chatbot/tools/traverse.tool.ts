import { Injectable } from "@nestjs/common";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { ToolFactory, ToolCallRecord, UserContext } from "./tool.factory";

const FilterOpEnum = z.enum(["eq", "ne", "in", "like", "gt", "gte", "lt", "lte", "isNull", "isNotNull"]);

const inputSchema = z.object({
  fromType: z.string(),
  fromId: z.string(),
  relationship: z.string().describe("Traversal name from the graph map."),
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
export class TraverseTool {
  constructor(private readonly factory: ToolFactory) {}

  build(ctx: UserContext, recorder: ToolCallRecord[]): DynamicStructuredTool {
    return new DynamicStructuredTool({
      name: "traverse",
      description: "Walks a relationship from a known record to related records, optionally filtered and sorted.",
      schema: inputSchema,
      func: async (input) => JSON.stringify(await this.invoke(input, ctx, recorder)),
    });
  }

  async invoke(input: z.infer<typeof inputSchema>, ctx: UserContext, recorder: ToolCallRecord[]): Promise<unknown> {
    return this.factory.capture(
      { tool: "traverse", input },
      async () => {
        const source = this.factory.resolveEntity(input.fromType, ctx);
        if ("error" in source) return source;

        const rel = source.relationships.find((r) => r.name === input.relationship);
        if (!rel) {
          return { error: `Relationship "${input.relationship}" is not available on ${source.type}.` };
        }

        const target = this.factory.resolveEntity(rel.targetType, ctx);
        if ("error" in target) return target;

        const byName = new Map(target.fields.map((f) => [f.name, f]));
        for (const f of input.filters ?? []) {
          const def = byName.get(f.field);
          if (!def) return { error: `Field "${f.field}" is not available on ${target.type}.` };
          const allowed = TYPE_TO_OP_ALLOWED[def.type] ?? new Set();
          if (!allowed.has(f.op)) {
            return {
              error: `Operator "${f.op}" is not valid for field "${f.field}" of type ${def.type}.`,
            };
          }
        }
        for (const s of input.sort ?? []) {
          const def = byName.get(s.field);
          if (!def || !def.sortable) {
            return { error: `Field "${s.field}" is not sortable on ${target.type}.` };
          }
        }

        const targetSvc = this.factory.resolveService(target.type);
        if (!targetSvc) return { error: `Service not available for "${target.type}".` };

        const limit = Math.min(Math.max(input.limit ?? 10, 1), 50);
        // Walk via the catalog's raw edge spec so the traversal works even
        // when the target's own descriptor does not declare the relationship
        // (e.g. a reverse-only materialisation). Direction is inverted
        // because catalog.cypherDirection is from the source's perspective,
        // but findRelatedRecordsByEdge expects it from the target's (this-node)
        // perspective.
        const targetDirection: "in" | "out" = rel.cypherDirection === "out" ? "in" : "out";
        const records: any[] = await targetSvc.findRelatedRecordsByEdge({
          cypherLabel: rel.cypherLabel,
          cypherDirection: targetDirection,
          relatedLabel: source.labelName,
          relatedId: input.fromId,
          filters: input.filters,
          orderByFields: input.sort,
          limit,
        });

        return {
          items: records.map((r) => ({
            id: r.id,
            type: target.type,
            summary: target.summary ? target.summary(r) : String(r.name ?? r.id),
            fields: Object.fromEntries(target.fields.map((f) => [f.name, r[f.name]])),
          })),
        };
      },
      recorder,
    );
  }
}
