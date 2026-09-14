import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AbstractService } from "../../../core/neo4j/abstracts/abstract.service";
import { HandbookThreadMessage, HandbookThreadMessageDescriptor } from "../entities/handbook-thread-message";
import { HandbookThreadMessageRepository } from "../repositories/handbook-thread-message.repository";

/**
 * Messages are written only by `HandbookThreadService` as part of a turn, and
 * read only through their thread — so this service adds nothing to the
 * framework's CRUD. It exists because the thread service needs `createFromDTO`
 * (descriptor-driven mapping of attributes and the `HAS_MESSAGE` edge) rather
 * than hand-rolled Cypher, and because the serialiser is resolved through DI.
 */
@Injectable()
export class HandbookThreadMessageService extends AbstractService<
  HandbookThreadMessage,
  typeof HandbookThreadMessageDescriptor.relationships
> {
  protected readonly descriptor = HandbookThreadMessageDescriptor;

  constructor(
    jsonApiService: JsonApiService,
    handbookThreadMessageRepository: HandbookThreadMessageRepository,
    clsService: ClsService,
  ) {
    super(jsonApiService, handbookThreadMessageRepository, clsService, HandbookThreadMessageDescriptor.model);
  }
}
