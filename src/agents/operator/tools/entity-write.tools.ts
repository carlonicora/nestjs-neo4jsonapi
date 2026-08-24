import { DynamicStructuredTool } from "@langchain/core/tools";
import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { EntityServiceRegistry } from "../../../common/registries/entity.service.registry";
import { CatalogEntity, CatalogRelationship } from "../../graph/interfaces/graph.catalog.interface";
import { GraphCatalogService } from "../../graph/services/graph.catalog.service";
import { ScopeGuard } from "../../graph/services/scope.guard";
import { ToolCallRecord, ToolFactory, UserContext } from "../../graph/tools/tool.factory";
import { OperatorRetrievalContext, OperatorToolDefinition } from "../interfaces/operator.tool.interface";

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

/**
 * Generic, catalog-driven create/update/delete/link/unlink tools for the operator.
 *
 * Three invariants make these safe enough to expose to an LLM:
 *
 * 1. **Opt-in.** Only descriptors that declare `chat.writable` are touchable, and
 *    only when the caller's modules grant access. When nothing is writable the
 *    tools are not built at all, so a host application that never opts in sees
 *    exactly the tool set it had before.
 * 2. **Scoped.** Every id in every payload is checked through `ScopeGuard`, and
 *    `create` overwrites the scope relationship with the run's OWN scope id — the
 *    model cannot name a different one. The scope relationship itself can never be
 *    re-pointed, so a record cannot be moved between scope roots.
 * 3. **Service-only.** Writes go through `EntityServiceRegistry.get(type)`, i.e. the
 *    AbstractService, never the repository — so the host application's side effects
 *    (audit log, knowledge-graph chunking, cache invalidation) all fire. No Cypher
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
        .describe("Field values keyed by field name. Call describe_entity first to learn the valid field names."),
      relationships: z
        .record(z.string(), z.string())
        .optional()
        .describe("Related record ids keyed by relationship name, for relationships declared on this type."),
    });

    const updateSchema = z.object({
      type: typeField,
      id: z.string().describe("Id of the record to update."),
      fields: z.record(z.string(), z.any()).describe("Only the field values that change. Others are left untouched."),
    });

    const deleteSchema = z.object({
      type: typeField,
      id: z.string().describe("Id of the record to delete."),
    });

    const linkSchema = z.object({
      type: typeField,
      id: z.string().describe("Id of the record whose relationship changes."),
      relationship: z.string().describe("Relationship name as reported by describe_entity."),
      targetIds: z.array(z.string()).describe("Ids of the related records."),
    });

    return [
      {
        tool: new DynamicStructuredTool({
          name: "create_entity",
          description: `Creates one new record. Writable types: ${types}. This action requires user approval before it runs.`,
          schema: createSchema,
          func: async (input: z.infer<typeof createSchema>) =>
            JSON.stringify(await this.createEntity(input as CreateEntityInput, ctx, recorder)),
        }),
        destructive: true,
        summarise: (args) => this.summariseCreate(args),
      },
      {
        tool: new DynamicStructuredTool({
          name: "update_entity",
          description: `Updates the given fields of one existing record, leaving every other field untouched. Writable types: ${types}. This action requires user approval before it runs.`,
          schema: updateSchema,
          func: async (input: z.infer<typeof updateSchema>) =>
            JSON.stringify(await this.updateEntity(input as UpdateEntityInput, ctx, recorder)),
        }),
        destructive: true,
        summarise: (args) => this.summariseUpdate(args),
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
        summarise: (args) => this.summariseDelete(args),
      },
      {
        tool: new DynamicStructuredTool({
          name: "link_entities",
          description: `Adds related records to one relationship of an existing record. Writable types: ${types}. This action requires user approval before it runs.`,
          schema: linkSchema,
          func: async (input: z.infer<typeof linkSchema>) =>
            JSON.stringify(await this.linkEntities(input as LinkEntitiesInput, ctx, recorder)),
        }),
        destructive: true,
        summarise: (args) => this.summariseLink(args, "Link"),
      },
      {
        tool: new DynamicStructuredTool({
          name: "unlink_entities",
          description: `Removes related records from one relationship of an existing record. Writable types: ${types}. This action requires user approval before it runs.`,
          schema: linkSchema,
          func: async (input: z.infer<typeof linkSchema>) =>
            JSON.stringify(await this.unlinkEntities(input as LinkEntitiesInput, ctx, recorder)),
        }),
        destructive: true,
        summarise: (args) => this.summariseLink(args, "Unlink"),
      },
    ];
  }

  async createEntity(input: CreateEntityInput, ctx: UserContext, recorder: ToolCallRecord[]): Promise<unknown> {
    return this.capture("create_entity", input as unknown as Record<string, unknown>, recorder, async () => {
      const entity = this.resolveWritable(input.type, ctx);
      if (isError(entity)) return entity;

      const fields = input.fields ?? {};
      const fieldError = this.validateFields(entity, fields);
      if (fieldError) return { error: fieldError };

      // The run's scope is authoritative: whatever the model supplied for the
      // scope relationship is discarded before validation and replaced below.
      const scopeKey = this.scopeKeyOf(entity);
      const relationships: Record<string, string> = { ...(input.relationships ?? {}) };
      if (scopeKey) delete relationships[scopeKey];

      const relationshipError = await this.validateRelationships(entity, relationships, ctx);
      if (relationshipError) return { error: relationshipError };

      const service = this.registry.get(entity.type);
      if (!service) return { error: `Service not available for "${entity.type}".` };

      const id = randomUUID();
      return this.dispatch(async () => {
        await service.create({
          id,
          ...fields,
          ...relationships,
          ...(scopeKey && ctx.scopeId ? { [scopeKey]: ctx.scopeId } : {}),
        });
        return { id, type: entity.type, created: true };
      });
    });
  }

  async updateEntity(input: UpdateEntityInput, ctx: UserContext, recorder: ToolCallRecord[]): Promise<unknown> {
    return this.capture("update_entity", input as unknown as Record<string, unknown>, recorder, async () => {
      const entity = this.resolveWritable(input.type, ctx);
      if (isError(entity)) return entity;

      const outOfScope = await this.requireInScope(entity.type, [input.id], ctx);
      if (outOfScope) return outOfScope;

      const fields = input.fields ?? {};
      const fieldError = this.validateFields(entity, fields);
      if (fieldError) return { error: fieldError };

      const service = this.registry.get(entity.type);
      if (!service) return { error: `Service not available for "${entity.type}".` };

      return this.dispatch(async () => {
        // patch, not put: only the named fields change. put would map every
        // descriptor relationship and treat the ones absent from the payload as
        // "delete all edges", silently stripping the record's relationships.
        await service.patch({ id: input.id, ...fields });
        return { id: input.id, type: entity.type, updated: true };
      });
    });
  }

  async deleteEntity(input: DeleteEntityInput, ctx: UserContext, recorder: ToolCallRecord[]): Promise<unknown> {
    return this.capture("delete_entity", input as unknown as Record<string, unknown>, recorder, async () => {
      const entity = this.resolveWritable(input.type, ctx);
      if (isError(entity)) return entity;

      const outOfScope = await this.requireInScope(entity.type, [input.id], ctx);
      if (outOfScope) return outOfScope;

      const service = this.registry.get(entity.type);
      if (!service) return { error: `Service not available for "${entity.type}".` };

      return this.dispatch(async () => {
        await service.delete({ id: input.id });
        return { id: input.id, type: entity.type, deleted: true };
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

  /** Reject any field the catalog does not declare, and any type mismatch. */
  private validateFields(entity: CatalogEntity, fields: Record<string, unknown>): string | null {
    const byName = new Map(entity.fields.map((field) => [field.name, field]));
    for (const [name, value] of Object.entries(fields)) {
      const definition = byName.get(name);
      if (!definition) {
        return `Field "${name}" is not available on ${entity.type}. Valid fields: [${entity.fields
          .map((field) => field.name)
          .join(", ")}].`;
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
    relationships: Record<string, string>,
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
   * A relationship the generic write path must never touch:
   * - reverse relationships are serialisation-only, with no edge on this side;
   * - polymorphic relationships are a read-only chat traversal: they carry no
   *   single target type, so there is nothing for the write path to resolve
   *   (`targetType` is the "*" placeholder, which no scope check can honour);
   * - the scope relationship is what confines the record to the run's root, so
   *   re-pointing it would move the record into another scope.
   */
  private rejectUnwritableRelationship(entity: CatalogEntity, relationship: CatalogRelationship): string | null {
    if (relationship.isReverse) {
      return `Relationship "${relationship.name}" on ${entity.type} is read-only and cannot be written.`;
    }
    if (relationship.polymorphic) {
      return `Relationship "${relationship.name}" on ${entity.type} is read-only and cannot be written.`;
    }
    if (relationship.name === this.scopeKeyOf(entity)) {
      return `Relationship "${relationship.name}" on ${entity.type} cannot be changed.`;
    }
    return null;
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
   * The scope chain is guaranteed to be exactly one hop for writable types — the
   * catalog rejects deeper writables at boot — so the first hop's key is the
   * relationship that pins a new record to the run's scope root.
   */
  private scopeKeyOf(entity: CatalogEntity): string | undefined {
    return entity.scope?.path[0]?.key;
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
    const entity = this.resolveWritable(input.type, ctx);
    if (isError(entity)) return entity;

    const relationship = entity.relationships.find((candidate) => candidate.name === input.relationship);
    if (!relationship) {
      return {
        error: `Relationship "${input.relationship}" is not available on ${entity.type}. Valid relationships: [${entity.relationships
          .map((candidate) => candidate.name)
          .join(", ")}].`,
      };
    }
    const rejection = this.rejectUnwritableRelationship(entity, relationship);
    if (rejection) return { error: rejection };

    const targetIds = (input.targetIds ?? []).map((id) => String(id));
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

    const outOfScope =
      (await this.requireInScope(entity.type, [input.id], ctx)) ??
      (await this.requireInScope(relationship.targetType, targetIds, ctx));
    if (outOfScope) return outOfScope;

    const service = this.registry.get(entity.type);
    if (!service) return { error: `Service not available for "${entity.type}".` };

    return this.dispatch(async () => {
      if (relationship.cardinality === "one") {
        // The framework's add/remove relationship helpers are to-many only, so a
        // to-one edge is repointed with patch, which replaces the single edge.
        await service.patch({ id: input.id, [relationship.name]: targetIds });
      } else if (mode === "link") {
        await service.addToRelationshipFromDTO({
          id: input.id,
          relationship: relationship.name,
          data: targetIds.map((id) => ({ id, type: relationship.targetType })),
        });
      } else {
        await service.removeFromRelationshipFromDTO({
          id: input.id,
          relationship: relationship.name,
          data: targetIds.map((id) => ({ id, type: relationship.targetType })),
        });
      }

      return { id: input.id, type: entity.type, relationship: relationship.name, targetIds, [mode + "ed"]: true };
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
  // Approval-card summaries
  //
  // These are rendered to the user before the action runs. They stay generic:
  // nothing beyond the tool's own arguments is named.
  // ---------------------------------------------------------------------------

  private summariseCreate(args: Record<string, unknown>): string {
    const type = this.summariseType(args);
    const label = this.summariseLabel(args.fields);
    return label ? `Create a new ${type} record named "${label}".` : `Create a new ${type} record.`;
  }

  private summariseUpdate(args: Record<string, unknown>): string {
    const type = this.summariseType(args);
    const fields = args.fields && typeof args.fields === "object" ? Object.keys(args.fields as object) : [];
    const changed = fields.length ? ` (${fields.join(", ")})` : "";
    return `Update the ${type} record ${this.summariseId(args)}${changed}.`;
  }

  private summariseDelete(args: Record<string, unknown>): string {
    return `Delete the ${this.summariseType(args)} record ${this.summariseId(args)}.`;
  }

  private summariseLink(args: Record<string, unknown>, verb: "Link" | "Unlink"): string {
    const count = Array.isArray(args.targetIds) ? args.targetIds.length : 0;
    const relationship = typeof args.relationship === "string" ? args.relationship : "related";
    const preposition = verb === "Link" ? "to" : "from";
    return `${verb} ${count} record(s) ${preposition} the "${relationship}" relationship of the ${this.summariseType(
      args,
    )} record ${this.summariseId(args)}.`;
  }

  private summariseType(args: Record<string, unknown>): string {
    return typeof args.type === "string" && args.type ? args.type : "record";
  }

  private summariseId(args: Record<string, unknown>): string {
    return typeof args.id === "string" && args.id ? args.id : "(unknown id)";
  }

  private summariseLabel(fields: unknown): string | undefined {
    if (!fields || typeof fields !== "object") return undefined;
    const candidate = (fields as Record<string, unknown>).name ?? (fields as Record<string, unknown>).title;
    return typeof candidate === "string" && candidate ? candidate : undefined;
  }
}
