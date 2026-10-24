import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { Inject, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Job } from "bullmq";
import { QueueId } from "../../../config/enums/queue.id";
import { EmailService } from "../../../core/email/services/email.service";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import {
  BILLING_CONFIG,
  BillingEmailJobDefinition,
  DEFAULT_BILLING_CONFIG,
  ResolvedBillingConfig,
} from "../interfaces/billing.config.interface";
import { BillingEmailJobData, LIBRARY_BILLING_EMAIL_JOBS } from "./billing-email.jobs";

/**
 * BillingEmailProcessor — the library billing email sender, lifted from only35's
 * `EmailProcessor`. Consumes `QueueId.EMAIL` and renders the job's template.
 *
 * Registered by `BillingModule` on worker instances only, and only when
 * `billing.emailSender.enabled` is true: apps that consume the email queue with
 * their own processor keep it off.
 */
@Processor(QueueId.EMAIL, {
  concurrency: 5,
  lockDuration: 30000,
})
export class BillingEmailProcessor extends WorkerHost {
  /**
   * App base URL for the links embedded in outgoing emails, without a trailing
   * slash so `${appUrl}${links.billing}` cannot produce a doubled separator.
   */
  private readonly appUrl: string;
  private readonly jobs: Record<string, BillingEmailJobDefinition>;
  private readonly config: ResolvedBillingConfig;

  constructor(
    private readonly emailService: EmailService,
    private readonly logger: AppLoggingService,
    private readonly configService: ConfigService,
    @Optional() @Inject(BILLING_CONFIG) billingConfig?: ResolvedBillingConfig,
  ) {
    super();
    this.config = billingConfig ?? DEFAULT_BILLING_CONFIG;
    this.appUrl = (this.configService.get<{ url: string }>("app")?.url ?? "").replace(/\/$/, "");
    this.jobs = { ...LIBRARY_BILLING_EMAIL_JOBS, ...this.config.emailSender.extraJobs };
  }

  @OnWorkerEvent("active")
  onActive(job: Job<BillingEmailJobData>) {
    this.logger.debug(`Processing email job ${job.data.jobType} (ID: ${job.id})`);
  }

  @OnWorkerEvent("failed")
  onError(job: Job<BillingEmailJobData>) {
    this.logger.error(`Failed to send email ${job.data.jobType} (ID: ${job.id}). Reason: ${job.failedReason}`);
  }

  @OnWorkerEvent("completed")
  onCompleted(job: Job<BillingEmailJobData>) {
    this.logger.debug(`Email ${job.data.jobType} sent successfully (ID: ${job.id})`);
  }

  async process(job: Job<BillingEmailJobData>): Promise<void> {
    const { jobType, payload } = job.data;

    const definition = this.jobs[jobType];
    if (!definition) {
      this.logger.warn(`Unknown email job type: ${jobType}`);
      return;
    }

    const locale = payload.locale || "en";
    const data = definition.toTemplateData(payload, { appUrl: this.appUrl, locale, links: this.config.links });

    await this.emailService.sendEmail(definition.template, { to: payload.to, ...data }, locale);

    this.logger.log(`Sent ${jobType} email to ${payload.to}`);
  }
}
