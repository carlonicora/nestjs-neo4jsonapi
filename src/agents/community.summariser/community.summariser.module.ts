import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { QueueId } from "../../config";
import { LLMModule } from "../../core/llm/llm.module";
import { LoggingModule } from "../../core/logging/logging.module";
import { CommunityModule } from "../../foundations/community/community.module";
import { createWorkerProvider } from "../../common/decorators/conditional-service.decorator";
import { CommunitySummariserProcessor } from "./processors/community.summariser.processor";
import { CommunitySummariserService } from "./services/community.summariser.service";
import { CommunitySummariserCron } from "./cron/community.summariser.cron";

/**
 * `CompanyModule` is deliberately NOT imported (same rule as
 * `agents/drift/drift.module.ts`): it declares `CompanyController`, so importing
 * it mounts `companies/*` into every consumer and crashes any app that replaces
 * the company foundation with its own controller. The processor's credit gate
 * uses the optional `CREDIT_VALIDATOR` seam — see `common/helpers/credit-gate.ts`.
 */
@Module({
  imports: [LLMModule, LoggingModule, CommunityModule, BullModule.registerQueue({ name: QueueId.COMMUNITY_SUMMARISER })],
  providers: [CommunitySummariserService, CommunitySummariserProcessor, createWorkerProvider(CommunitySummariserCron)],
  exports: [CommunitySummariserService],
})
export class CommunitySummariserModule {}
