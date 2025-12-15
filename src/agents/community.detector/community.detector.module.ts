import { Module } from "@nestjs/common";
import { CommunityDetectorService } from "./services/community.detector.service";
import { LoggingModule } from "../../core/logging/logging.module";
import { CommunityModule } from "../../foundations/community/community.module";
import { CommunitySummariserModule } from "../community.summariser/community.summariser.module";

@Module({
  imports: [LoggingModule, CommunityModule, CommunitySummariserModule],
  providers: [CommunityDetectorService],
  exports: [CommunityDetectorService],
})
export class CommunityDetectorModule {}
