import { DynamicStructuredTool } from "@langchain/core/tools";
import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { EntityServiceRegistry } from "../../../common/registries/entity.service.registry";
import { BlockNoteService } from "../../../core/blocknote/services/blocknote.service";
import type { JsonApiDTOData } from "../../../core/neo4j/abstracts/abstract.service";
import { CatalogEntity, CatalogRelationship } from "../../graph/interfaces/graph.catalog.interface";
import { GraphCatalogService } from "../../graph/services/graph.catalog.service";
import { convertRichtextFields, RICHTEXT_HINT } from "../../graph/services/richtext.write";
import { ScopeGuard } from "../../graph/services/scope.guard";
import {
  isFieldWritable,
  relationshipRejection,
  scopeKeyOf,
  writableFieldNames,
  writableRelationshipNames,
} from "../../graph/services/writable.rules";
import { ToolCallRecord, ToolFactory, UserContext } from "../../graph/tools/tool.factory";
import {
  OperatorActionProposal,
  OperatorRetrievalContext,
  OperatorToolDefinition,
  ProposalRef,
} from "../interfaces/operator.tool.interface";

/**
 * Label used whenever a referenced record cannot be resolved to a name — it does
 * not exist, or it sits outside the run's scope. NEVER fall back to the id: the
 * approval card must not leak ids, nor names from another scope.
 */
const NOT_FOUND_LABEL = "(not found)";

/** Payload of `create_entity`. */
export interface CreateEntityInput {
  type: string;
  fields: Record<string, unknown>;
  relationships?: Record<string, string>;
}

/** Payload of `update_entity`. */
export interface UpdateEntityInput {
  type: string;
  id: string;
  fields: Record<string, unknown>;
}

/** Payload of `delete_entity`. */
export interface DeleteEntityInput {
  type: string;
  id: string;
}

/** Payload of `link_entities` and `unlink_entities`. */
export interface LinkEntitiesInput {
  type: string;
  id: string;
  relationship: string;
  targetIds: string[];
}

/** Shape every write method returns instead of throwing, matching the read tools. */
type WriteError = { error: string };

const isError = (value: unknown): value is WriteError =>
  typeof value === "object" && value !== null && "error" in value;

/** The AbstractService the registry hands back, without naming its module here. */
type EntityService = NonNullable<ReturnType<EntityServiceRegistry["get"]>>;

/** What a checked call carries into the write, so nothing is resolved twice. */
interface PreparedWrite {
  entity: CatalogEntity;
  service: EntityService;
}

interface PreparedCreate extends PreparedWrite {
  fields: Record<string, unknown>;
  /**
   * The model-supplied relationships, keyed by CATALOG NAME and already stripped of
   * the scope relationship. `createRelationships` turns them into a JSON:API
   * `relationships` object and re-adds the scope from the run itself.
   */
  relationships: Record<string, unknown>;
}

interface PreparedUpdate extends PreparedWrite {
  id: string;
  fields: Record<string, unknown>;
}

interface PreparedDelete extends PreparedWrite {
  id: string;
}

interface PreparedLink extends PreparedWrite {
  id: string;
  relationship: CatalogRelationship;
  targetIds: string[];
}

/**
 * Generic, catalog-driven create/update/delete/link/unlink tools for the operator.
 *
 * Three invariants make these safe enough to expose to an LLM:
 *
 * 1. **Opt-in.** Only descriptors that declare `chat.writable` are touchable, and
 *    only when the caller's modules grant access. When nothing is writable the
 *    tools are not built at all, so a host application that never opts in sees
 *    exactly the tool set it had before. `chat.writable` may narrow further to an
 *    allow-list of fields and relationships, which `describe_entity` reports and
 *    every check here enforces.
 * 2. **Scoped.** Every id in every payload is checked through `ScopeGuard`, and
 *    `create` overwrites the scope relationship with the run's OWN scope id — the
 *    model cannot name a different one. The scope relationship itself can never be
 *    re-pointed, so a record cannot be moved between scope roots.
 * 3. **Service-only, through the same DTO path the controllers use.** Writes go
 *    through `EntityServiceRegistry.get(type)`, i.e. the AbstractService, never the
 *    repository — and always via its `*FromDTO` helpers with a `JsonApiDTOData`,
 *    exactly as an HTTP controller does. That is what makes a host application's
 *    OVERRIDE of `createFromDTO` / `patchFromDTO` fire (ownership checks,
 *    knowledge-graph and summariser scheduling, cache invalidation) and what lets
 *    `mapDTOToParams` fill `contextKey` relationships from CLS. Calling the plain
 *    `create` / `patch` would skip every one of those: the record is written, the
 *    app's read query for its type then finds nothing (a required owner edge is
 *    missing) and the tool reports `not found` for a record that exists. No Cypher
 *    is written here.
 */
