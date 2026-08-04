import { Inject, Injectable } from "@nestjs/common";
import { Queue } from "bullmq";
import { ClsService } from "nestjs-cls";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { AbstractService } from "../../../core/neo4j/abstracts/abstract.service";
import { UserActivity, UserActivityDescriptor } from "../entities/user-activity";
import {
  USER_ACTIVITY_CONFIG,
  USER_ACTIVITY_QUEUE,
  UserActivityModuleConfig,
} from "../interfaces/user-activity.config.interface";
import { UserActivityRecordInput } from "../interfaces/user-activity.record.input";
import { UserActivityRepository } from "../repositories/user-activity.repository";

@Injectable()
export class UserActivityService extends AbstractService<UserActivity, typeof UserActivityDescriptor.relationships> {
  protected readonly descriptor = UserActivityDescriptor;
  private readonly jobName: string;

  constructor(
    jsonApiService: JsonApiService,
    private readonly userActivityRepository: UserActivityRepository,
    clsService: ClsService,
    @Inject(USER_ACTIVITY_QUEUE) private readonly queue: Queue,
    private readonly logger: AppLoggingService,
    @Inject(USER_ACTIVITY_CONFIG) config: Required<UserActivityModuleConfig>,
  ) {
    super(jsonApiService, userActivityRepository, clsService, UserActivityDescriptor.model);
    this.jobName = config.jobName;
  }

  /**
   * Enqueue an activity for async write. Never throws — the activity log
   * must not break the caller's request path.
   */
  async record(input: UserActivityRecordInput): Promise<void> {
    try {
      await this.queue.add(this.jobName, input);
    } catch (err) {
      this.logger.error(
        `UserActivityService.record enqueue failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async findByUser(params: { userId: string; from?: Date; to?: Date; limit?: number }) {
    return this.userActivityRepository.findByUser(params);
  }
}
