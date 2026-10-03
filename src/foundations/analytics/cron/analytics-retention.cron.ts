import { Injectable } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { AnalyticsDailySummaryRepository } from "../repositories/analytics-daily-summary.repository";
import { AnalyticsSessionRepository } from "../repositories/analytics-session.repository";
import { AnalyticsAdminService } from "../services/analytics.admin.service";

/** Maximum calendar days drained per run, so a backlog empties over a month. */
const MAX_DAYS_PER_RUN = 31;

@Injectable()
export class AnalyticsRetentionCron {
  constructor(
    private readonly analyticsSessionRepository: AnalyticsSessionRepository,
    private readonly analyticsDailySummaryRepository: AnalyticsDailySummaryRepository,
    private readonly analyticsAdminService: AnalyticsAdminService,
    private readonly logger: AppLoggingService,
  ) {}

  @Cron("0 3 * * *")
  async run(): Promise<void> {
    const expiredDays = await this.analyticsSessionRepository.findExpiredDays({
      cutoff: this.analyticsAdminService.retentionCutoff(),
      limit: MAX_DAYS_PER_RUN,
    });

    for (const date of expiredDays) {
      try {
        const summaryRows = await this.analyticsDailySummaryRepository.rollupDay({ date });
        const deleted = await this.analyticsSessionRepository.deleteDay({ date });
        this.logger.log(
          `Analytics day ${date}: ${summaryRows} summary rows written, ${deleted.sessions} sessions and ${deleted.pageViews} page views deleted`,
          "AnalyticsRetentionCron",
        );
      } catch (error) {
        this.logger.error(
          `Failed to roll up and delete analytics day ${date}: ${(error as Error).message}`,
          "AnalyticsRetentionCron",
        );
      }
    }

    const unlinked = await this.analyticsSessionRepository.unlinkDeletedUsers();
    this.logger.log(`Analytics sessions unlinked from deleted users: ${unlinked}`, "AnalyticsRetentionCron");
  }
}
