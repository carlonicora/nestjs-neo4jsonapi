import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AbstractService } from "../../../core/neo4j/abstracts/abstract.service";
import { AssistantMessage, AssistantMessageDescriptor } from "../entities/assistant-message";
import { AssistantMessageRepository } from "../repositories/assistant-message.repository";

@Injectable()
export class AssistantMessageService extends AbstractService<
  AssistantMessage,
  typeof AssistantMessageDescriptor.relationships
> {
  protected readonly descriptor = AssistantMessageDescriptor;

  constructor(
    jsonApiService: JsonApiService,
    assistantMessageRepository: AssistantMessageRepository,
    clsService: ClsService,
  ) {
    super(jsonApiService, assistantMessageRepository, clsService, AssistantMessageDescriptor.model);
  }
}
