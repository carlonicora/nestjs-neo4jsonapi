import { Injectable } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { CardExpiryWarningService } from "../services/card-expiry-warning.service";

/**
 * BillingLifecycleCron — hourly billing housekeeping, registered on worker
 * instances only (`createWorkerProvider`).
 *
 * Checks the cards that expire before their renewal. A failure is logged, never
 * thrown, so the next hourly run tries again.
 */
@Injectable()
export class BillingLifecycleCron {
  constructor(
    private readonly cardExpiryWarningService: CardExpiryWarningService,
    private readonly logger: AppLoggingService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<void> {
    const now = new Date();

    try {
      const { checked, warned } = await this.cardExpiryWarningService.processDue({ now });
      this.logger.log(`Billing lifecycle: ${checked} card(s) checked, ${warned} warned`, "BillingLifecycleCron");
    } catch (error) {
      this.logger.error(`Failed to check expiring cards: ${(error as Error).message}`, "BillingLifecycleCron");
    }
  }
}
