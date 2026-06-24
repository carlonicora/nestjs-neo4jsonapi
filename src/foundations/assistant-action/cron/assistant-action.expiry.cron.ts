import { Injectable } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { AssistantActionRepository } from "../repositories/assistant-action.repository";

@Injectable()
export class AssistantActionExpiryCron {
  constructor(
    private readonly assistantActionRepository: AssistantActionRepository,
    private readonly logger: AppLoggingService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleOverdueActions(): Promise<void> {
    const overdueActions = await this.assistantActionRepository.findAllOverduePendingActions();
    for (const { assistantActionId, companyId } of overdueActions) {
      try {
        await this.assistantActionRepository.expireAction({ assistantActionId, companyId });
      } catch (error) {
        this.logger.error(
          `Failed to expire assistant action ${assistantActionId} for company ${companyId}: ${(error as Error).message}`,
          "AssistantActionExpiryCron",
        );
      }
    }
  }
}