@Injectable()
export class EntityWriteTools {
  private readonly logger = new Logger(EntityWriteTools.name);

  constructor(
    private readonly catalog: GraphCatalogService,
    private readonly registry: EntityServiceRegistry,
    private readonly scopeGuard: ScopeGuard,
    /**
     * Optional in the TYPE signature only, so unit tests can construct the three
     * collaborators they exercise. Nest has no notion of `?` and still resolves it
     * from GraphModule — a missing provider fails loudly at boot rather than
     * silently dropping the per-turn tool-call audit trail.
     */
    private readonly factory?: ToolFactory,
    /**
     * Optional in the TYPE signature for the same reason as `factory`, and
     * resolved from GraphModule (which re-exports BlockNoteModule) exactly the
     * same way. Without it a rich-text field would pass through as the model's
     * raw markdown; see `convertRichtextFields`.
     */
    private readonly blockNote?: BlockNoteService,
  ) {}

  /**
   * Builds the five write tools for one operator turn.
   *
   * Returns `[]` when the caller can write nothing. This is what keeps hosts that
   * declare no `chat.writable` descriptor on exactly the behaviour they had before
   * these tools existed.
   */
  buildDefinitions(ctx: OperatorRetrievalContext, recorder: ToolCallRecord[]): OperatorToolDefinition[] {
    const writableTypes = this.writableTypes(ctx);
    if (!writableTypes.length) return [];

    const types = writableTypes.join(", ");
    const typeField = z.string().describe(`The entity type to write. Only these types may be written: ${types}.`);

    const createSchema = z.object({
      type: typeField,
      fields: z
        .record(z.string(), z.any())
        .describe(
          "Field values keyed by field name. Call describe_entity first to learn the valid field names. " +
            "Only fields describe_entity marks writable may be set.",
        ),
      relationships: z
        .record(z.string(), z.string())
        .optional()
        .describe(
          "Related record ids keyed by relationship name, for relationships declared on this type. " +
            "Only relationships describe_entity marks writable may be set.",
        ),
    });

    const updateSchema = z.object({
      type: typeField,
      id: z.string().describe("Id of the record to update."),
      fields: z
        .record(z.string(), z.any())
        .describe(
          "Only the field values that change. Others are left untouched. " +
            "Only fields describe_entity marks writable may be set.",
        ),
    });

    const deleteSchema = z.object({
      type: typeField,
      id: z.string().describe("Id of the record to delete."),
    });

    const linkSchema = z.object({
      type: typeField,
      id: z.string().describe("Id of the record whose relationship changes."),
      relationship: z
        .string()
        .describe(
          "Relationship name as reported by describe_entity. " +
            "Only relationships describe_entity marks writable may be set.",
        ),
      targetIds: z.array(z.string()).describe("Ids of the related records."),
    });

    return [
      {
        tool: new DynamicStructuredTool({
          name: "create_entity",
          description:
            `Creates one new record. Writable types: ${types}. ` +
            "Only fields describe_entity marks writable may be set, and only relationships describe_entity marks writable. " +
            RICHTEXT_HINT +
            " This action requires user approval before it runs.",
          schema: createSchema,
          func: async (input: z.infer<typeof createSchema>) =>
            JSON.stringify(await this.createEntity(input as CreateEntityInput, ctx, recorder)),
        }),
        destructive: true,
        summarise: (args) => this.summariseCreate(args),
        present: (args) => this.presentCreate(args, ctx),
        validate: async (args) => this.rejection(await this.prepareCreate(args as unknown as CreateEntityInput, ctx)),
      },
      {
        tool: new DynamicStructuredTool({
          name: "update_entity",
          description:
            `Updates the given fields of one existing record, leaving every other field untouched. Writable types: ${types}. ` +
            "Only fields describe_entity marks writable may be set. " +
            RICHTEXT_HINT +
            " This action requires user approval before it runs.",
          schema: updateSchema,
          func: async (input: z.infer<typeof updateSchema>) =>
            JSON.stringify(await this.updateEntity(input as UpdateEntityInput, ctx, recorder)),
        }),
        destructive: true,
        summarise: (args) => this.summariseUpdate(args, ctx),
        present: (args) => this.presentUpdate(args, ctx),
        validate: async (args) => this.rejection(await this.prepareUpdate(args as unknown as UpdateEntityInput, ctx)),
      },
      {
        tool: new DynamicStructuredTool({
          name: "delete_entity",
          description: `Permanently deletes one existing record. Writable types: ${types}. This action requires user approval before it runs.`,
          schema: deleteSchema,
          func: async (input: z.infer<typeof deleteSchema>) =>
            JSON.stringify(await this.deleteEntity(input as DeleteEntityInput, ctx, recorder)),
        }),
        destructive: true,
        summarise: (args) => this.summariseDelete(args, ctx),
        present: (args) => this.presentDelete(args, ctx),
        validate: async (args) => this.rejection(await this.prepareDelete(args as unknown as DeleteEntityInput, ctx)),
      },
      {
        tool: new DynamicStructuredTool({
          name: "link_entities",
          description:
            `Adds related records to one relationship of an existing record. Writable types: ${types}. ` +
            "Only relationships describe_entity marks writable may be set. " +
            "This action requires user approval before it runs.",
          schema: linkSchema,
          func: async (input: z.infer<typeof linkSchema>) =>
            JSON.stringify(await this.linkEntities(input as LinkEntitiesInput, ctx, recorder)),
        }),
        destructive: true,
        summarise: (args) => this.summariseLink(args, "Link", ctx),
        present: (args) => this.presentLink(args, ctx),
        validate: async (args) =>
          this.rejection(await this.prepareLink(args as unknown as LinkEntitiesInput, ctx, "link")),
      },
      {
        tool: new DynamicStructuredTool({
          name: "unlink_entities",
          description:
            `Removes related records from one relationship of an existing record. Writable types: ${types}. ` +
            "Only relationships describe_entity marks writable may be set. " +
            "This action requires user approval before it runs.",
          schema: linkSchema,
          func: async (input: z.infer<typeof linkSchema>) =>
            JSON.stringify(await this.unlinkEntities(input as LinkEntitiesInput, ctx, recorder)),
        }),
        destructive: true,
        summarise: (args) => this.summariseLink(args, "Unlink", ctx),
        present: (args) => this.presentLink(args, ctx),
        validate: async (args) =>
          this.rejection(await this.prepareLink(args as unknown as LinkEntitiesInput, ctx, "unlink")),
      },
    ];
  }

