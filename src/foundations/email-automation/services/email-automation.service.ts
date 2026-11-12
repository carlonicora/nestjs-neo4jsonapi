import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import {
  JsonApiListDocument,
  JsonApiSingleDocument,
} from "../../../core/jsonapi/interfaces/jsonapi.document.interface";
import { JsonApiPaginator } from "../../../core/jsonapi/serialisers/jsonapi.paginator";
import { parseJsonApiSort } from "../../../core/neo4j/helpers/parse-jsonapi-sort";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AbstractService, JsonApiDTOData } from "../../../core/neo4j/abstracts/abstract.service";
import { EmailAutomation, EmailAutomationDescriptor } from "../entities/email-automation";
import { EmailAutomationCandidate, EmailAutomationCandidateDescriptor } from "../entities/email-automation-candidate";
import { EmailAutomationEnrollmentDescriptor } from "../entities/email-automation-enrollment";
import { EmailAutomationTriggerDescriptor } from "../entities/email-automation-trigger";
import { EMAIL_AUTOMATION_CONFIG, EmailAutomationModuleConfig } from "../interfaces/email-automation.config.interface";
import { EmailAutomationEnrollmentRepository } from "../repositories/email-automation-enrollment.repository";
import { EmailAutomationStepRepository } from "../repositories/email-automation-step.repository";
import { EmailAutomationCandidateRepository } from "../repositories/email-automation-candidate.repository";
import { EmailAutomationRepository } from "../repositories/email-automation.repository";
import {
  EmailAutomationIneligibleReason,
  emailAutomationIneligibleReason,
  resolveEmailPurpose,
} from "../utils/email-purpose";
import { EmailAutomationTriggerService } from "./email-automation-trigger.service";

/** The 400 message of each reason the manual add refuses a person. */
const INELIGIBLE_MESSAGES: Record<EmailAutomationIneligibleReason, string> = {
  already_enrolled: "Already in this automation",
  opted_out: "Unsubscribed from marketing",
  no_consent: "No marketing consent",
};

@Injectable()
export class EmailAutomationService extends AbstractService<
  EmailAutomation,
  typeof EmailAutomationDescriptor.relationships
