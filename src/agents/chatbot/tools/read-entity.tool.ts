import { Injectable } from "@nestjs/common";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { ToolFactory, ToolCallRecord, UserContext } from "./tool.factory";

const inputSchema = z.object({
  type: z.string(),
  id: z.string(),
  include: z
    .array(z.string())
    .optional()
    .describe("Relationship names to pull one-hop related records."),
});

@Injectable()
export class ReadEntityTool {
  constructor(private readonly factory: ToolFactory) {}

  build(ctx: UserContext, recorder: ToolCallRecord[]): DynamicStructuredTool {
    return new DynamicStructuredTool({
      name: "read_entity",
      description:
        "Fetches one record by id, optionally pulling related records across described relationships.",
      schema: inputSchema,
      func: async (input) => JSON.stringify(await this.invoke(input, ctx, recorder)),
    });
  }

  async invoke(
    input: z.infer<typeof inputSchema>,
    ctx: UserContext,
    recorder: ToolCallRecord[],
  ): Promise<unknown> {
    return this.factory.capture(
      { tool: "read_entity", input },
      async () => {
        const entity = this.factory.resolveEntity(input.type, ctx);
        if ("error" in entity) return entity;

        const validRels = new Set(entity.relationships.map((r) => r.name));
        for (const name of input.include ?? []) {
          if (!validRels.has(name)) {
            return { error: `Relationship "${name}" is not available on ${entity.type}.` };
          }
        }

        const svc = this.factory.resolveService(entity.type);
        if (!svc) return { error: `Service not available for "${entity.type}".` };

        const record: any = await svc.findRecordById({ id: input.id });
        if (!record) return { error: `No ${entity.type} with id ${input.id}.` };

        const related: Record<string, any> = {};
        if (input.include?.length) {
          for (const name of input.include) {
            const rel = entity.relationships.find((r) => r.name === name)!;
            const targetSvc = this.factory.resolveService(rel.targetType);
            if (!targetSvc) {
              related[name] = { error: `Service for ${rel.targetType} not available.` };
              continue;
            }
            const records: any[] = await targetSvc.findRelatedRecords({
              relationship: rel.isReverse ? rel.cypherLabel : rel.name,
              id: input.id,
              limit: 50,
            });
            const targetEntity = this.factory.resolveEntity(rel.targetType, ctx);
            const summariser =
              "error" in targetEntity
                ? (d: any) => String(d.id)
                : targetEntity.summary ?? ((d: any) => String(d.name ?? d.id));
            related[name] = records.map((r) => ({
              id: r.id,
              type: rel.targetType,
              summary: summariser(r),
            }));
          }
        }

        return {
          id: record.id,
          type: entity.type,
          fields: Object.fromEntries(entity.fields.map((f) => [f.name, record[f.name]])),
          ...(input.include?.length ? { related } : {}),
        };
      },
      recorder,
    );
  }
}
