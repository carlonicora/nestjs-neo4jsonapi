import { Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { ClsService } from "nestjs-cls";
import { JsonApiSingleDocument } from "../../../core/jsonapi/interfaces/jsonapi.document.interface";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AbstractService } from "../../../core/neo4j/abstracts/abstract.service";
import {
  EmailAutomationEnrollment,
  EmailAutomationEnrollmentDescriptor,
} from "../entities/email-automation-enrollment";
import { EmailAutomationEnrollmentRepository } from "../repositories/email-automation-enrollment.repository";
import { EmailOptOutRepository } from "../repositories/email-opt-out.repository";

@Injectable()
export class EmailAutomationUnsubscribeService extends AbstractService<
  EmailAutomationEnrollment,
  typeof EmailAutomationEnrollmentDescriptor.relationships
> {
  protected readonly descriptor = EmailAutomationEnrollmentDescriptor;

  constructor(
    jsonApiService: JsonApiService,
    private readonly enrollmentRepository: EmailAutomationEnrollmentRepository,
    clsService: ClsService,
    private readonly optOutRepository: EmailOptOutRepository,
  ) {
    super(jsonApiService, enrollmentRepository, clsService, EmailAutomationEnrollmentDescriptor.model);
  }

  /**
   * Stops the emails of one enrolment (`automation`) or every marketing email to its address (`all`).
   * Idempotent: a repeat call changes nothing and still answers with the enrolment.
   */
  async unsubscribe(params: {
    token: string;
    scope: "automation" | "all";
    source: "link" | "header";
  }): Promise<JsonApiSingleDocument> {
    const enrollment = await this.enrollmentRepository.findByUnsubscribeToken({ token: params.token });
    if (!enrollment) throw new NotFoundException("Invalid unsubscribe token");

    const now = new Date();

    if (enrollment.status === "active") {
      await this.enrollmentRepository.finish({ enrollmentId: enrollment.id, status: "unsubscribed", finishedAt: now });
    }

    if (params.scope === "all") {
      const activeEnrollments = await this.enrollmentRepository.findActiveByEmail({ email: enrollment.email });
      for (const active of activeEnrollments) {
        if (active.id === enrollment.id) continue;
        await this.enrollmentRepository.finish({ enrollmentId: active.id, status: "unsubscribed", finishedAt: now });
      }

      await this.optOutRepository.createOptOut({
        id: randomUUID(),
        email: enrollment.email,
        optedOutAt: now,
        source: params.source,
      });
    }

    // Re-read so the answer carries the new status (automation included for the page).
    const updated = await this.enrollmentRepository.findByUnsubscribeToken({ token: params.token });

    return this.jsonApiService.buildSingle(EmailAutomationEnrollmentDescriptor.model, updated ?? enrollment);
  }
}
