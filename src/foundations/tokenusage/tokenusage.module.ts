import { Module, OnModuleInit } from "@nestjs/common";
import { modelRegistry } from "../../common/registries/registry";
import { TokenUsageAdminController } from "./controllers/tokenusage.admin.controller";
import { TokenUsageReportController } from "./controllers/tokenusage.report.controller";
import { TokenUsageDescriptor } from "./entities/tokenusage";
import { TokenUsageAdminBreakdownDescriptor } from "./entities/tokenusage-admin-breakdown";
import { TokenUsageAdminSummaryDescriptor } from "./entities/tokenusage-admin-summary";
import { TokenUsageAdminTimelineDescriptor } from "./entities/tokenusage-admin-timeline";
import { TokenUsageReportBreakdownDescriptor } from "./entities/tokenusage-report-breakdown";
import { TokenUsageReportSummaryDescriptor } from "./entities/tokenusage-report-summary";
import { TokenUsageReportTimelineDescriptor } from "./entities/tokenusage-report-timeline";
import { TokenUsageAdminRepository } from "./repositories/tokenusage.admin.repository";
import { TokenUsageReportRepository } from "./repositories/tokenusage.report.repository";
import { TokenUsageRepository } from "./repositories/tokenusage.repository";
import { TokenUsageAdminService } from "./services/tokenusage.admin.service";
import { TokenUsageReportService } from "./services/tokenusage.report.service";
import { TokenUsageService } from "./services/tokenusage.service";

@Module({
  controllers: [TokenUsageAdminController, TokenUsageReportController],
  providers: [
    TokenUsageDescriptor.model.serialiser,
    TokenUsageAdminSummaryDescriptor.model.serialiser,
    TokenUsageAdminTimelineDescriptor.model.serialiser,
    TokenUsageAdminBreakdownDescriptor.model.serialiser,
    TokenUsageReportSummaryDescriptor.model.serialiser,
    TokenUsageReportTimelineDescriptor.model.serialiser,
    TokenUsageReportBreakdownDescriptor.model.serialiser,
    TokenUsageRepository,
    TokenUsageAdminRepository,
    TokenUsageReportRepository,
    TokenUsageService,
    TokenUsageAdminService,
    TokenUsageReportService,
  ],
  exports: [TokenUsageService, TokenUsageAdminService, TokenUsageReportService],
  imports: [],
})
export class TokenUsageModule implements OnModuleInit {
  onModuleInit() {
    modelRegistry.register(TokenUsageDescriptor.model);
    modelRegistry.register(TokenUsageAdminSummaryDescriptor.model);
    modelRegistry.register(TokenUsageAdminTimelineDescriptor.model);
    modelRegistry.register(TokenUsageAdminBreakdownDescriptor.model);
    modelRegistry.register(TokenUsageReportSummaryDescriptor.model);
    modelRegistry.register(TokenUsageReportTimelineDescriptor.model);
    modelRegistry.register(TokenUsageReportBreakdownDescriptor.model);
  }
}
