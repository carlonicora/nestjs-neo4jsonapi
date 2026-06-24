import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { ClsService } from "nestjs-cls";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AbstractService } from "../../../core/neo4j/abstracts/abstract.service";
import { assistantMeta } from "../../assistant/entities/assistant.meta";
import { assistantMessageMeta } from "../../assistant-message/entities/assistant-message.meta";
import { AssistantAction, AssistantActionDescriptor } from "../entities/assistant-action";
import { assistantActionMeta } from "../entities/assistant-action.meta";
import { AssistantActionRepository } from "../repositories/assistant-action.repository";

@Injectable()
export class AssistantActionService extends AbstractService<
  AssistantAction,
  typeof AssistantActionDescriptor.relationships
> {
  protected readonly descriptor = AssistantActionDescriptor;

  constructor(
    jsonApiService: JsonApiService,
    private readonly assistantActionRepository: AssistantActionRepository,
    clsService: ClsService,
  ) {
    super(jsonApiService, assistantActionRepository, clsService, AssistantActionDescriptor.model);
  }

  /**
   * Internal creation of a pending action (used by the operator turn flow when
   * a run interrupts on a destructive tool call). Goes through `createFromDTO`
   * — the framework path — so `expiresAt` (ISO string) is auto-cast to a Neo4j
   * datetime by the descriptor.
   */
  async createPendingAction(params: {
    id?: string;
    toolName: string;
    toolArgs: string;
    summary: string;
    threadId: string;
    userModuleIds: string;
    contentScope?: string;
    expiresAt: string;
    assistantId: string;
    messageId?: string;
  }): Promise<AssistantAction> {
    const id = params.id ?? randomUUID();

    await this.createFromDTO({
      data: {
        type: assistantActionMeta.type,
        id,
        attributes: {
          status: "pending",
          toolName: params.toolName,
          toolArgs: params.toolArgs,
          summary: params.summary,
          threadId: params.threadId,
          userModuleIds: params.userModuleIds,
          ...(params.contentScope !== undefined ? { contentScope: params.contentScope } : {}),
          expiresAt: params.expiresAt,
        },
        relationships: {
          assistant: { data: { type: assistantMeta.type, id: params.assistantId } },
          ...(params.messageId ? { message: { data: { type: assistantMessageMeta.type, id: params.messageId } } } : {}),
        },
      },
    });

    return this.assistantActionRepository.findById({ id });
  }
}
