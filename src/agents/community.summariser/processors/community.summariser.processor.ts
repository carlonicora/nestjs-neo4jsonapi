import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { Inject, Optional } from "@nestjs/common";
import { Job } from "bullmq";
import { ClsService } from "nestjs-cls";
import { hasAvailableCreditsVia, isAiEnabledVia } from "../../../common/helpers/credit-gate";
import {
  COMMUNITY_SCOPE_FILTER,
  CommunityScopeFilterInterface,
  CREDIT_VALIDATOR,
  CreditValidatorInterface,
} from "../../../common/tokens";
import { QueueId } from "../../../config";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { WebSocketService } from "../../../core/websocket/services/websocket.service";
import { CommunityRepository } from "../../../foundations/community/repositories/community.repository";
import { GraphCatalogService } from "../../graph/services/graph.catalog.service";
import { isCommunityGroupable } from "../helpers/community-scope-filter";
import { CommunitySummariserService } from "../services/community.summariser.service";

interface CommunitySummariserJobData {
  communityId: string;
  companyId: string;
}

@Processor(QueueId.COMMUNITY_SUMMARISER, { concurrency: 1, lockDuration: 1000 * 60 * 5 })
export class CommunitySummariserProcessor extends WorkerHost {
  constructor(
    private readonly summariserService: CommunitySummariserService,
    private readonly cls: ClsService,
    private readonly logger: AppLoggingService,
    private readonly communityRepository: CommunityRepository,
    private readonly webSocketService: WebSocketService,
    /** See ChunkProcessor: seam, not CompanyService — CompanyModule would mount `companies/*` here. */
    @Optional()
    @Inject(CREDIT_VALIDATOR)
    private readonly creditValidator?: CreditValidatorInterface,
    /** Unbound = every queued community is summarised (today's behaviour). */
    @Optional()
    @Inject(COMMUNITY_SCOPE_FILTER)
    private readonly scopeFilter?: CommunityScopeFilterInterface,
    /** Scope-root types for the scope filter, as the cron reads them. */
    @Optional() private readonly catalog?: GraphCatalogService,
  ) {
    super();
  }

  @OnWorkerEvent("active")
  onActive(job: Job) {
    this.logger.debug(`Processing community summariser job ${job.name} (ID: ${job.id})`);
  }

  @OnWorkerEvent("failed")
  onError(job: Job) {
    this.logger.error(
      `Error processing community summariser job ${job.name} (ID: ${job.id}). Reason: ${job.failedReason}`,
    );
  }

  @OnWorkerEvent("completed")
  onCompleted(job: Job) {
    this.logger.debug(`Completed community summariser job ${job.name} (ID: ${job.id})`);
  }

  async process(job: Job<CommunitySummariserJobData>): Promise<void> {
    const { communityId, companyId } = job.data;

    await this.cls.run(async () => {
      this.cls.set("companyId", companyId);

      // No AI on this plan: drop silently. Deliberately BEFORE the credit
      // check so nothing is ever marked pending or deferred — an AI-free
      // company must accumulate no backlog.
      if (!(await isAiEnabledVia(this.creditValidator, { companyId }))) return;

      // Scope filter, also BEFORE the credit check: every path that queues a
      // community (the cron, an app's credit-backlog approval) ends here, so a
      // community of a scope the filter rejects is never summarised. It stays
      // stale and the filtered cron leaves it alone.
      const groupable = await isCommunityGroupable({
        filter: this.scopeFilter,
        catalog: this.catalog,
        communityRepository: this.communityRepository,
        communityId,
        companyId,
      });
      if (!groupable) {
        this.logger.log(
          `Skipped community summarisation for community ${communityId} (company ${companyId}) — rejected by the scope filter`,
          "CommunitySummariserProcessor",
        );
        return;
      }

      if (!(await hasAvailableCreditsVia(this.creditValidator, { companyId }))) {
        // Leave isStale set; flag pendingCredits so the 10-minute cron stops
        // re-enqueueing it (spec §2: a fresh top-up must not be silently eaten).
        await this.communityRepository.markPendingCredits(communityId);

        // Deferrals happen without spend, so the frontend needs this push (spec §4.5).
        await this.webSocketService.sendMessageToCompany(companyId, "company:ai_backlog_updated", {
          type: "company:ai_backlog_updated",
          companyId,
        });

        this.logger.log(
          `Deferred community summarisation for community ${communityId} (company ${companyId}) — no available credits`,
          "CommunitySummariserProcessor",
        );
        return;
      }

      this.logger.log(
        `Starting community summarisation for community ${communityId} (company ${companyId})`,
        "CommunitySummariserProcessor",
      );

      await this.summariserService.generateSummaryById(communityId);

      this.logger.log(`Completed community summarisation for community ${communityId}`, "CommunitySummariserProcessor");
    });
  }
}
