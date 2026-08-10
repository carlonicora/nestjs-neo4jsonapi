import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { Assistant, AssistantDescriptor } from "../entities/assistant";

/**
 * AssistantRepository
 *
 * Extends the standard company-scoped match with an additional owner check —
 * a user can only see/modify assistants they created.
 *
 * The `$currentUserId` parameter is auto-injected into queryParams by
 * `Neo4jService.initQuery()` (reads `clsService.get("userId")`), so the
 * `buildUserHasAccess` override can reference `$currentUserId` directly.
 */
@Injectable()
export class AssistantRepository extends AbstractRepository<Assistant, typeof AssistantDescriptor.relationships> {
  protected readonly descriptor = AssistantDescriptor;

  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  protected buildUserHasAccess(): string {
    const { nodeName } = this.descriptor.model;
    return `WITH ${nodeName}
            WHERE EXISTS {
              MATCH (${nodeName})-[:CREATED_BY]->(:User {id: $currentUserId})
            }
            WITH ${nodeName}`;
  }

  /**
   * Attach the thread to the resource it is scoped to:
   * `(Assistant)-[:BOUND_TO]->(target)`.
   *
   * This cannot go through the generic create path. `BOUND_TO` is declared
   * polymorphic on the descriptor (any registered model may be the target), so
   * `relationships.content.model` is only a placeholder — `assistantMeta`.
   * `AbstractRepository.create` reads `rel.model.labelName` both to validate the
   * target exists (abstract.repository.ts:713) and to build the edge MATCH
   * (:822), so routing a Campaign id through it looks for
   * `(:Assistant { id: <campaign-uuid> })` and fails with "One or more related
   * nodes do not exist."
   *
   * The caller resolves the real label from the model registry, so the label
   * interpolated here is always a registered one and never user input. The id
   * stays parameterised.
   */
  async bindContent(params: { assistantId: string; targetLabel: string; targetId: string }): Promise<void> {
    await this.neo4j.writeOne({
      query: `
        MATCH (assistant:Assistant {id: $assistantId})
        MATCH (target:${params.targetLabel} {id: $targetId})
        MERGE (assistant)-[rel:BOUND_TO]->(target)
        SET rel.updatedAt = datetime()
      `,
      queryParams: { assistantId: params.assistantId, targetId: params.targetId },
    });
  }

  /**
   * Override delete to cascade through HAS_MESSAGE children so that
   * `AssistantMessage` nodes (and their REFERENCES edges) are removed with
   * the parent Assistant. DETACH DELETE drops every relationship incident to
   * the deleted nodes — including outgoing REFERENCES edges — without
   * affecting the referenced domain entities.
   */
  async delete(params: { id: string }): Promise<void> {
    await this.neo4j.writeOne({
      query: `
        MATCH (a:Assistant {id: $id})
        OPTIONAL MATCH (a)-[:HAS_MESSAGE]->(m:AssistantMessage)
        DETACH DELETE a, m
      `,
      queryParams: { id: params.id },
    });
  }
}