  async createEntity(input: CreateEntityInput, ctx: UserContext, recorder: ToolCallRecord[]): Promise<unknown> {
    return this.capture("create_entity", input as unknown as Record<string, unknown>, recorder, async () => {
      const prepared = await this.prepareCreate(input, ctx);
      if (isError(prepared)) return prepared;

      const { entity, service, fields, relationships } = prepared;
      const id = randomUUID();
      return this.dispatch(async () => {
        // The model writes markdown into a rich-text field, because that is what
        // the read side rendered for it. Storing it verbatim leaves a record the
        // frontend cannot render at all, so it becomes a BlockNote document here
        // — after validation (which checks the markdown is a string) and after
        // the approval card, which shows the model's own text.
        const attributes = await convertRichtextFields(this.blockNote, entity, fields);
        const data: JsonApiDTOData = {
          type: entity.type,
          id,
          attributes,
          relationships: this.createRelationships({ entity, relationships, ctx }),
        };
        await service.createFromDTO({ data });
        return { id, type: entity.type, created: true };
      });
    });
  }

  async updateEntity(input: UpdateEntityInput, ctx: UserContext, recorder: ToolCallRecord[]): Promise<unknown> {
    return this.capture("update_entity", input as unknown as Record<string, unknown>, recorder, async () => {
      const prepared = await this.prepareUpdate(input, ctx);
      if (isError(prepared)) return prepared;

      const { entity, service, fields, id } = prepared;
      return this.dispatch(async () => {
        // Markdown in a rich-text field becomes a BlockNote document; see createEntity.
        const attributes = await convertRichtextFields(this.blockNote, entity, fields);
        // patch, not put: only the named fields change. put would map every
        // descriptor relationship and treat the ones absent from the payload as
        // "delete all edges", silently stripping the record's relationships.
        await service.patchFromDTO({ data: { type: entity.type, id, attributes } });
        return { id, type: entity.type, updated: true };
      });
    });
  }

