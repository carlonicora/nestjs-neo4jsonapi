import { Injectable, Logger } from "@nestjs/common";
import { ScopePredicateResult, ScopePredicateSource } from "../../../common/repositories/scope-predicate.source";
import { AgentScope } from "../../../common/types/agent.scope";
import { GraphCatalogService } from "./graph.catalog.service";
import { buildScopePattern } from "./scope.pattern";

/**
 * Turns the catalog's compiled scope chains into ONE boolean expression that
 * confines a node alias to the run's scope root.
 *
 * The expression is a union over labels, because the alias it guards is
 * untyped — retrieval binds `(data)` to any entity that owns chunks:
 *
 *   (
 *     (data:Root AND data.id = $agentScopeId)
 *     OR (data:Child AND EXISTS { MATCH (data)-[:PART_OF]->(:Root { id: $agentScopeId }) })
 *     …
 *   )
 *
 * FAIL-CLOSED, twice over:
 *  - a type with no chain to THIS root contributes no branch, so it can never
 *    match — the same ruling `ScopeGuard` already applies when it post-filters;
 *  - if no type at all can reach the root, `build` returns null and the caller
 *    must retrieve nothing rather than fall back to company-wide retrieval.
 */
@Injectable()
export class ScopePredicateService implements ScopePredicateSource {
  private readonly logger = new Logger(ScopePredicateService.name);

  constructor(private readonly catalog: GraphCatalogService) {}

  build(params: { alias: string; scope: AgentScope }): ScopePredicateResult | null {
    const branches: string[] = [];

    for (const entity of this.catalog.getAllEntities()) {
      const scope = entity.scope;
      if (!scope || scope.rootType !== params.scope.type) continue;

      if (scope.path.length === 0) {
        // The entity IS the root: in scope iff it is that exact node.
        branches.push(`(${params.alias}:${entity.labelName} AND ${params.alias}.id = $agentScopeId)`);
        continue;
      }

      const pattern = buildScopePattern({ scope, alias: params.alias, paramName: "agentScopeId" });
      branches.push(`(${params.alias}:${entity.labelName} AND EXISTS { MATCH ${pattern} })`);
    }

    if (branches.length === 0) {
      this.logger.warn(
        `build: no catalogued entity has a scope chain to root type "${params.scope.type}" — ` +
          `retrieval in this run is confined to nothing.`,
      );
      return null;
    }

    return {
      cypher: `(\n        ${branches.join("\n        OR ")}\n      )`,
      params: { agentScopeId: params.scope.id },
    };
  }
}