> {
  protected readonly descriptor = EmailAutomationDescriptor;

  constructor(
    jsonApiService: JsonApiService,
    private readonly emailAutomationRepository: EmailAutomationRepository,
    clsService: ClsService,
    private readonly stepRepository: EmailAutomationStepRepository,
    private readonly enrollmentRepository: EmailAutomationEnrollmentRepository,
    @Inject(EMAIL_AUTOMATION_CONFIG) private readonly config: Required<EmailAutomationModuleConfig>,
    private readonly triggerService: EmailAutomationTriggerService,
    private readonly candidateRepository: EmailAutomationCandidateRepository,
  ) {
    super(jsonApiService, emailAutomationRepository, clsService, EmailAutomationDescriptor.model);
  }

  /**
   * The triggers the app declared, as a synthetic `email-automation-triggers` list.
   */
  async listTriggers(): Promise<JsonApiListDocument> {
    return this.jsonApiService.buildList(
      EmailAutomationTriggerDescriptor.model,
      this.config.triggers.map(({ key, label }) => ({ id: key, key, label })),
      new JsonApiPaginator({}),
    );
  }

  /**
   * Drops every saved canvas position, so the canvas lays the chain out again.
   */
  async tidy(params: { id: string }): Promise<void> {
    await this.stepRepository.clearPositions({ automationId: params.id });
  }

  /**
   * @param params.sort - JSON:API `sort`, validated against the enrolment descriptor (400 when a
   *   field is not sortable; the computed step and sent count never are).
   */
  async findEnrollments(params: {
    id: string;
    status?: string;
    query: any;
    sort?: string;
  }): Promise<JsonApiListDocument> {
    const orderByFields = parseJsonApiSort({ sort: params.sort, descriptor: EmailAutomationEnrollmentDescriptor });
    const paginator = new JsonApiPaginator(params.query);

    const data = await this.enrollmentRepository.findByAutomation({
      automationId: params.id,
      status: params.status,
      cursor: paginator.generateCursor(),
      orderByFields,
    });

    return this.jsonApiService.buildList(EmailAutomationEnrollmentDescriptor.model, data, paginator);
  }

  /**
   * The people an administrator can add to the automation by hand, each flagged addable or not
   * with the reason, as a paginated `email-automation-candidates` list.
   */
  async findCandidates(params: { id: string; search?: string; query: any }): Promise<JsonApiListDocument> {
    const automation = await this.findAutomation(params.id);
    const purpose = resolveEmailPurpose(automation.purpose);

    const paginator = new JsonApiPaginator(params.query);

    const rows = await this.candidateRepository.findCandidates({
      automationId: params.id,
      search: params.search,
      cursor: paginator.generateCursor(),
    });

    const candidates = rows.map((row): EmailAutomationCandidate => {
      const reason = emailAutomationIneligibleReason({
        purpose,
        marketingConsent: row.marketingConsent,
        optedOut: row.optedOut,
        alreadyEnrolled: row.alreadyEnrolled,
      });
      return { ...row, addable: reason === null, reason: reason ?? undefined };
    });

    return this.jsonApiService.buildList(EmailAutomationCandidateDescriptor.model, candidates, paginator);
  }

  /**
   * Enrols a user or waitlist entry by hand, exactly as a trigger would, after re-checking the
   * same eligibility rule the candidates search shows (the list may be stale).
   */
  async addEnrollment(params: { id: string; data: JsonApiDTOData }): Promise<JsonApiSingleDocument> {
    const automation = await this.findAutomation(params.id);

    const candidate = await this.candidateRepository.findCandidate({
      automationId: params.id,
      recipientType: params.data.attributes?.recipientType,
      recipientId: params.data.attributes?.recipientId,
    });
    if (!candidate) throw new NotFoundException("Person not found");

    const reason = emailAutomationIneligibleReason({
      purpose: resolveEmailPurpose(automation.purpose),
      marketingConsent: candidate.marketingConsent,
      optedOut: candidate.optedOut,
      alreadyEnrolled: candidate.alreadyEnrolled,
    });
    if (reason) throw new BadRequestException(INELIGIBLE_MESSAGES[reason]);

    const result = await this.triggerService.enrol({
      automation,
      recipient: {
        email: candidate.email,
        name: candidate.name,
        recipientType: candidate.recipientType,
        recipientId: candidate.recipientId,
        marketingConsent: candidate.marketingConsent,
      },
      enrollmentId: params.data.id,
    });
    // Enrolled by a trigger between the check above and the write: same answer as the check.
    if (result.status === "already_enrolled") {
      throw new BadRequestException(INELIGIBLE_MESSAGES.already_enrolled);
    }
    if (result.status === "no_steps") throw new BadRequestException("This automation has no emails yet");

    return this.jsonApiService.buildSingle(
      EmailAutomationEnrollmentDescriptor.model,
      await this.enrollmentRepository.findById({ id: result.enrollmentId }),
    );
  }

  async createFromDTO(params: { data: JsonApiDTOData; included?: unknown[] }): Promise<JsonApiSingleDocument> {
    this.validateTriggers(params.data);
    return super.createFromDTO(params);
  }

  async patchFromDTO(params: { data: JsonApiDTOData }): Promise<JsonApiSingleDocument> {
    this.validateTriggers(params.data);
    return super.patchFromDTO(params);
  }

  private async findAutomation(id: string): Promise<EmailAutomation> {
    const automation = await this.emailAutomationRepository.findById({ id });
    if (!automation) throw new NotFoundException("Email automation not found");
    return automation;
  }

  /**
   * `trigger` and `exitTrigger` must be a key the app declared, or empty.
   */
  private validateTriggers(data: JsonApiDTOData): void {
    const declared = new Set(this.config.triggers.map((trigger) => trigger.key));

    for (const field of ["trigger", "exitTrigger"]) {
      const value = data.attributes?.[field];
      if (value === undefined || value === null || value === "") continue;
      if (!declared.has(value)) throw new BadRequestException(`Unknown ${field}: ${value}`);
    }
  }
}
