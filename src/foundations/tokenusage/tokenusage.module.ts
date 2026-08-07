import { Module, OnModuleInit } from "@nestjs/common";
import { modelRegistry } from "../../common/registries/registry";
import { TokenUsageAdminController } from "./controllers/tokenusage.admin.controller";
import { TokenUsageDescriptor } from "./entities/tokenusage";
import { TokenUsageAdminBreakdownDescriptor } from "./entities/tokenusage-admin-breakdown";
import { TokenUsageAdminSummaryDescriptor } from "./entities/tokenusage-admin-summary";
import { TokenUsageAdminTimelineDescriptor } from "./entities/tokenusage-admin-timeline";
import { TokenUsageAdminRepository } from "./repositories/tokenusage.admin.repository";
import { TokenUsageRepository } from "./repositories/tokenusage.repository";
import { TokenUsageAdminService } from "./services/tokenusage.admin.service";
import { TokenUsageService } from "./services/tokenusage.service";

@Module({
  controllers: [TokenUsageAdminController],
  providers: [
    TokenUsageDescriptor.model.serialiser,
    TokenUsageAdminSummaryDescriptor.model.serialiser,
    TokenUsageAdminTimelineDescriptor.model.serialiser,
    TokenUsageAdminBreakdownDescriptor.model.serialiser,
    TokenUsageRepository,
    TokenUsageAdminRepository,
    TokenUsageService,
    TokenUsageAdminService,
  ],
  exports: [TokenUsageService, TokenUsageAdminService],
  imports: [],
})
export class TokenUsageModule implements OnModuleInit {
  onModuleInit() {
    modelRegistry.register(TokenUsageDescriptor.model);
    modelRegistry.register(TokenUsageAdminSummaryDescriptor.model);
    modelRegistry.register(TokenUsageAdminTimelineDescriptor.model);
    modelRegistry.register(TokenUsageAdminBreakdownDescriptor.model);
  }
}
