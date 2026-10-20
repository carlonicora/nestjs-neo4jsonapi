import { Injectable } from "@nestjs/common";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { isFieldWritable, isRelationshipWritable } from "../services/writable.rules";
import { ToolFactory, ToolCallRecord, UserContext } from "./tool.factory";
import { allowedFilterOperators, serviceFilterCapabilities } from "./traverse.tool";
import type { CatalogField } from "../interfaces/graph.catalog.interface";
import type { ExternalFilterCapability } from "../../../common/interfaces/external.entity.source.interface";

const inputSchema = z.object({
  type: z.string().describe("Entity type name from the graph map."),
});

export { inputSchema as describeEntityInputSchema };

/**
 * The filter operators a field accepts. When the service declares capabilities
 * they win: exactly the operators listed for the field (none when it is not
 * listed). Otherwise those of its type, and none for a non-filterable field.
 */
function filterOperators(field: CatalogField, capabilities: ExternalFilterCapability[] | undefined): string[] {
  if (!capabilities && !field.filterable) return [];
  return allowedFilterOperators(field, capabilities);
}

@Injectable()
export class DescribeEntityTool {
  constructor(private readonly factory: ToolFactory) {}

  build(ctx: UserContext, recorder: ToolCallRecord[]): DynamicStructuredTool {
    return new DynamicStructuredTool({
      name: "describe_entity",
      description: "Returns the described fields and relationships for an entity type.",
      schema: inputSchema,
      func: async (input) => JSON.stringify(await this.invoke(input, ctx, recorder)),
    });
  }

  async invoke(input: z.infer<typeof inputSchema>, ctx: UserContext, recorder: ToolCallRecord[]): Promise<unknown> {
    return this.factory.capture(
      { tool: "describe_entity", input },
      async () => {
        const entity = this.factory.resolveEntity(input.type, ctx);
        if ("error" in entity) return entity;
        // The write tools refuse anything not marked writable here, so the model
        // must be TOLD which fields and relationships it may set — without this
        // it fills system-generated fields and read-only traversals, and the
        // refusal only lands after the user has approved the action. Omitted
        // entirely for a read-only type: a host that opts nothing in sees the
        // response it has always seen.
        const writable = entity.writable === true;
        // A service whose records live outside the app database may support
        // fewer filters than the field types allow; advertise only those.
        // When it declares capabilities, a field is filterable only if it has operators.
        const capabilities = serviceFilterCapabilities(this.factory.resolveService(entity.type));
        return {
          type: entity.type,
          description: entity.description,
          fields: entity.fields.map((f) => {
            const operators = filterOperators(f, capabilities);
            const values = capabilities?.find((c) => c.field === f.name)?.values;
            return {
              name: f.name,
              type: f.type,
              description: f.description,
              filterable: capabilities ? operators.length > 0 : f.filterable,
              sortable: f.sortable,
              operators,
              ...(values?.length ? { values: [...values] } : {}),
              ...(f.kind ? { kind: f.kind } : {}),
              // A richtext field is READ as markdown (the tool layer renders the
              // stored BlockNote document), so it must be WRITTEN as markdown too —
              // the write tools convert it back. Without saying so the model has no
              // way to know the two directions match.
              ...(f.kind?.type === "richtext" ? { format: "markdown" } : {}),
              ...(entity.list ? { stage: entity.list.includes(f.name) ? "list" : "detail" } : {}),
              ...(writable ? { writable: isFieldWritable(entity, f.name) } : {}),
            };
          }),
          relationships: entity.relationships.map((r) => ({
            name: r.name,
            targetType: r.targetType,
            cardinality: r.cardinality,
            description: r.description,
            ...(writable ? { writable: isRelationshipWritable(entity, r) } : {}),
          })),
          // Detail fields are filled by the type's service on read_entity only: they
          // cannot be filtered, sorted, searched or listed, so they stay out of `fields`.
          ...(entity.detailFields?.length
            ? {
                detailFields: entity.detailFields.map((f) => ({
                  name: f.name,
                  type: f.type,
                  description: f.description,
                  availableOn: "read_entity",
                })),
              }
            : {}),
          ...(entity.bridge ? { bridge: { materialiseTo: [...entity.bridge.materialiseTo] } } : {}),
        };
      },
      recorder,
    );
  }
}
