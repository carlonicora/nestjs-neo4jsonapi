import { BullModule } from "@nestjs/bullmq";
import { Module, forwardRef } from "@nestjs/common";
import { QueueId } from "../../config/enums/queue.id";
import { CompanyModule } from "../company/company.module";
import { TrialProcessor } from "./processors/trial.processor";
import { TrialService } from "./services/trial.service";

/**
 * Stripe Trial Module
 *
 * Orchestrates 14-day trial subscription creation for new user signups.
 * Uses BullMQ queue for async processing and ModuleRef for Stripe service dependencies.
 *
 * Queue-based architecture:
 * - AuthModule queues trial creation jobs (no direct dependency)
 * - TrialProcessor handles jobs asynchronously
 * - WebSocket notification sent from Stripe webhook after feature sync
 *
 * Dependencies (via ModuleRef):
 * - StripeCustomerAdminService: Create Stripe customer
 * - StripeSubscriptionAdminService: Create subscription with trial period
 * - StripePriceRepository: Find trial price configuration
 *
 * Direct dependencies:
 * - CompanyModule: Update company tokens and subscription status
 */
@Module({
  imports: [forwardRef(() => CompanyModule), BullModule.registerQueue({ name: QueueId.TRIAL })],
  providers: [TrialService, TrialProcessor],
  exports: [TrialService],
})
export class StripeTrialModule {}
