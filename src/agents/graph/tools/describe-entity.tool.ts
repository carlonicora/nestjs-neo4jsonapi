import { Injectable } from "@nestjs/common";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { isFieldWritable, isRelationshipWritable } from "../services/writable.rules";
import { ToolFactory, ToolCallRecord, UserContext } from "./tool.factory";
import { allowedFilterOperators, serviceFilterCapabilities } from "../services/filter-operators";
import { EntityDescription, renderCompactDescriptions } from "../services/compact-description";
import type { CatalogEntity, CatalogField } from "../interfaces/graph.catalog.interface";
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

/**
 * The structured description of one catalog type: what the model may filter,
 * sort, read and write on it. `capabilities` are the filter capabilities of the
 * type's service (`serviceFilterCapabilities`), `undefined` when it declares none.
 * Shared by `describe_entity` and the describe-first refusals of the read tools,
 * so both show the same contract.
 */
export function describeCatalogEntity(
  entity: CatalogEntity,
  capabilities: ExternalFilterCapability[] | undefined,
): EntityDescription {
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
        ...(f.kind?.type === "richtext" ? { format: "markdown" as const } : {}),
        ...(entity.list ? { stage: entity.list.includes(f.name) ? ("list" as const) : ("detail" as const) } : {}),
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
            availableOn: "read_entity" as const,
          })),
        }
      : {}),
    ...(entity.bridge ? { bridge: { materialiseTo: [...entity.bridge.materialiseTo] } } : {}),
  };
}

/**
 * The compact, standalone schema text of one catalog type, exactly as
 * `describe_entity` returns it. `service` is the type's registered service
 * (its filter capabilities decide the operators). Carried by the describe-first
 * refusals of read_entity, search_entities and traverse.
 */
export function renderEntitySchema(entity: CatalogEntity, service: unknown): string {
  return renderCompactDescriptions([describeCatalogEntity(entity, serviceFilterCapabilities(service))], {
    standalone: true,
  });
}

/** What `describe_entity` returns for a known type: the compact, self-contained text form. */
export interface DescribeEntityResult {
  type: string;
  /** `renderCompactDescriptions([description], { standalone: true })`. */
  schema: string;
}

/**
 * The `describe_entity` tool: the fields, relationships, filter operators and
 * writable parts of one entity type, returned as `{ type, schema }` where
 * `schema` is the compact text of {@link renderCompactDescriptions} rendered
 * standalone (it defines every shared part it refers to). An unknown or
 * inaccessible type returns the factory's `{ error, suggestion? }` object.
 *
 * {@link DescribeEntityTool.buildDescription} returns the structured form, for
 * callers that render several types together.
 */
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

  /** The structured description of `type` for this user, or the factory's error object. */
  buildDescription(type: string, ctx: UserContext): EntityDescription | { error: string; suggestion?: string } {
    const entity = this.factory.resolveEntity(type, ctx);
    if ("error" in entity) return entity;
    return describeCatalogEntity(entity, serviceFilterCapabilities(this.factory.resolveService(entity.type)));
  }

  /**
   * The compact catalog of every type this user can read, for a caller that
   * gives the model all descriptions up front (the responder lookup). Types are
   * sorted by name and rendered together with `{ standalone: false }`, so the
   * text depends only on `ctx.userModuleIds` and is byte-identical across
   * calls for the same modules. `types` lists the rendered types (the
   * pre-described set of {@link UserContext.preDescribedTypes});
   * `approxTokens` is `Math.ceil(text.length / 4)`.
   */
  renderCatalog(ctx: UserContext): { text: string; types: string[]; approxTokens: number } {
    const descriptions: EntityDescription[] = [];
    for (const type of [...this.factory.accessibleTypes(ctx)].sort()) {
      const description = this.buildDescription(type, ctx);
      if (!("error" in description)) descriptions.push(description);
    }
    const text = descriptions.length ? renderCompactDescriptions(descriptions, { standalone: false }) : "";
    return { text, types: descriptions.map((d) => d.type), approxTokens: Math.ceil(text.length / 4) };
  }

  async invoke(
    input: z.infer<typeof inputSchema>,
    ctx: UserContext,
    recorder: ToolCallRecord[],
  ): Promise<DescribeEntityResult | { error: string; suggestion?: string }> {
    return this.factory.capture(
      { tool: "describe_entity", input },
      async () => {
        const description = this.buildDescription(input.type, ctx);
        if ("error" in description) return description;
        return {
          type: description.type,
          schema: renderCompactDescriptions([description], { standalone: true }),
        };
      },
      recorder,
    );
  }
}
