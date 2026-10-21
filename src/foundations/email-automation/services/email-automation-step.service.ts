import { BadRequestException, Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import {
  JsonApiListDocument,
  JsonApiSingleDocument,
} from "../../../core/jsonapi/interfaces/jsonapi.document.interface";
import { JsonApiPaginator } from "../../../core/jsonapi/serialisers/jsonapi.paginator";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AbstractService } from "../../../core/neo4j/abstracts/abstract.service";
import { EmailAutomationStep, EmailAutomationStepDescriptor } from "../entities/email-automation-step";
import { EmailAutomationEnrollmentRepository } from "../repositories/email-automation-enrollment.repository";
import { EmailAutomationStepRepository } from "../repositories/email-automation-step.repository";

@Injectable()
export class EmailAutomationStepService extends AbstractService<
  EmailAutomationStep,
  typeof EmailAutomationStepDescriptor.relationships
> {
  protected readonly descriptor = EmailAutomationStepDescriptor;

  constructor(
    jsonApiService: JsonApiService,
    private readonly stepRepository: EmailAutomationStepRepository,
    clsService: ClsService,
    private readonly enrollmentRepository: EmailAutomationEnrollmentRepository,
  ) {
    super(jsonApiService, stepRepository, clsService, EmailAutomationStepDescriptor.model);
  }

  async findByAutomation(params: { automationId: string; query: any }): Promise<JsonApiListDocument> {
    const paginator = new JsonApiPaginator(params.query);

    const data = await this.stepRepository.findByAutomation({ automationId: params.automationId });

    return this.jsonApiService.buildList(EmailAutomationStepDescriptor.model, data, paginator);
  }

  /**
   * Points a step at its successor, or clears it when `nextStepId` is null.
   * The chain stays linear: both steps in one automation, no self link, no
   * second incoming link on the successor, no loop.
   */
  async setNext(params: { stepId: string; nextStepId: string | null }): Promise<JsonApiSingleDocument> {
    if (params.nextStepId !== null) {
      if (params.nextStepId === params.stepId) throw new BadRequestException("A step cannot follow itself");

      const step = await this.stepRepository.findById({ id: params.stepId });
      const next = await this.stepRepository.findById({ id: params.nextStepId });

      const automationId = step.automation?.id;
      if (!automationId || automationId !== next.automation?.id)
        throw new BadRequestException("Both steps must belong to the same automation");

      const steps = await this.stepRepository.findByAutomation({ automationId });
      const chain = steps.map((chainStep) => ({ stepId: chainStep.id, nextId: chainStep.next?.id ?? null }));

      if (chain.some((link) => link.nextId === params.nextStepId && link.stepId !== params.stepId))
        throw new BadRequestException("The next step already follows another step");

      const nextById = new Map(chain.map((link) => [link.stepId, link.nextId]));
      const visited = new Set<string>();
      let cursor: string | null = params.nextStepId;
      while (cursor !== null && !visited.has(cursor)) {
        if (cursor === params.stepId) throw new BadRequestException("The chain cannot loop");
        visited.add(cursor);
        cursor = nextById.get(cursor) ?? null;
      }
    }

    await this.stepRepository.setNext({ stepId: params.stepId, nextStepId: params.nextStepId });

    return this.findById({ id: params.stepId });
  }

  /**
   * The id of the automation a step belongs to, so callers can refresh the
   * automation's cached entry after a change to its chain.
   */
  async findAutomationId(params: { stepId: string }): Promise<string | undefined> {
    const step = await this.stepRepository.findById({ id: params.stepId });
    return step.automation?.id;
  }

  /**
   * Removes a step and closes the gap: the previous step points at the
   * successor, and people waiting on the step move to the successor (or
   * complete when the step was the last one). Returns the id of the parent
   * automation.
   */
  async deleteStep(params: { id: string }): Promise<string | undefined> {
    const step = await this.stepRepository.findById({ id: params.id });
    const previous = await this.stepRepository.findPrevious({ stepId: params.id });
    const nextStepId = step.next?.id ?? null;

    if (previous) await this.stepRepository.setNext({ stepId: previous.id, nextStepId });

    await this.enrollmentRepository.repointStep({
      fromStepId: params.id,
      toStepId: nextStepId,
      finishedAt: new Date(),
    });

    await this.delete({ id: params.id });

    return step.automation?.id;
  }
}
