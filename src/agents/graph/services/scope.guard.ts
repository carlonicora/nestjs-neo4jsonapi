import { Injectable, Logger } from "@nestjs/common";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { EntityServiceRegistry } from "../../../common/registries/entity.service.registry";
import type { ExternalEntitySource } from "../../../common/interfaces/external.entity.source.interface";
import { CatalogEntity } from "../interfaces/graph.catalog.interface";
import { GraphCatalogService } from "./graph.catalog.service";
import { buildScopePattern } from "./scope.pattern";
import { UserContext } from "../tools/tool.factory";

/**
 * Single place a scope predicate is built or applied. Every agent data-access
 * point routes through here so "which campaign is this run confined to" has
 * exactly one answer.
 *
 * Fail-closed rule: in a scoped run, a type with no compiled scope chain is
 * treated as OUT of scope. The alternative — treating it as universally
 * visible — is a cross-scope leak, which is the whole failure this service
 * exists to prevent.
 *
 * Exception: a `scopeShared` type is reference data (laws, tariffs, …) and is
 * visible in every scoped run, whatever the root. It is passed through with no
 * constraint. Chunk scoping (`ScopePredicateService`) does NOT apply this
 * exception and stays strict.
 *
 * A `chat.scopeByService` type (`scope.viaService`) has no scope edge in the
 * app database: its own service decides membership through
 * `ExternalEntitySource.filterInScope`. No Cypher clause exists for it, and a
 * service without that hook keeps nothing (fail closed).
 */
@Injectable()
export class ScopeGuard {
  private readonly logger = new Logger(ScopeGuard.name);

  constructor(
    private readonly catalog: GraphCatalogService,
    private readonly neo4j: Neo4jService,
    /**
     * Optional in the TYPE signature only, so unit tests can construct the guard
     * without it. Nest resolves it (CoreModule exports it globally). Without it a
     * `viaService` type keeps nothing.
     */
    private readonly registry?: EntityServiceRegistry,
  ) {}

  buildMatchClause(params: {
    entity: CatalogEntity;
    ctx: UserContext;
    nodeAlias: string;
  }): { cypher: string; params: Record<string, unknown> } | null {
    if (!params.ctx.scopeId || !params.ctx.scopeType) return null;
    // Shared reference data: no constraint (empty clause), NOT out of scope.
    if (params.entity.scopeShared) return { cypher: "", params: {} };
    const scope = params.entity.scope;
    if (!scope || scope.rootType !== params.ctx.scopeType) return null;
    // Scope decided by the type's service: there is no Cypher clause for it.
    // The caller must post-filter through `filter`.
    if (scope.viaService) return null;

    const pattern = this.buildPattern(scope, params.nodeAlias);
    return {
      cypher: `AND EXISTS { MATCH ${pattern} }`,
      params: { scopeId: params.ctx.scopeId },
    };
  }

  async isInScope(params: { type: string; id: string; ctx: UserContext }): Promise<boolean> {
    const kept = await this.filter({ type: params.type, records: [{ id: params.id }], ctx: params.ctx });
    return kept.length === 1;
  }

  async filter<T extends { id: string }>(params: { type: string; records: T[]; ctx: UserContext }): Promise<T[]> {
    if (!params.ctx.scopeId || !params.ctx.scopeType) return params.records;
    if (params.records.length === 0) return params.records;

    const entity = this.catalog.getEntityDetail(params.type, params.ctx.userModuleIds);
    // Shared reference data is visible in every scoped run: no query needed.
    if (entity?.scopeShared) return params.records;
    const scope = entity?.scope;
    if (!entity || !scope || scope.rootType !== params.ctx.scopeType) {
      this.logger.warn(
        `filter: type "${params.type}" has no scope chain to "${params.ctx.scopeType}" — dropping ${params.records.length} record(s).`,
      );
      return [];
    }

    if (scope.viaService) {
      return this.filterViaService({ type: params.type, records: params.records, ctx: params.ctx });
    }

    if (scope.path.length === 0) {
      // The entity IS the root: it is in scope iff it is the scope root itself.
      return params.records.filter((record) => record.id === params.ctx.scopeId);
    }

    const pattern = this.buildPattern(scope, "node");
    const result = await this.neo4j.read(
      `
      MATCH (node:${entity.labelName})
      WHERE node.id IN $ids
        AND EXISTS { MATCH ${pattern} }
      RETURN node.id AS id
      `,
      { ids: params.records.map((record) => record.id), scopeId: params.ctx.scopeId },
    );

    const allowed = new Set<string>(((result as any).records ?? []).map((row: any) => row.get("id")));
    return params.records.filter((record) => allowed.has(record.id));
  }

  /**
   * `chat.scopeByService`: delegate to the type's `filterInScope`. Keeps the
   * returned ids only, in the input order. A service without the hook keeps
   * nothing.
   */
  private async filterViaService<T extends { id: string }>(params: {
    type: string;
    records: T[];
    ctx: UserContext;
  }): Promise<T[]> {
    const service = this.registry?.get(params.type) as unknown as Partial<ExternalEntitySource> | undefined;
    if (typeof service?.filterInScope !== "function") {
      this.logger.warn(
        `filter: type "${params.type}" is scoped by its service, which does not implement filterInScope — dropping ${params.records.length} record(s).`,
      );
      return [];
    }
    const allowedIds = await service.filterInScope({
      ids: params.records.map((record) => record.id),
      scopeType: params.ctx.scopeType!,
      scopeId: params.ctx.scopeId!,
    });
    const allowed = new Set<string>(allowedIds);
    return params.records.filter((record) => allowed.has(record.id));
  }

  /** `(alias)-[:REL]->(:Label)…-[:REL]->(:Root { id: $scopeId })` */
  private buildPattern(scope: NonNullable<CatalogEntity["scope"]>, alias: string): string {
    return buildScopePattern({ scope, alias, paramName: "scopeId" });
  }
}
