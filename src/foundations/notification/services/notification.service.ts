import { Injectable, Logger } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { JsonApiPaginator } from "../../../core/jsonapi/serialisers/jsonapi.paginator";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AbstractService } from "../../../core/neo4j/abstracts/abstract.service";
import { WebSocketService } from "../../../core/websocket/services/websocket.service";
import { Notification, NotificationDescriptor } from "../../notification/entities/notification";
import { NotificationRepository } from "../../notification/repositories/notification.repository";
import {
  JsonApiListDocument,
  JsonApiSingleDocument,
} from "../../../core/jsonapi/interfaces/jsonapi.document.interface";

/**
 * Pushed to every open connection of the user after a mark-as-read, with the
 * ids that were marked. Other tabs, browsers and devices drop their unread
 * badge without reloading; the tab that marked them already knows.
 */
export const NOTIFICATIONS_READ_EVENT = "notifications:read";

/**
 * `find`/`findById` are named `findForUser`/`findByIdForUser` — their required
 * `userId`/`notificationId` params are incompatible overrides of
 * `AbstractService.find(params: {query, term?, fetchAll?, orderBy?})` /
 * `findById(params: {id})`. Both are only called from this module's own
 * controller, so the rename is safe (mirrors the repository's rename for the
 * same reason).
 *
 * Responses are built with `this.descriptor.model` rather than the imported
 * `NotificationDescriptor.model`, so a subclass that overrides `descriptor`
 * with an extended notification descriptor serialises its own attributes and
 * relationships without having to re-implement these methods.
 */
@Injectable()
export class NotificationServices extends AbstractService<Notification, typeof NotificationDescriptor.relationships> {
  protected readonly descriptor = NotificationDescriptor;
  private readonly notificationLogger = new Logger(NotificationServices.name);

  constructor(
    builder: JsonApiService,
    private readonly notificationRepository: NotificationRepository,
    clsService: ClsService,
    private readonly webSocketService: WebSocketService,
  ) {
    super(builder, notificationRepository, clsService, NotificationDescriptor.model);
  }

  /**
   * @param params.sort - JSON:API `sort`, validated against the descriptor (400 when a field is not sortable).
   */
  async findForUser(params: {
    query: any;
    userId: string;
    isArchived?: boolean;
    sort?: string;
  }): Promise<JsonApiListDocument> {
    const orderByFields = this.parseSort(params.sort);
    const paginator: JsonApiPaginator = new JsonApiPaginator(params.query);

    return this.jsonApiService.buildList(
      this.descriptor.model,
      await this.notificationRepository.findForUser({
        userId: params.userId,
        isArchived: params.isArchived,
        cursor: paginator.generateCursor(),
        orderByFields,
      }),
      paginator,
    );
  }

  async findByIdForUser(params: { notificationId: string; userId: string }): Promise<JsonApiSingleDocument> {
    return this.jsonApiService.buildSingle(
      this.descriptor.model,
      await this.notificationRepository.findByIdForUser(params),
    );
  }

  async markAsRead(params: { userId: string; notificationIds: string[] }) {
    await this.notificationRepository.markAsRead(params);
    if (params.notificationIds.length === 0) return;

    // The read is saved; a failed push only leaves other tabs stale until they reload.
    try {
      await this.webSocketService.sendMessageToUser(params.userId, NOTIFICATIONS_READ_EVENT, {
        ids: params.notificationIds,
      });
    } catch (err) {
      this.notificationLogger.warn(
        `markAsRead: websocket push failed for user=${params.userId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async archive(params: { notificationId: string }) {
    await this.notificationRepository.archive({ notificationId: params.notificationId });
  }
}