  async deleteEntity(input: DeleteEntityInput, ctx: UserContext, recorder: ToolCallRecord[]): Promise<unknown> {
    return this.capture("delete_entity", input as unknown as Record<string, unknown>, recorder, async () => {
      const prepared = await this.prepareDelete(input, ctx);
      if (isError(prepared)) return prepared;

      const { entity, service, id } = prepared;
      return this.dispatch(async () => {
        await service.delete({ id });
        return { id, type: entity.type, deleted: true };
      });
    });
  }

  async linkEntities(input: LinkEntitiesInput, ctx: UserContext, recorder: ToolCallRecord[]): Promise<unknown> {
    return this.capture("link_entities", input as unknown as Record<string, unknown>, recorder, () =>
      this.applyLink(input, ctx, "link"),
    );
  }

  async unlinkEntities(input: LinkEntitiesInput, ctx: UserContext, recorder: ToolCallRecord[]): Promise<unknown> {
    return this.capture("unlink_entities", input as unknown as Record<string, unknown>, recorder, () =>
      this.applyLink(input, ctx, "unlink"),
    );
  }

  // ---------------------------------------------------------------------------
  // Preparation
  //
  // Every check a write performs lives here, once per tool, so the `validate`
  // hook — which runs BEFORE the user is asked to approve anything — rejects
  // exactly the calls the execution path rejects, with exactly the same message.
  // A prepared result carries the payload the write then uses, so a check never
  // has to be repeated at write time.
  //
  // Tool args reach `validate` straight from the model, unvalidated by the zod
  // schema, so every accessor here is defensive about shape.
  // ---------------------------------------------------------------------------

  private async prepareCreate(input: CreateEntityInput, ctx: UserContext): Promise<PreparedCreate | WriteError> {
    const entity = this.resolveWritable(input?.type, ctx);
    if (isError(entity)) return entity;

    const fields = this.toValueMap(input?.fields);
    const fieldError = this.validateFields(entity, fields);
    if (fieldError) return { error: fieldError };

    // The run's scope is authoritative: whatever the model supplied for the scope
    // relationship is discarded here and replaced at write time.
    const scopeKey = scopeKeyOf(entity);
    const relationships = this.toValueMap(input?.relationships);
    if (scopeKey) delete relationships[scopeKey];

    const relationshipError = await this.validateRelationships(entity, relationships, ctx);
    if (relationshipError) return { error: relationshipError };

    const service = this.registry.get(entity.type);
    if (!service) return { error: `Service not available for "${entity.type}".` };

    return { entity, service, fields, relationships };
  }

  private async prepareUpdate(input: UpdateEntityInput, ctx: UserContext): Promise<PreparedUpdate | WriteError> {
    const entity = this.resolveWritable(input?.type, ctx);
    if (isError(entity)) return entity;

    const id = this.toId(input?.id);
    const outOfScope = await this.requireInScope(entity.type, [id], ctx);
    if (outOfScope) return outOfScope;

    const fields = this.toValueMap(input?.fields);
    const fieldError = this.validateFields(entity, fields);
    if (fieldError) return { error: fieldError };

    const service = this.registry.get(entity.type);
    if (!service) return { error: `Service not available for "${entity.type}".` };

    return { entity, service, id, fields };
  }

  private async prepareDelete(input: DeleteEntityInput, ctx: UserContext): Promise<PreparedDelete | WriteError> {
    const entity = this.resolveWritable(input?.type, ctx);
    if (isError(entity)) return entity;

    const id = this.toId(input?.id);
    const outOfScope = await this.requireInScope(entity.type, [id], ctx);
    if (outOfScope) return outOfScope;

    const service = this.registry.get(entity.type);
    if (!service) return { error: `Service not available for "${entity.type}".` };

    return { entity, service, id };
  }

