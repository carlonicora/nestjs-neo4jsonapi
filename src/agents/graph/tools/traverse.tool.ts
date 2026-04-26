import { Injectable } from "@nestjs/common";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { ToolFactory, ToolCallRecord, UserContext } from "./tool.factory";
import { buildToolFieldsOutput } from "../services/field-formatting";
import { materialiseBridge } from "../services/materialise-bridge";
import { GraphCatalogService } from "../services/graph.catalog.service";
import { EntityServiceRegistry } from "../../../common/registries/entity.service.registry";

const FilterOpEnum = z.enum(["eq", "ne", "in", "like", "gt", "gte", "lt", "lte", "isNull", "isNotNull"]);

// Schemas accept `any` at the input boundary because small models emit many
// non-canonical shapes for filters and sort — single-object-instead-of-array,
// map-style `{field: "asc"}`, nested arrays. We coerce everything to the
// canonical array of `{field, direction}` / `{field, op, value}` in code.
const inputSchema = z.object({
  fromType: z.string(),
  fromId: z.string(),
  relationship: z.string().describe("Traversal name from the graph map."),
  filters: z.any().optional(),
  sort: z.any().optional(),
  limit: z.number().int().optional(),
});

export interface NormalisedSort {
  field: string;
  direction: "asc" | "desc";
}
export type NormalisedFilterValue = string | number | boolean | string[] | number[];
export interface NormalisedFilter {
  field: string;
  op: z.infer<typeof FilterOpEnum>;
  value?: NormalisedFilterValue;
}

function coerceFilterValue(v: unknown): NormalisedFilterValue | undefined {
  if (v == null) return undefined;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x === "string")) return v as string[];
    if (v.every((x) => typeof x === "number")) return v as number[];
  }
  return undefined;
}

/**
 * Coerce any LLM-emitted sort shape into an array of {field, direction}.
 * Accepts:
 *   [{field:"date", direction:"desc"}]     — canonical
 *   {field:"date", direction:"desc"}       — single object
 *   {date:"desc"}                          — map form
 *   [{date:"desc"}, {name:"asc"}]          — array of maps
 *   "date"                                 — bare field (asc default)
 *   "date desc"                            — bare field with direction
 *   ["date", "name desc"]                  — array of strings
 */
export function coerceSort(raw: unknown): NormalisedSort[] {
  if (raw == null) return [];
  const items = Array.isArray(raw) ? raw : [raw];
  const out: NormalisedSort[] = [];
  for (const item of items) {
    if (typeof item === "string") {
      const [field, dir] = item.trim().split(/\s+/);
      if (field) out.push({ field, direction: dir === "desc" ? "desc" : "asc" });
      continue;
    }
    if (item && typeof item === "object") {
      const rec = item as Record<string, unknown>;
      if (typeof rec.field === "string") {
        const direction = rec.direction === "desc" ? "desc" : "asc";
        out.push({ field: rec.field, direction });
        continue;
      }
      // Map form: { date: "desc" } — one or more entries.
      for (const [k, v] of Object.entries(rec)) {
        out.push({ field: k, direction: v === "desc" ? "desc" : "asc" });
      }
    }
  }
  return out;
}

/**
 * Coerce any LLM-emitted filters shape into an array of {field, op, value}.
 * Accepts the canonical shape or a single object.
 */
export function coerceFilters(raw: unknown): NormalisedFilter[] {
  if (raw == null) return [];
  const items = Array.isArray(raw) ? raw : [raw];
  const out: NormalisedFilter[] = [];
  for (const item of items) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const rec = item as Record<string, unknown>;
      if (typeof rec.field === "string" && typeof rec.op === "string") {
        const opResult = FilterOpEnum.safeParse(rec.op);
        if (opResult.success) {
          out.push({ field: rec.field, op: opResult.data, value: coerceFilterValue(rec.value) });
        }
      }
    }
  }
  return out;
}

const TYPE_TO_OP_ALLOWED: Record<string, Set<string>> = {
  string: new Set(["eq", "ne", "in", "like", "isNull", "isNotNull"]),
  number: new Set(["eq", "ne", "in", "gt", "gte", "lt", "lte", "isNull", "isNotNull"]),
  boolean: new Set(["eq", "ne", "isNull", "isNotNull"]),
  date: new Set(["eq", "ne", "gt", "gte", "lt", "lte", "isNull", "isNotNull"]),
  datetime: new Set(["eq", "ne", "gt", "gte", "lt", "lte", "isNull", "isNotNull"]),
};

