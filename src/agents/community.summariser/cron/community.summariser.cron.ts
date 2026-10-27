import { InjectQueue } from "@nestjs/bullmq";
import { Inject, Injectable, Optional } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { Queue } from "bullmq";
import { ClsService } from "nestjs-cls";
import { isAiEnabledVia } from "../../../common/helpers/credit-gate";
import {
  COMMUNITY_SCOPE_FILTER,
  CommunityScopeFilterInterface,
  CREDIT_VALIDATOR,
  CreditValidatorInterface,
} from "../../../common/tokens";
import { QueueId } from "../../../config";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { CommunityRepository } from "../../../foundations/community/repositories/community.repository";
import { GraphCatalogService } from "../../graph/services/graph.catalog.service";
import { isCommunityGroupable } from "../helpers/community-scope-filter";

@Injectable()
export class CommunitySummariserCron {
  constructor(
    private readonly communityRepository: CommunityRepository,
    @InjectQueue(QueueId.COMMUNITY_SUMMARISER)
    private readonly summariserQueue: Queue,
    private readonly logger: AppLoggingService,
    private readonly cls: ClsService,
    /** See ChunkProcessor: seam, not CompanyService — CompanyModule would mount `companies/*` here. */
    @Optional()
    @Inject(CREDIT_VALIDATOR)
    private readonly creditValidator?: CreditValidatorInterface,
    /** Unbound = every stale community is summarised (today's behaviour). */
    @Optional()
    @Inject(COMMUNITY_SCOPE_FILTER)
    private readonly scopeFilter?: CommunityScopeFilterInterface,
    /** Scope-root types, as CommunityDetectorService.listScopeRoots reads them. */
    @Optional() private readonly catalog?: GraphCatalogService,
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
        if (!(await this.isGroupable({ communityId, companyId }))) continue;

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

  /**
   * Scope filter for one stale community (see isCommunityGroupable), read
   * inside a CLS context seeded with the community's company. Unbound filter →
   * groupable.
   */
  private async isGroupable(params: { communityId: string; companyId: string }): Promise<boolean> {
    if (!this.scopeFilter) return true;

    return this.cls.run(async () => {
      this.cls.set("companyId", params.companyId);
      return isCommunityGroupable({
        filter: this.scopeFilter,
        catalog: this.catalog,
        communityRepository: this.communityRepository,
        communityId: params.communityId,
        companyId: params.companyId,
      });
    });
  }
}
