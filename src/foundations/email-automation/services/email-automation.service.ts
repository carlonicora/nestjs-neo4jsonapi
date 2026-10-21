import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import {
  JsonApiListDocument,
  JsonApiSingleDocument,
} from "../../../core/jsonapi/interfaces/jsonapi.document.interface";
import { JsonApiPaginator } from "../../../core/jsonapi/serialisers/jsonapi.paginator";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AbstractService, JsonApiDTOData } from "../../../core/neo4j/abstracts/abstract.service";
import { EmailAutomation, EmailAutomationDescriptor } from "../entities/email-automation";
import { EmailAutomationEnrollmentDescriptor } from "../entities/email-automation-enrollment";
import { EmailAutomationTriggerDescriptor } from "../entities/email-automation-trigger";
import { EMAIL_AUTOMATION_CONFIG, EmailAutomationModuleConfig } from "../interfaces/email-automation.config.interface";
import { EmailAutomationEnrollmentRepository } from "../repositories/email-automation-enrollment.repository";
import { EmailAutomationStepRepository } from "../repositories/email-automation-step.repository";
import { EmailAutomationRepository } from "../repositories/email-automation.repository";

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

  async findEnrollments(params: { id: string; status?: string; query: any }): Promise<JsonApiListDocument> {
    const paginator = new JsonApiPaginator(params.query);

    const data = await this.enrollmentRepository.findByAutomation({
      automationId: params.id,
      status: params.status,
      cursor: paginator.generateCursor(),
    });

    return this.jsonApiService.buildList(EmailAutomationEnrollmentDescriptor.model, data, paginator);
  }

  async createFromDTO(params: { data: JsonApiDTOData; included?: unknown[] }): Promise<JsonApiSingleDocument> {
    this.validateTriggers(params.data);
    return super.createFromDTO(params);
  }

  async patchFromDTO(params: { data: JsonApiDTOData }): Promise<JsonApiSingleDocument> {
    this.validateTriggers(params.data);
    return super.patchFromDTO(params);
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