@Injectable()
export class TraverseTool {
  constructor(
    private readonly factory: ToolFactory,
    private readonly catalog: GraphCatalogService,
    private readonly registry: EntityServiceRegistry,
  ) {}

  build(ctx: UserContext, recorder: ToolCallRecord[]): DynamicStructuredTool {
    return new DynamicStructuredTool({
      name: "traverse",
      description: "Walks a relationship from a known record to related records, optionally filtered and sorted.",
      schema: inputSchema,
      func: async (input) => JSON.stringify(await this.invoke(input, ctx, recorder)),
    });
  }

  async invoke(input: z.infer<typeof inputSchema>, ctx: UserContext, recorder: ToolCallRecord[]): Promise<unknown> {
    const filters = coerceFilters(input.filters);
    const sort = coerceSort(input.sort);
    const localMaterialised: Array<{ relName: string; count: number }> = [];

    const result = await this.factory.capture(
      { tool: "traverse", input: { ...input, filters, sort } },
      async () => {
        const sourceDescribed = recorder.some(
          (c) => c.tool === "describe_entity" && (c.input as { type?: string }).type === input.fromType,
        );
        const source = this.factory.resolveEntity(input.fromType, ctx);
        if ("error" in source) return source;
        if (!sourceDescribed) {
          return {
            error: `You must call describe_entity({ type: "${input.fromType}" }) before traversing from ${input.fromType}. The schema is included below — either call describe_entity({ type: "${input.fromType}" }) to record the contract and retry this traverse, or proceed using the listed relationships. Never stop on this error.`,
            schema: { fields: source.fields, relationships: source.relationships },
          };
        }

        const rel = source.relationships.find((r) => r.name === input.relationship);
        if (!rel) {
          const relationshipNames = source.relationships.map((r) => r.name).join(", ");
          return {
            error: `Relationship "${input.relationship}" is not available on ${source.type}. Valid relationships on ${source.type}: [${relationshipNames || "none"}].`,
          };
        }

        const target = this.factory.resolveEntity(rel.targetType, ctx);
        if ("error" in target) return target;

        const byName = new Map(target.fields.map((f) => [f.name, f]));
        const validFieldNames = target.fields.map((f) => f.name).join(", ");
        const sortableFieldNames = target.fields
          .filter((f) => f.sortable)
          .map((f) => f.name)
          .join(", ");
        for (const f of filters ?? []) {
          const def = byName.get(f.field);
          if (!def) {
            return {
              error: `Field "${f.field}" is not available on ${target.type}. Valid fields on ${target.type}: [${validFieldNames}].`,
            };
          }
          const allowed = TYPE_TO_OP_ALLOWED[def.type] ?? new Set();
          if (!allowed.has(f.op)) {
            return {
              error: `Operator "${f.op}" is not valid for field "${f.field}" of type ${def.type}. Allowed operators: [${Array.from(allowed).join(", ")}].`,
            };
          }
        }
        for (const s of sort ?? []) {
          const def = byName.get(s.field);
          if (!def || !def.sortable) {
            return {
              error: `Field "${s.field}" is not sortable on ${target.type}. Sortable fields on ${target.type}: [${sortableFieldNames || "none"}].`,
            };
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
          filters,
          orderByFields: sort,
          limit,
        });

        const baseItems = records.map((r) => ({
          id: r.id,
          type: target.type,
          summary: target.summary ? target.summary(r) : String(r.name ?? r.id),
          fields: buildToolFieldsOutput(target.fields, r),
        }));

        if (!target.bridge) {
          return { items: baseItems };
        }

        // Bridge fanout: each item gets its `materialiseTo` relationships inlined.
        const items = await Promise.all(
          baseItems.map((item) =>
            materialiseBridge({
              bridge: target,
              record: { id: item.id, fields: item.fields },
              ctx,
              deps: { catalog: this.catalog, registry: this.registry },
              onMaterialised: (relName, count) => localMaterialised.push({ relName, count }),
            }),
          ),
        );
        return { items };
      },
      recorder,
    );

    if (localMaterialised.length && recorder.length) {
      recorder[recorder.length - 1].materialised = localMaterialised;
    }
    return result;
  }
}
