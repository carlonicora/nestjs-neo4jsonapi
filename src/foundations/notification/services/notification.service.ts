import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { JsonApiPaginator } from "../../../core/jsonapi/serialisers/jsonapi.paginator";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AbstractService } from "../../../core/neo4j/abstracts/abstract.service";
import { Notification, NotificationDescriptor } from "../../notification/entities/notification";
import { NotificationRepository } from "../../notification/repositories/notification.repository";

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

  constructor(
    builder: JsonApiService,
    private readonly notificationRepository: NotificationRepository,
    clsService: ClsService,
  ) {
    super(builder, notificationRepository, clsService, NotificationDescriptor.model);
  }

  async findForUser(params: { query: any; userId: string; isArchived?: boolean }) {
    const paginator: JsonApiPaginator = new JsonApiPaginator(params.query);

    return this.jsonApiService.buildList(
      this.descriptor.model,
      await this.notificationRepository.findForUser({
        userId: params.userId,
        isArchived: params.isArchived,
        cursor: paginator.generateCursor(),
      }),
      paginator,
    );
  }

  async findByIdForUser(params: { notificationId: string; userId: string }) {
    return this.jsonApiService.buildSingle(
      this.descriptor.model,
      await this.notificationRepository.findByIdForUser(params),
    );
  }

  async markAsRead(params: { userId: string; notificationIds: string[] }) {
    return await this.notificationRepository.markAsRead(params);
  }

  async archive(params: { notificationId: string }) {
    await this.notificationRepository.archive({ notificationId: params.notificationId });
  }
}
