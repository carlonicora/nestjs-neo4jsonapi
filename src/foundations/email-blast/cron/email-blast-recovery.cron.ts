import { Injectable } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { ClsService } from "nestjs-cls";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { EmailBlastDeliveryService } from "../services/email-blast-delivery.service";

/**
 * Every 10 minutes, worker only: fails the deliveries a dead worker left in `sending`
 * (never resent) and queues the send job again for every blast still `sending`.
 */
@Injectable()
export class EmailBlastRecoveryCron {
  constructor(
    private readonly deliveryService: EmailBlastDeliveryService,
    private readonly clsService: ClsService,
    private readonly logger: AppLoggingService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async run(): Promise<void> {
    try {
      await this.clsService.run(() => this.deliveryService.recoverStuck({ now: new Date() }));
    } catch (error) {
      this.logger.error(`Failed to recover email blasts: ${(error as Error).message}`, "EmailBlastRecoveryCron");
    }
  }
}