  private async prepareLink(
    input: LinkEntitiesInput,
    ctx: UserContext,
    mode: "link" | "unlink",
  ): Promise<PreparedLink | WriteError> {
    const entity = this.resolveWritable(input?.type, ctx);
    if (isError(entity)) return entity;

    const relationship = entity.relationships.find((candidate) => candidate.name === input?.relationship);
    if (!relationship) {
      return {
        error: `Relationship "${input?.relationship}" is not available on ${entity.type}. Valid relationships: [${entity.relationships
          .map((candidate) => candidate.name)
          .join(", ")}].`,
      };
    }
    const rejection = this.rejectUnwritableRelationship(entity, relationship);
    if (rejection) return { error: rejection };

    const targetIds = Array.isArray(input?.targetIds) ? input.targetIds.map((id) => String(id)) : [];
    if (!targetIds.length) return { error: "targetIds must contain at least one id." };

    if (relationship.cardinality === "one") {
      if (mode === "unlink") {
        // A to-one edge cannot be removed through the generic patch path: the
        // repository maps an empty list to "no change", so the edge would survive
        // while the tool reported success.
        return {
          error: `Relationship "${relationship.name}" on ${entity.type} holds a single record and cannot be cleared. Link a different record instead.`,
        };
      }
      if (targetIds.length !== 1) {
        return { error: `Relationship "${relationship.name}" on ${entity.type} accepts exactly one record.` };
      }
    }

    const id = this.toId(input?.id);
    const outOfScope =
      (await this.requireInScope(entity.type, [id], ctx)) ??
      (await this.requireInScope(relationship.targetType, targetIds, ctx));
    if (outOfScope) return outOfScope;

    const service = this.registry.get(entity.type);
    if (!service) return { error: `Service not available for "${entity.type}".` };

    return { entity, service, id, relationship, targetIds };
  }

  /** The `validate` hook's answer: the rejection message, or `null` when the call may proceed. */
  private rejection(prepared: PreparedWrite | WriteError): string | null {
    return isError(prepared) ? prepared.error : null;
  }

  // ---------------------------------------------------------------------------
  // Guards
  // ---------------------------------------------------------------------------

  private resolveWritable(type: string, ctx: UserContext): CatalogEntity | WriteError {
    const entity = this.catalog.getEntityDetail(type, ctx.userModuleIds);
    if (!entity) return { error: `Entity type "${type}" is not available.` };
    if (!entity.writable) {
      return { error: `Entity type "${type}" is read-only. Writable types: ${this.writableTypes(ctx).join(", ")}.` };
    }
    return entity;
  }

  /**
   * Reject any field the catalog does not declare, any field the descriptor does
   * not open to the assistant, and any type mismatch. The writable list is what
   * keeps the model out of the fields the system generates itself (a tldr, a
   * summary, an ai status): they are described — the model can read them — but
   * writing them would overwrite generated content with a guess.
   */
  private validateFields(entity: CatalogEntity, fields: Record<string, unknown>): string | null {
    const byName = new Map(entity.fields.map((field) => [field.name, field]));
    for (const [name, value] of Object.entries(fields)) {
      const definition = byName.get(name);
      if (!definition) {
        return `Field "${name}" is not available on ${entity.type}. Valid fields: [${entity.fields
          .map((field) => field.name)
          .join(", ")}].`;
      }
      if (!isFieldWritable(entity, name)) {
        return `Field "${name}" on ${entity.type} is not writable. Writable fields: [${writableFieldNames(entity).join(
          ", ",
        )}].`;
      }
      if (!this.matchesType(definition.type, value)) {
        return `Field "${name}" on ${entity.type} expects ${definition.type}.`;
      }
    }
    return null;
  }

  /**
   * Reject unknown or reverse-only relationship keys, and any target id that is
   * outside the run's scope. The scope relationship never reaches this method —
   * callers strip it first.
   */
  private async validateRelationships(
    entity: CatalogEntity,
    relationships: Record<string, unknown>,
    ctx: UserContext,
  ): Promise<string | null> {
    const byName = new Map(entity.relationships.map((relationship) => [relationship.name, relationship]));
    for (const [name, value] of Object.entries(relationships)) {
      const relationship = byName.get(name);
      if (!relationship) {
        return `Relationship "${name}" is not available on ${entity.type}. Valid relationships: [${entity.relationships
          .map((candidate) => candidate.name)
          .join(", ")}].`;
      }
      const rejection = this.rejectUnwritableRelationship(entity, relationship);
      if (rejection) return rejection;

      const ids = (Array.isArray(value) ? value : [value]).map((id) => String(id));
      const outOfScope = await this.requireInScope(relationship.targetType, ids, ctx);
      if (outOfScope) return outOfScope.error;
    }
    return null;
  }

