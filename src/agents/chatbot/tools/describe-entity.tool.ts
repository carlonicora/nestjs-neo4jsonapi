import { Injectable } from "@nestjs/common";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { ToolFactory, ToolCallRecord, UserContext } from "./tool.factory";

const inputSchema = z.object({
  type: z.string().describe("Entity type name from the graph map."),
});

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
        return {
          type: entity.type,
          description: entity.description,
          fields: entity.fields.map((f) => ({
            name: f.name,
            type: f.type,
            description: f.description,
            filterable: f.filterable,
            sortable: f.sortable,
            ...(f.kind ? { kind: f.kind } : {}),
          })),
          relationships: entity.relationships.map((r) => ({
            name: r.name,
            targetType: r.targetType,
            cardinality: r.cardinality,
            description: r.description,
          })),
        };
      },
      recorder,
    );
  }
}
