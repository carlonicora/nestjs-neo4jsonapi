import { Injectable } from "@nestjs/common";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { ToolFactory, ToolCallRecord, UserContext } from "./tool.factory";
import { buildToolFieldsOutput } from "../services/field-formatting";
import { materialiseBridge } from "../services/materialise-bridge";
import { GraphCatalogService } from "../services/graph.catalog.service";
import { EntityServiceRegistry } from "../../../common/registries/entity.service.registry";

const inputSchema = z.object({
  type: z.string(),
  id: z.string(),
  include: z.array(z.string()).optional().describe("Relationship names to pull one-hop related records."),
});

@Injectable()
export class ReadEntityTool {
  constructor(
    private readonly factory: ToolFactory,
    private readonly catalog: GraphCatalogService,
    private readonly registry: EntityServiceRegistry,
  ) {}

  build(ctx: UserContext, recorder: ToolCallRecord[]): DynamicStructuredTool {
    return new DynamicStructuredTool({
      name: "read_entity",
      description: "Fetches one record by id, optionally pulling related records across described relationships.",
      schema: inputSchema,
      func: async (input) => JSON.stringify(await this.invoke(input, ctx, recorder)),
    });
  }

  async invoke(input: z.infer<typeof inputSchema>, ctx: UserContext, recorder: ToolCallRecord[]): Promise<unknown> {
    const localMaterialised: Array<{ relName: string; count: number }> = [];
    const result = await this.factory.capture(
      { tool: "read_entity", input },
      async () => {
        const described = recorder.some(
          (c) => c.tool === "describe_entity" && (c.input as { type?: string }).type === input.type,
        );
        const entity = this.factory.resolveEntity(input.type, ctx);
        if ("error" in entity) return entity;
        if (!described) {
          return {
            error: `You must call describe_entity({ type: "${input.type}" }) before reading a ${input.type} record. The schema is included below — either call describe_entity({ type: "${input.type}" }) to record the contract and retry this read, or proceed using the listed fields and relationships. Never stop on this error.`,
            schema: { fields: entity.fields, relationships: entity.relationships },
          };
        }

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
            // Use edge-based lookup so this works for relationships that are
            // reverse-only on the catalog (not declared on the target descriptor).
            const targetDirection: "in" | "out" = rel.cypherDirection === "out" ? "in" : "out";
            const records: any[] = await targetSvc.findRelatedRecordsByEdge({
              cypherLabel: rel.cypherLabel,
              cypherDirection: targetDirection,
              relatedLabel: entity.labelName,
              relatedId: input.id,
              limit: 50,
            });
            const targetEntity = this.factory.resolveEntity(rel.targetType, ctx);
            const summariser =
              "error" in targetEntity
                ? (d: any) => String(d.id)
                : (targetEntity.summary ?? ((d: any) => String(d.name ?? d.id)));
            related[name] = records.map((r) => ({
              id: r.id,
              type: rel.targetType,
              summary: summariser(r),
            }));
          }
        }

        const baseFields = buildToolFieldsOutput(entity.fields, record);

        // Bridge fanout: if this entity is a bridge, replace the bare payload with
        // the materialised one. The existing `include` block (if any) stacks on top
        // as a sibling `related` map — it carries summary refs, while the bridge
        // fanout fills full records at the top level. They do not collide.
        if (entity.bridge) {
          const materialised = await materialiseBridge({
            bridge: entity,
            record: { id: record.id, fields: baseFields },
            ctx,
            deps: { catalog: this.catalog, registry: this.registry },
            onMaterialised: (relName, count) => localMaterialised.push({ relName, count }),
          });
          return input.include?.length ? { ...materialised, related } : materialised;
        }

        return {
          id: record.id,
          type: entity.type,
          fields: baseFields,
          ...(input.include?.length ? { related } : {}),
        };
      },
      recorder,
    );

    // Attach materialised summary to the recorder entry that capture() just pushed.
    if (localMaterialised.length && recorder.length) {
      recorder[recorder.length - 1].materialised = localMaterialised;
    }
    return result;
  }
}
