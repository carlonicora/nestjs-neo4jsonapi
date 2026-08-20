import { Injectable, Logger } from "@nestjs/common";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
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
 */
@Injectable()
export class ScopeGuard {
  private readonly logger = new Logger(ScopeGuard.name);

  constructor(
    private readonly catalog: GraphCatalogService,
    private readonly neo4j: Neo4jService,
  ) {}

  buildMatchClause(params: {
    entity: CatalogEntity;
    ctx: UserContext;
    nodeAlias: string;
  }): { cypher: string; params: Record<string, unknown> } | null {
    if (!params.ctx.scopeId || !params.ctx.scopeType) return null;
    const scope = params.entity.scope;
    if (!scope || scope.rootType !== params.ctx.scopeType) return null;

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
    const scope = entity?.scope;
    if (!entity || !scope || scope.rootType !== params.ctx.scopeType) {
      this.logger.warn(
        `filter: type "${params.type}" has no scope chain to "${params.ctx.scopeType}" — dropping ${params.records.length} record(s).`,
      );
      return [];
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

  /** `(alias)-[:REL]->(:Label)…-[:REL]->(:Root { id: $scopeId })` */
  private buildPattern(scope: NonNullable<CatalogEntity["scope"]>, alias: string): string {
    return buildScopePattern({ scope, alias, paramName: "scopeId" });
  }
}
