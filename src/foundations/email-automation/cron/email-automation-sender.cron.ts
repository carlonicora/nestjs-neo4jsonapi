import { Injectable } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { EmailAutomationSenderService } from "../services/email-automation-sender.service";

@Injectable()
export class EmailAutomationSenderCron {
  constructor(
    private readonly senderService: EmailAutomationSenderService,
    private readonly logger: AppLoggingService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<void> {
    try {
      const { sent, skipped, failed } = await this.senderService.processDue({ now: new Date(), limit: 200 });
      this.logger.log(
        `Email automations: ${sent} sent, ${skipped} skipped, ${failed} failed`,
        "EmailAutomationSenderCron",
      );
    } catch (error) {
      this.logger.error(
        `Failed to process due email automations: ${(error as Error).message}`,
        "EmailAutomationSenderCron",
      );
    }
  }
}