  /**
   * The message for a relationship the generic write path must never touch. The
   * reasons themselves live in `writable.rules` — the same predicate
   * `describe_entity` uses to tell the model what it may write, so what the model
   * is told and what is enforced here cannot drift.
   */
  private rejectUnwritableRelationship(entity: CatalogEntity, relationship: CatalogRelationship): string | null {
    switch (relationshipRejection(entity, relationship)) {
      case "reverse":
      case "polymorphic":
        return `Relationship "${relationship.name}" on ${entity.type} is read-only and cannot be written.`;
      case "scope":
        return `Relationship "${relationship.name}" on ${entity.type} cannot be changed.`;
      case "notListed":
        return `Relationship "${relationship.name}" on ${entity.type} is not writable. Writable relationships: [${writableRelationshipNames(
          entity,
        ).join(", ")}].`;
      default:
        return null;
    }
  }

  /** `null` when every id is inside the run's scope, otherwise the error to return. */
  private async requireInScope(type: string, ids: string[], ctx: UserContext): Promise<WriteError | null> {
    for (const id of ids) {
      const inScope = await this.scopeGuard.isInScope({ type, id, ctx });
      if (!inScope) {
        this.logger.warn(`entity-write: ${type} record "${id}" is not found in the current scope.`);
        return { error: `A ${type} record with id "${id}" was not found.` };
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * The JSON:API `relationships` object a create sends, built from three sources:
   *
   * 1. what the model supplied, keyed by the descriptor's `dtoKey` (NOT the catalog
   *    name — `mapDTOToParams` looks relationships up by `dtoKey`, so a payload
   *    keyed by name is dropped without a word whenever the two differ);
   * 2. the run's OWN scope root, which overwrites anything the model named — the
   *    model's value was already stripped while preparing;
   * 3. the owner, from the run's user. The host application's clients send this on
   *    every create, and its read query for the type requires the edge: without it
   *    the record is written and then cannot be read back.
   */
  private createRelationships(params: {
    entity: CatalogEntity;
    relationships: Record<string, unknown>;
    ctx: UserContext;
  }): NonNullable<JsonApiDTOData["relationships"]> {
    const { entity, relationships, ctx } = params;
    const byName = new Map(entity.relationships.map((relationship) => [relationship.name, relationship]));
    const data: NonNullable<JsonApiDTOData["relationships"]> = {};

    for (const [name, value] of Object.entries(relationships)) {
      const relationship = byName.get(name);
      if (!relationship) continue;
      const ids = this.toIdList(value);
      if (!ids.length) continue;
      data[relationship.dtoKey] =
        relationship.cardinality === "one"
          ? { data: { type: relationship.targetType, id: ids[0] } }
          : { data: ids.map((targetId) => ({ type: relationship.targetType, id: targetId })) };
    }

    const hop = entity.scope?.path[0];
    if (hop && ctx.scopeId) data[hop.dtoKey] = { data: { type: hop.targetType, id: ctx.scopeId } };

    if (entity.owner && ctx.userId) {
      data[entity.owner.dtoKey] = { data: { type: entity.owner.type, id: ctx.userId } };
    }

    return data;
  }

  /** A payload map from raw tool args: anything that is not a plain object is empty. */
  private toValueMap(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
  }

  /** An id from raw tool args; a missing one becomes `""`, which no scope check passes. */
  private toId(value: unknown): string {
    return typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
  }

  private writableTypes(ctx: UserContext): string[] {
    return this.catalog
      .getAllChatEnabledEntities()
      .filter((entity) => entity.writable && ctx.userModuleIds.includes(entity.moduleId))
      .map((entity) => entity.type);
  }

  private matchesType(type: string, value: unknown): boolean {
    // An explicit null clears a field; the repository handles it per type.
    if (value === null || value === undefined) return true;
    if (type.endsWith("[]")) {
      const base = type.slice(0, -2);
      return Array.isArray(value) && value.every((item) => this.matchesType(base, item));
    }
    switch (type) {
      case "string":
      case "date":
      case "datetime":
        return typeof value === "string";
      case "number":
        return typeof value === "number" && Number.isFinite(value);
      case "boolean":
        return typeof value === "boolean";
      default:
        // "json" and any future scalar: the descriptor imposes no shape.
        return true;
    }
  }

  private async applyLink(input: LinkEntitiesInput, ctx: UserContext, mode: "link" | "unlink"): Promise<unknown> {
    const prepared = await this.prepareLink(input, ctx, mode);
    if (isError(prepared)) return prepared;

    const { entity, service, id, relationship, targetIds } = prepared;
    return this.dispatch(async () => {
      if (relationship.cardinality === "one") {
        // The framework's add/remove relationship helpers are to-many only, so a
        // to-one edge is repointed with patch, which replaces the single edge.
        await service.patchFromDTO({
          data: {
            type: entity.type,
            id,
            relationships: {
              [relationship.dtoKey]: { data: { type: relationship.targetType, id: targetIds[0] } },
            },
          },
        });
      } else if (mode === "link") {
        await service.addToRelationshipFromDTO({
          id,
          relationship: relationship.name,
          data: targetIds.map((targetId) => ({ id: targetId, type: relationship.targetType })),
        });
      } else {
        await service.removeFromRelationshipFromDTO({
          id,
          relationship: relationship.name,
          data: targetIds.map((targetId) => ({ id: targetId, type: relationship.targetType })),
        });
      }

      return { id, type: entity.type, relationship: relationship.name, targetIds, [mode + "ed"]: true };
    });
  }

  /**
   * Runs a write and converts a thrown framework error into the `{ error }` shape
   * every tool method returns, matching the read tools' contract: the operator
   * turns a returned error into a ToolMessage the model can recover from, whereas
   * a thrown one aborts the tool node.
   */
  private async dispatch(fn: () => Promise<unknown>): Promise<unknown> {
    try {
      return await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`entity-write: write rejected: ${message}`);
      return { error: message };
    }
  }

  private capture(
    tool: string,
    input: Record<string, unknown>,
    recorder: ToolCallRecord[],
    fn: () => Promise<unknown>,
  ): Promise<unknown> {
    return this.factory ? this.factory.capture({ tool, input }, fn, recorder) : fn();
  }

  // ---------------------------------------------------------------------------
  // Name resolution
  //
  // The approval card shows NAMES, never ids. Every referenced record is resolved
  // here, through the scope guard first: an id the run may not see resolves to
  // "(not found)" so a cross-scope name can never leak.
  // ---------------------------------------------------------------------------

  private async resolveRef(params: { type: string; id: string; ctx: UserContext }): Promise<ProposalRef> {
    const { type, id, ctx } = params;
    const unresolved: ProposalRef = { id, type, label: NOT_FOUND_LABEL };
    try {
      if (!(await this.scopeGuard.isInScope({ type, id, ctx }))) return unresolved;

      const record = await this.registry.get(type)?.findRecordById({ id });
      if (!record) return unresolved;

      const catalogEntity = this.catalog.getEntityDetail(type, ctx.userModuleIds);
      const candidate =
        catalogEntity?.summary?.(record) ??
        (record as Record<string, unknown>).name ??
        (record as Record<string, unknown>).title ??
        NOT_FOUND_LABEL;
      const label = typeof candidate === "string" && candidate ? candidate : NOT_FOUND_LABEL;
      return { id, type, label };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`entity-write: could not resolve the name of a ${type} record: ${message}`);
      return unresolved;
    }
  }

