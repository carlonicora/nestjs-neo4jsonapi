import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { emailAutomationEnrollmentMeta } from "../entities/email-automation-enrollment.meta";
import { EmailAutomationStep, EmailAutomationStepDescriptor } from "../entities/email-automation-step";
import { emailAutomationStepMeta } from "../entities/email-automation-step.meta";
import { emailAutomationMeta } from "../entities/email-automation.meta";

@Injectable()
export class EmailAutomationStepRepository extends AbstractRepository<
  EmailAutomationStep,
  typeof EmailAutomationStepDescriptor.relationships
> {
  protected readonly descriptor = EmailAutomationStepDescriptor;

  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  /**
   * Step + automation + next step, with the number of enrolments that received
   * the step (`sentCount`) and the same count for the included next step
   * (`<alias>_sentCount`, read by the descriptor's computed field).
   */
  protected buildReturnStatement(): string {
    const { nodeName } = emailAutomationStepMeta;
    const automationAlias = `${nodeName}_automation`;
    const nextAlias = `${nodeName}_next`;

    return `
      MATCH (${nodeName})<-[:HAS_STEP]-(${automationAlias}:${emailAutomationMeta.labelName})
      OPTIONAL MATCH (${nodeName})-[:NEXT]->(${nextAlias}:${emailAutomationStepMeta.labelName})
      CALL {
        WITH ${nodeName}
        OPTIONAL MATCH (${nodeName})<-[sentEdge:SENT]-(:${emailAutomationEnrollmentMeta.labelName})
        RETURN count(sentEdge) AS sentCount
      }
      CALL {
        WITH ${nextAlias}
        OPTIONAL MATCH (${nextAlias})<-[nextSentEdge:SENT]-(:${emailAutomationEnrollmentMeta.labelName})
        RETURN count(nextSentEdge) AS ${nextAlias}_sentCount
      }
      RETURN ${nodeName},
        ${automationAlias},
        ${nextAlias},
        sentCount,
        ${nextAlias}_sentCount
    `;
  }

  /**
   * Every step of an automation, oldest first, with its `next` step included.
   */
  async findByAutomation(params: { automationId: string }): Promise<EmailAutomationStep[]> {
    const { nodeName } = emailAutomationStepMeta;
    const query = this.neo4j.initQuery({ serialiser: EmailAutomationStepDescriptor.model });

    query.queryParams = { ...query.queryParams, automationId: params.automationId };

    query.query += `
      ${this.buildDefaultMatch()}
      WHERE EXISTS {
        MATCH (${nodeName})<-[:HAS_STEP]-(:${emailAutomationMeta.labelName} {id: $automationId})
      }
      WITH ${nodeName}
      ORDER BY ${nodeName}.createdAt ASC
      ${this.buildReturnStatement()}
    `;

    return this.neo4j.readMany(query);
  }

  /**
   * The first step of an automation: no incoming NEXT, oldest first.
   */
  async findHead(params: { automationId: string }): Promise<EmailAutomationStep | null> {
    const { nodeName, labelName } = emailAutomationStepMeta;
    const query = this.neo4j.initQuery({ serialiser: EmailAutomationStepDescriptor.model });

    query.queryParams = { ...query.queryParams, automationId: params.automationId };

    query.query += `
      ${this.buildDefaultMatch()}
      WHERE EXISTS {
        MATCH (${nodeName})<-[:HAS_STEP]-(:${emailAutomationMeta.labelName} {id: $automationId})
      }
      AND NOT EXISTS {
        MATCH (:${labelName})-[:NEXT]->(${nodeName})
      }
      WITH ${nodeName}
      ORDER BY ${nodeName}.createdAt ASC
      LIMIT 1
      ${this.buildReturnStatement()}
    `;

    return this.neo4j.readOne(query);
  }

  /**
   * Replaces the outgoing NEXT link of a step; `nextStepId` null only removes it.
   */
  async setNext(params: { stepId: string; nextStepId: string | null }): Promise<void> {
    const { nodeName, labelName } = emailAutomationStepMeta;
    const query = this.neo4j.initQuery();

    query.queryParams = { ...query.queryParams, stepId: params.stepId, nextStepId: params.nextStepId };

    query.query += `
      MATCH (${nodeName}:${labelName} {id: $stepId})
      OPTIONAL MATCH (${nodeName})-[existingNext:NEXT]->()
      DELETE existingNext
      WITH DISTINCT ${nodeName}
      SET ${nodeName}.updatedAt = datetime()
    `;

    if (params.nextStepId) {
      query.query += `
      WITH ${nodeName}
      MATCH (${nodeName}_next:${labelName} {id: $nextStepId})
      MERGE (${nodeName})-[:NEXT]->(${nodeName}_next)
    `;
    }

    await this.neo4j.writeOne(query);
  }

  /**
   * The step whose NEXT points at `stepId`.
   */
  async findPrevious(params: { stepId: string }): Promise<EmailAutomationStep | null> {
    const { nodeName, labelName } = emailAutomationStepMeta;
    const query = this.neo4j.initQuery({ serialiser: EmailAutomationStepDescriptor.model });

    query.queryParams = { ...query.queryParams, stepId: params.stepId };

    query.query += `
      ${this.buildDefaultMatch()}
      WHERE EXISTS {
        MATCH (${nodeName})-[:NEXT]->(:${labelName} {id: $stepId})
      }
      WITH ${nodeName}
      ${this.buildReturnStatement()}
    `;

    return this.neo4j.readOne(query);
  }

  /**
   * Drops every manual canvas position of an automation's steps, so the canvas re-runs auto-layout.
   */
  async clearPositions(params: { automationId: string }): Promise<void> {
    const { nodeName, labelName } = emailAutomationStepMeta;
    const query = this.neo4j.initQuery();

    query.queryParams = { ...query.queryParams, automationId: params.automationId };

    query.query += `
      MATCH (:${emailAutomationMeta.labelName} {id: $automationId})-[:HAS_STEP]->(${nodeName}:${labelName})
      REMOVE ${nodeName}.positionX, ${nodeName}.positionY
      SET ${nodeName}.updatedAt = datetime()
    `;

    await this.neo4j.writeOne(query);
  }
}
