import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { JsonApiCursorInterface } from "../../../core/jsonapi/interfaces/jsonapi.cursor.interface";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import {
  EmailAutomationEnrollment,
  EmailAutomationEnrollmentDescriptor,
  EmailAutomationEnrollmentStatus,
} from "../entities/email-automation-enrollment";
import { emailAutomationEnrollmentMeta } from "../entities/email-automation-enrollment.meta";
import { emailAutomationStepMeta } from "../entities/email-automation-step.meta";
import { emailAutomationMeta } from "../entities/email-automation.meta";
import { EmailAutomationRecipient } from "../interfaces/email-automation.config.interface";

@Injectable()
export class EmailAutomationEnrollmentRepository extends AbstractRepository<
  EmailAutomationEnrollment,
  typeof EmailAutomationEnrollmentDescriptor.relationships
> {
  protected readonly descriptor = EmailAutomationEnrollmentDescriptor;

  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  /**
   * Enrolment + automation + current step, with the current step's subject
   * (`currentStepSubject`) and the number of steps sent (`sentCount`). The SENT
   * steps themselves are not returned: the count is what every reader needs.
   */
  protected buildReturnStatement(): string {
    const { nodeName } = emailAutomationEnrollmentMeta;
    const automationAlias = `${nodeName}_automation`;
    const currentStepAlias = `${nodeName}_currentStep`;

    return `
      MATCH (${nodeName})<-[:HAS_ENROLLMENT]-(${automationAlias}:${emailAutomationMeta.labelName})
      OPTIONAL MATCH (${nodeName})-[:AT_STEP]->(${currentStepAlias}:${emailAutomationStepMeta.labelName})
      CALL {
        WITH ${nodeName}
        OPTIONAL MATCH (${nodeName})-[sentEdge:SENT]->(:${emailAutomationStepMeta.labelName})
        RETURN count(sentEdge) AS sentCount
      }
      RETURN ${nodeName},
        ${automationAlias},
        ${currentStepAlias},
        ${currentStepAlias}.subject AS currentStepSubject,
        sentCount
    `;
  }

  /**
   * Creates an active enrolment of `recipient` in an automation, waiting on `stepId`.
   */
  async createEnrollment(params: {
    id: string;
    automationId: string;
    stepId: string;
    recipient: EmailAutomationRecipient;
    enrolledAt: Date;
    nextSendAt: Date;
    unsubscribeToken: string;
  }): Promise<void> {
    const { nodeName, labelName } = emailAutomationEnrollmentMeta;
    const query = this.neo4j.initQuery();

    query.queryParams = {
      ...query.queryParams,
      id: params.id,
      automationId: params.automationId,
      stepId: params.stepId,
      email: params.recipient.email,
      name: params.recipient.name ?? null,
      recipientType: params.recipient.recipientType,
      recipientId: params.recipient.recipientId,
      status: "active" satisfies EmailAutomationEnrollmentStatus,
      enrolledAt: params.enrolledAt.toISOString(),
      nextSendAt: params.nextSendAt.toISOString(),
      unsubscribeToken: params.unsubscribeToken,
    };

    query.query += `
      MATCH (${nodeName}_automation:${emailAutomationMeta.labelName} {id: $automationId})
      MATCH (${nodeName}_step:${emailAutomationStepMeta.labelName} {id: $stepId})
      CREATE (${nodeName}:${labelName} {
        id: $id,
        email: $email,
        name: $name,
        recipientType: $recipientType,
        recipientId: $recipientId,
        status: $status,
        attempts: 0,
        enrolledAt: datetime($enrolledAt),
        nextSendAt: datetime($nextSendAt),
        unsubscribeToken: $unsubscribeToken,
        createdAt: datetime(),
        updatedAt: datetime()
      })
      CREATE (${nodeName}_automation)-[:HAS_ENROLLMENT]->(${nodeName})
      CREATE (${nodeName})-[:AT_STEP]->(${nodeName}_step)
    `;

    await this.neo4j.writeOne(query);
  }

  /**
   * The enrolment of an email in an automation, whatever its status (latest first).
   */
  async findByAutomationAndEmail(params: {
    automationId: string;
    email: string;
  }): Promise<EmailAutomationEnrollment | null> {
    const { nodeName } = emailAutomationEnrollmentMeta;
    const query = this.neo4j.initQuery({ serialiser: EmailAutomationEnrollmentDescriptor.model });

    query.queryParams = {
      ...query.queryParams,
      automationId: params.automationId,
      email: params.email.toLowerCase(),
    };

    query.query += `
      ${this.buildDefaultMatch()}
      WHERE toLower(${nodeName}.email) = $email
      AND EXISTS {
        MATCH (${nodeName})<-[:HAS_ENROLLMENT]-(:${emailAutomationMeta.labelName} {id: $automationId})
      }
      WITH ${nodeName}
      ORDER BY ${nodeName}.enrolledAt DESC
      LIMIT 1
      ${this.buildReturnStatement()}
    `;

    return this.neo4j.readOne(query);
  }

  /**
   * Every active enrolment of an email, in any automation.
   */
  async findActiveByEmail(params: { email: string }): Promise<EmailAutomationEnrollment[]> {
    const { nodeName } = emailAutomationEnrollmentMeta;
    const query = this.neo4j.initQuery({ serialiser: EmailAutomationEnrollmentDescriptor.model });

    query.queryParams = {
      ...query.queryParams,
      email: params.email.toLowerCase(),
      status: "active" satisfies EmailAutomationEnrollmentStatus,
    };

    query.query += `
      ${this.buildDefaultMatch()}
      WHERE toLower(${nodeName}.email) = $email AND ${nodeName}.status = $status
      WITH ${nodeName}
      ${this.buildReturnStatement()}
    `;

    return this.neo4j.readMany(query);
  }

  /**
   * The active enrolments of an email in one automation.
   */
  async findActiveByEmailAndAutomation(params: {
    email: string;
    automationId: string;
  }): Promise<EmailAutomationEnrollment[]> {
    const { nodeName } = emailAutomationEnrollmentMeta;
    const query = this.neo4j.initQuery({ serialiser: EmailAutomationEnrollmentDescriptor.model });

    query.queryParams = {
      ...query.queryParams,
      email: params.email.toLowerCase(),
      automationId: params.automationId,
      status: "active" satisfies EmailAutomationEnrollmentStatus,
    };

    query.query += `
      ${this.buildDefaultMatch()}
      WHERE toLower(${nodeName}.email) = $email AND ${nodeName}.status = $status
      AND EXISTS {
        MATCH (${nodeName})<-[:HAS_ENROLLMENT]-(:${emailAutomationMeta.labelName} {id: $automationId})
      }
      WITH ${nodeName}
      ${this.buildReturnStatement()}
    `;

    return this.neo4j.readMany(query);
  }

  /**
   * The enrolment an unsubscribe link belongs to.
   */
  async findByUnsubscribeToken(params: { token: string }): Promise<EmailAutomationEnrollment | null> {
    const query = this.neo4j.initQuery({ serialiser: EmailAutomationEnrollmentDescriptor.model });

    query.queryParams = { ...query.queryParams, searchValue: params.token };

    query.query += `
      ${this.buildDefaultMatch({ searchField: "unsubscribeToken" })}
      ${this.buildReturnStatement()}
    `;

    return this.neo4j.readOne(query);
  }

  /**
   * Bounded worker query: active enrolments whose next send is due, in active
   * automations, oldest due first. Automation and current step are included.
   */
  async findDue(params: { now: Date; limit: number }): Promise<EmailAutomationEnrollment[]> {
    const { nodeName } = emailAutomationEnrollmentMeta;
    const query = this.neo4j.initQuery({ serialiser: EmailAutomationEnrollmentDescriptor.model });

    query.queryParams = {
      ...query.queryParams,
      now: params.now.toISOString(),
      limit: params.limit,
      status: "active" satisfies EmailAutomationEnrollmentStatus,
    };

    query.query += `
      ${this.buildDefaultMatch()}
      WHERE ${nodeName}.status = $status
      AND ${nodeName}.nextSendAt <= datetime($now)
      AND EXISTS {
        MATCH (${nodeName})<-[:HAS_ENROLLMENT]-(${emailAutomationMeta.nodeName}:${emailAutomationMeta.labelName})
        WHERE ${emailAutomationMeta.nodeName}.isActive = true
      }
      WITH ${nodeName}
      ORDER BY ${nodeName}.nextSendAt ASC
      LIMIT toInteger($limit)
      ${this.buildReturnStatement()}
    `;

    return this.neo4j.readMany(query);
  }

  /**
   * Whether the enrolment already received the step (a SENT edge exists).
   */
  async hasSent(params: { enrollmentId: string; stepId: string }): Promise<boolean> {
    const { nodeName } = emailAutomationEnrollmentMeta;
    const query = this.neo4j.initQuery({ serialiser: EmailAutomationEnrollmentDescriptor.model });

    query.queryParams = { ...query.queryParams, searchValue: params.enrollmentId, stepId: params.stepId };

    query.query += `
      ${this.buildDefaultMatch({ searchField: "id" })}
      WHERE EXISTS {
        MATCH (${nodeName})-[:SENT]->(:${emailAutomationStepMeta.labelName} {id: $stepId})
      }
      WITH ${nodeName}
      ${this.buildReturnStatement()}
    `;

    return !!(await this.neo4j.readOne(query));
  }

  /**
   * Records that the step was sent and resets the failure counters.
   */
  async markSent(params: { enrollmentId: string; stepId: string; sentAt: Date }): Promise<void> {
    const { nodeName, labelName } = emailAutomationEnrollmentMeta;
    const query = this.neo4j.initQuery();

    query.queryParams = {
      ...query.queryParams,
      enrollmentId: params.enrollmentId,
      stepId: params.stepId,
      sentAt: params.sentAt.toISOString(),
    };

    query.query += `
      MATCH (${nodeName}:${labelName} {id: $enrollmentId})
      MATCH (${nodeName}_step:${emailAutomationStepMeta.labelName} {id: $stepId})
      MERGE (${nodeName})-[sentEdge:SENT]->(${nodeName}_step)
      SET sentEdge.sentAt = datetime($sentAt),
          ${nodeName}.attempts = 0,
          ${nodeName}.lastError = null,
          ${nodeName}.updatedAt = datetime()
    `;

    await this.neo4j.writeOne(query);
  }

  /**
   * Moves the enrolment to the next step and schedules it.
   */
  async advance(params: { enrollmentId: string; nextStepId: string; nextSendAt: Date }): Promise<void> {
    const { nodeName, labelName } = emailAutomationEnrollmentMeta;
    const query = this.neo4j.initQuery();

    query.queryParams = {
      ...query.queryParams,
      enrollmentId: params.enrollmentId,
      nextStepId: params.nextStepId,
      nextSendAt: params.nextSendAt.toISOString(),
    };

    query.query += `
      MATCH (${nodeName}:${labelName} {id: $enrollmentId})
      OPTIONAL MATCH (${nodeName})-[currentStep:AT_STEP]->()
      DELETE currentStep
      WITH DISTINCT ${nodeName}
      MATCH (${nodeName}_next:${emailAutomationStepMeta.labelName} {id: $nextStepId})
      CREATE (${nodeName})-[:AT_STEP]->(${nodeName}_next)
      SET ${nodeName}.nextSendAt = datetime($nextSendAt),
          ${nodeName}.updatedAt = datetime()
    `;

    await this.neo4j.writeOne(query);
  }

  /**
   * Ends the enrolment: no current step, no next send.
   */
  async finish(params: {
    enrollmentId: string;
    status: "completed" | "unsubscribed" | "exited" | "failed";
    finishedAt: Date;
  }): Promise<void> {
    const { nodeName, labelName } = emailAutomationEnrollmentMeta;
    const query = this.neo4j.initQuery();

    query.queryParams = {
      ...query.queryParams,
      enrollmentId: params.enrollmentId,
      status: params.status,
      finishedAt: params.finishedAt.toISOString(),
    };

    query.query += `
      MATCH (${nodeName}:${labelName} {id: $enrollmentId})
      OPTIONAL MATCH (${nodeName})-[currentStep:AT_STEP]->()
      DELETE currentStep
      WITH DISTINCT ${nodeName}
      SET ${nodeName}.status = $status,
          ${nodeName}.nextSendAt = null,
          ${nodeName}.finishedAt = datetime($finishedAt),
          ${nodeName}.updatedAt = datetime()
    `;

    await this.neo4j.writeOne(query);
  }

  /**
   * Counts a failed send and schedules the retry.
   */
  async recordFailure(params: { enrollmentId: string; error: string; nextSendAt: Date }): Promise<void> {
    const { nodeName, labelName } = emailAutomationEnrollmentMeta;
    const query = this.neo4j.initQuery();

    query.queryParams = {
      ...query.queryParams,
      enrollmentId: params.enrollmentId,
      error: params.error,
      nextSendAt: params.nextSendAt.toISOString(),
    };

    query.query += `
      MATCH (${nodeName}:${labelName} {id: $enrollmentId})
      SET ${nodeName}.attempts = coalesce(${nodeName}.attempts, 0) + 1,
          ${nodeName}.lastError = $error,
          ${nodeName}.nextSendAt = datetime($nextSendAt),
          ${nodeName}.updatedAt = datetime()
    `;

    await this.neo4j.writeOne(query);
  }

  /**
   * Moves every active enrolment waiting on `fromStepId` to `toStepId`; with no
   * successor (`toStepId` null) those enrolments are completed instead.
   */
  async repointStep(params: { fromStepId: string; toStepId: string | null; finishedAt: Date }): Promise<void> {
    const { nodeName, labelName } = emailAutomationEnrollmentMeta;
    const stepLabel = emailAutomationStepMeta.labelName;
    const query = this.neo4j.initQuery();

    query.queryParams = {
      ...query.queryParams,
      fromStepId: params.fromStepId,
      toStepId: params.toStepId,
      activeStatus: "active" satisfies EmailAutomationEnrollmentStatus,
      completedStatus: "completed" satisfies EmailAutomationEnrollmentStatus,
      finishedAt: params.finishedAt.toISOString(),
    };

    if (params.toStepId) {
      query.query += `
      MATCH (:${stepLabel} {id: $fromStepId})<-[currentStep:AT_STEP]-(${nodeName}:${labelName} {status: $activeStatus})
      MATCH (${nodeName}_next:${stepLabel} {id: $toStepId})
      DELETE currentStep
      CREATE (${nodeName})-[:AT_STEP]->(${nodeName}_next)
      SET ${nodeName}.updatedAt = datetime()
    `;
    } else {
      query.query += `
      MATCH (:${stepLabel} {id: $fromStepId})<-[currentStep:AT_STEP]-(${nodeName}:${labelName} {status: $activeStatus})
      DELETE currentStep
      SET ${nodeName}.status = $completedStatus,
          ${nodeName}.nextSendAt = null,
          ${nodeName}.finishedAt = datetime($finishedAt),
          ${nodeName}.updatedAt = datetime()
    `;
    }

    await this.neo4j.writeOne(query);
  }

  /**
   * The enrolments of an automation, newest first, optionally filtered by status.
   */
  async findByAutomation(params: {
    automationId: string;
    status?: string;
    cursor: JsonApiCursorInterface;
  }): Promise<EmailAutomationEnrollment[]> {
    const { nodeName } = emailAutomationEnrollmentMeta;
    const query = this.neo4j.initQuery({
      serialiser: EmailAutomationEnrollmentDescriptor.model,
      cursor: params.cursor,
    });

    const statusFilter = params.status ? `AND ${nodeName}.status = $status` : "";

    query.queryParams = {
      ...query.queryParams,
      automationId: params.automationId,
      status: params.status ?? null,
    };

    query.query += `
      ${this.buildDefaultMatch()}
      WHERE EXISTS {
        MATCH (${nodeName})<-[:HAS_ENROLLMENT]-(:${emailAutomationMeta.labelName} {id: $automationId})
      }
      ${statusFilter}
      WITH ${nodeName}
      ORDER BY ${nodeName}.enrolledAt DESC
      {CURSOR}
      ${this.buildReturnStatement()}
    `;

    return this.neo4j.readMany(query);
  }
}
