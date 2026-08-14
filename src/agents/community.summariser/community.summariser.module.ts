import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { QueueId } from "../../config";
import { LLMModule } from "../../core/llm/llm.module";
import { LoggingModule } from "../../core/logging/logging.module";
import { CompanyModule } from "../../foundations/company/company.module";
import { CommunityModule } from "../../foundations/community/community.module";
import { createWorkerProvider } from "../../common/decorators/conditional-service.decorator";
import { CommunitySummariserProcessor } from "./processors/community.summariser.processor";
import { CommunitySummariserService } from "./services/community.summariser.service";
import { CommunitySummariserCron } from "./cron/community.summariser.cron";

@Module({
  imports: [
    LLMModule,
    LoggingModule,
    CommunityModule,
    CompanyModule,
    BullModule.registerQueue({ name: QueueId.COMMUNITY_SUMMARISER }),
  ],
  providers: [CommunitySummariserService, CommunitySummariserProcessor, createWorkerProvider(CommunitySummariserCron)],
  exports: [CommunitySummariserService],
})
export class CommunitySummariserModule {}