  /** Resolve the record the tool call targets, from `args.type` / `args.id`. */
  private async resolveTargetRef(args: Record<string, unknown>, ctx: UserContext): Promise<ProposalRef> {
    const type = this.argType(args);
    const id = typeof args.id === "string" ? args.id : "";
    if (!id) return { id: "", type, label: NOT_FOUND_LABEL };
    return this.resolveRef({ type, id, ctx });
  }

  /** Relationship payloads are `Record<string, string>` by schema; arrays are accepted defensively. */
  private toIdList(value: unknown): string[] {
    if (value === null || value === undefined) return [];
    return (Array.isArray(value) ? value : [value]).map((id) => String(id)).filter((id) => id.length > 0);
  }

  /** `"Marcus"` when resolved, bare `(not found)` when not — an id is never rendered. */
  private quote(label: string): string {
    return label === NOT_FOUND_LABEL ? NOT_FOUND_LABEL : `"${label}"`;
  }

  // ---------------------------------------------------------------------------
  // Approval-card summaries
  //
  // These are rendered to the user before the action runs. Referenced records
  // are named, never identified: no id ever reaches this text.
  // ---------------------------------------------------------------------------

  private summariseCreate(args: Record<string, unknown>): string {
    const type = this.argType(args);
    const label = this.summariseLabel(args.fields);
    return label ? `Create a new ${type} record named "${label}".` : `Create a new ${type} record.`;
  }

  private async summariseUpdate(args: Record<string, unknown>, ctx: UserContext): Promise<string> {
    const type = this.argType(args);
    const fields = args.fields && typeof args.fields === "object" ? Object.keys(args.fields as object) : [];
    const changed = fields.length ? ` (${fields.join(", ")})` : "";
    const target = await this.resolveTargetRef(args, ctx);
    return `Update the ${type} record ${this.quote(target.label)}${changed}.`;
  }

