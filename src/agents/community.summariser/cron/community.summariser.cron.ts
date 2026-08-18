import { InjectQueue } from "@nestjs/bullmq";
import { Inject, Injectable, Optional } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { Queue } from "bullmq";
import { isAiEnabledVia } from "../../../common/helpers/credit-gate";
import { CREDIT_VALIDATOR, CreditValidatorInterface } from "../../../common/tokens";
import { QueueId } from "../../../config";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { CommunityRepository } from "../../../foundations/community/repositories/community.repository";

@Injectable()
export class CommunitySummariserCron {
  constructor(
    private readonly communityRepository: CommunityRepository,
    @InjectQueue(QueueId.COMMUNITY_SUMMARISER)
    private readonly summariserQueue: Queue,
    private readonly logger: AppLoggingService,
    /** See ChunkProcessor: seam, not CompanyService — CompanyModule would mount `companies/*` here. */
    @Optional()
    @Inject(CREDIT_VALIDATOR)
    private readonly creditValidator?: CreditValidatorInterface,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleStaleCommunities(): Promise<void> {
    const staleCommunities = await this.communityRepository.findAllStaleCommunities();
    for (const { communityId, companyId } of staleCommunities) {
      // No AI on this plan: never enqueue. The processor's own gate stops the
      // model CALL, but only this filter stops the ENQUEUE — and it is the only
      // thing that terminates the loop. In the no-credits case the processor
      // sets `pendingCredits`, which drops the community out of
      // `findAllStaleCommunities`; the AI-free branch correctly writes nothing,
      // so without this check the same job is re-queued every 10 minutes
      // forever.
      if (!(await isAiEnabledVia(this.creditValidator, { companyId }))) continue;

      try {
        await this.summariserQueue.add("process-stale", {
          communityId,
          companyId,
        });
      } catch (error) {
        this.logger.error(
          `Failed to enqueue stale community ${communityId} for company ${companyId}: ${(error as Error).message}`,
          "CommunitySummariserCron",
        );
      }
    }
  }
}
