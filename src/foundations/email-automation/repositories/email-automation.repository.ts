import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { EmailAutomation, EmailAutomationDescriptor } from "../entities/email-automation";
import { emailAutomationEnrollmentMeta } from "../entities/email-automation-enrollment.meta";
import { emailAutomationStepMeta } from "../entities/email-automation-step.meta";
import { emailAutomationMeta } from "../entities/email-automation.meta";

@Injectable()
export class EmailAutomationRepository extends AbstractRepository<
  EmailAutomation,
  typeof EmailAutomationDescriptor.relationships
> {
  protected readonly descriptor = EmailAutomationDescriptor;

  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  /**
   * Adds the computed counts (stepCount, activeCount, completedCount,
   * unsubscribedCount) to the default automation + steps return.
   */
  protected buildReturnStatement(): string {
    const { nodeName } = emailAutomationMeta;

    return `
      CALL {
        WITH ${nodeName}
        OPTIONAL MATCH (${nodeName})-[:HAS_STEP]->(countedStep:${emailAutomationStepMeta.labelName})
        RETURN count(countedStep) AS stepCount
      }
      CALL {
        WITH ${nodeName}
        OPTIONAL MATCH (${nodeName})-[:HAS_ENROLLMENT]->(countedEnrollment:${emailAutomationEnrollmentMeta.labelName})
        RETURN count(CASE WHEN countedEnrollment.status = "active" THEN 1 END) AS activeCount,
          count(CASE WHEN countedEnrollment.status = "completed" THEN 1 END) AS completedCount,
          count(CASE WHEN countedEnrollment.status = "unsubscribed" THEN 1 END) AS unsubscribedCount
      }
      OPTIONAL MATCH (${nodeName})-[:HAS_STEP]->(${nodeName}_steps:${emailAutomationStepMeta.labelName})
      RETURN ${nodeName},
        ${nodeName}_steps,
        stepCount,
        activeCount,
        completedCount,
        unsubscribedCount
    `;
  }

  /**
   * Active automations a trigger enrols people into, oldest first.
   */
  async findActiveByTrigger(params: { trigger: string }): Promise<EmailAutomation[]> {
    const { nodeName } = emailAutomationMeta;
    const query = this.neo4j.initQuery({ serialiser: EmailAutomationDescriptor.model });

    query.queryParams = { ...query.queryParams, trigger: params.trigger };

    query.query += `
      ${this.buildDefaultMatch()}
      WHERE ${nodeName}.isActive = true AND ${nodeName}.trigger = $trigger
      WITH ${nodeName}
      ORDER BY ${nodeName}.createdAt ASC
      ${this.buildReturnStatement()}
    `;

    return this.neo4j.readMany(query);
  }

  /**
   * Active automations a trigger takes people out of.
   */
  async findActiveByExitTrigger(params: { exitTrigger: string }): Promise<EmailAutomation[]> {
    const { nodeName } = emailAutomationMeta;
    const query = this.neo4j.initQuery({ serialiser: EmailAutomationDescriptor.model });

    query.queryParams = { ...query.queryParams, exitTrigger: params.exitTrigger };

    query.query += `
      ${this.buildDefaultMatch()}
      WHERE ${nodeName}.isActive = true AND ${nodeName}.exitTrigger = $exitTrigger
      WITH ${nodeName}
      ORDER BY ${nodeName}.createdAt ASC
      ${this.buildReturnStatement()}
    `;

    return this.neo4j.readMany(query);
  }
}