  private async summariseDelete(args: Record<string, unknown>, ctx: UserContext): Promise<string> {
    const target = await this.resolveTargetRef(args, ctx);
    return `Delete the ${this.argType(args)} record ${this.quote(target.label)}.`;
  }

  private async summariseLink(
    args: Record<string, unknown>,
    verb: "Link" | "Unlink",
    ctx: UserContext,
  ): Promise<string> {
    const relationship = typeof args.relationship === "string" && args.relationship ? args.relationship : "related";
    const preposition = verb === "Link" ? "to" : "from";
    const target = await this.resolveTargetRef(args, ctx);
    const targets = await this.resolveLinkTargets(args, ctx);
    const named = targets.length ? targets.map((ref) => this.quote(ref.label)).join(", ") : "no records";
    return `${verb} ${named} ${preposition} the "${relationship}" relationship of the ${this.argType(
      args,
    )} record ${this.quote(target.label)}.`;
  }

  private argType(args: Record<string, unknown>): string {
    return typeof args.type === "string" && args.type ? args.type : "record";
  }

  private summariseLabel(fields: unknown): string | undefined {
    if (!fields || typeof fields !== "object") return undefined;
    const candidate = (fields as Record<string, unknown>).name ?? (fields as Record<string, unknown>).title;
    return typeof candidate === "string" && candidate ? candidate : undefined;
  }

  // ---------------------------------------------------------------------------
  // Approval-card proposals
  //
  // The structured, name-resolved rendering the card reads instead of toolArgs.
  // ---------------------------------------------------------------------------

  private async presentCreate(args: Record<string, unknown>, ctx: UserContext): Promise<OperatorActionProposal> {
    const type = this.argType(args);
    const entity = this.catalog.getEntityDetail(type, ctx.userModuleIds);
    const scopeKey = entity ? scopeKeyOf(entity) : undefined;
    const byName = new Map((entity?.relationships ?? []).map((relationship) => [relationship.name, relationship]));

    const raw = args.relationships && typeof args.relationships === "object" ? (args.relationships as object) : {};
    const relationships: Record<string, ProposalRef[]> = {};
    for (const [name, value] of Object.entries(raw)) {
      // The run's own scope is not a user choice — it is never shown.
      if (scopeKey && name === scopeKey) continue;
      const targetType = byName.get(name)?.targetType ?? name;
      const refs: ProposalRef[] = [];
      for (const id of this.toIdList(value)) refs.push(await this.resolveRef({ type: targetType, id, ctx }));
      if (refs.length) relationships[name] = refs;
    }

    return {
      type,
      attributes: this.presentAttributes(args),
      ...(Object.keys(relationships).length ? { relationships } : {}),
    };
  }

  private async presentUpdate(args: Record<string, unknown>, ctx: UserContext): Promise<OperatorActionProposal> {
    return {
      type: this.argType(args),
      target: await this.resolveTargetRef(args, ctx),
      attributes: this.presentAttributes(args),
    };
  }

  private async presentDelete(args: Record<string, unknown>, ctx: UserContext): Promise<OperatorActionProposal> {
    return {
      type: this.argType(args),
      target: await this.resolveTargetRef(args, ctx),
    };
  }

  private async presentLink(args: Record<string, unknown>, ctx: UserContext): Promise<OperatorActionProposal> {
    return {
      type: this.argType(args),
      target: await this.resolveTargetRef(args, ctx),
      relationship: typeof args.relationship === "string" ? args.relationship : "",
      targets: await this.resolveLinkTargets(args, ctx),
    };
  }

  private async resolveLinkTargets(args: Record<string, unknown>, ctx: UserContext): Promise<ProposalRef[]> {
    const entity = this.catalog.getEntityDetail(this.argType(args), ctx.userModuleIds);
    const name = typeof args.relationship === "string" ? args.relationship : "";
    const targetType =
      entity?.relationships.find((relationship) => relationship.name === name)?.targetType ?? (name || "record");

    const refs: ProposalRef[] = [];
    for (const id of this.toIdList(args.targetIds)) refs.push(await this.resolveRef({ type: targetType, id, ctx }));
    return refs;
  }

  private presentAttributes(args: Record<string, unknown>): Record<string, unknown> {
    return args.fields && typeof args.fields === "object" ? ({ ...args.fields } as Record<string, unknown>) : {};
  }
}
