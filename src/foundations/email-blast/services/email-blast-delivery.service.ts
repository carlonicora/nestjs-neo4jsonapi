import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";
import { randomUUID } from "crypto";
import { ClsService } from "nestjs-cls";
import { BaseConfigInterface, ConfigApiInterface, ConfigAppInterface } from "../../../config/interfaces";
import { QueueId } from "../../../config/enums/queue.id";
import { CacheService } from "../../../core/cache/services/cache.service";
import { EmailService } from "../../../core/email/services/email.service";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { AbstractService } from "../../../core/neo4j/abstracts/abstract.service";
import { EmailAutomationEnrollmentRepository } from "../../email-automation/repositories/email-automation-enrollment.repository";
import { EmailOptOutRepository } from "../../email-automation/repositories/email-opt-out.repository";
import { ResponseLanguageService } from "../../user/services/response-language.service";
import {
  EMAIL_BLAST_BATCH_SIZE,
  EMAIL_BLAST_JOB_NAMES,
  EMAIL_BLAST_JOB_OPTIONS,
  EMAIL_BLAST_STUCK_MINUTES,
  EmailBlastJobData,
  emailBlastJobId,
} from "../email-blast.constants";
import { EmailBlast } from "../entities/email-blast";
import { EmailBlastDelivery, EmailBlastDeliveryDescriptor } from "../entities/email-blast-delivery";
import { emailBlastMeta } from "../entities/email-blast.meta";
import { EmailBlastDeliveryRepository } from "../repositories/email-blast-delivery.repository";
import { EmailBlastRepository } from "../repositories/email-blast.repository";
import { renderEmailBlast } from "../utils/email-blast.renderer";

type DeliveryOutcome = "sent" | "skipped" | "failed";

const MINUTE_MS = 60 * 1000;

/**
 * The whole delivery lifecycle of a blast: the worker send run, the recovery of stuck
 * deliveries and the public unsubscribe.
 *
 * Never twice beats never missing anyone: a delivery is claimed (`pending` → `sending`)
 * before the provider call; a send error marks it `failed` and it is never retried; a
 * delivery left in `sending` by a dead worker is failed by `recoverStuck`, never resent.
 *
 * The worker has no route for `@CacheInvalidate`, so the send run and the recovery
 * invalidate the `email-blasts` cache by hand (owner decision D-7).
 */
@Injectable()
export class EmailBlastDeliveryService extends AbstractService<
  EmailBlastDelivery,
  typeof EmailBlastDeliveryDescriptor.relationships
> {
  protected readonly descriptor = EmailBlastDeliveryDescriptor;

  constructor(
    jsonApiService: JsonApiService,
    private readonly deliveryRepository: EmailBlastDeliveryRepository,
    clsService: ClsService,
    private readonly blastRepository: EmailBlastRepository,
    private readonly optOutRepository: EmailOptOutRepository,
    private readonly enrollmentRepository: EmailAutomationEnrollmentRepository,
    private readonly emailService: EmailService,
    private readonly responseLanguage: ResponseLanguageService,
    private readonly configService: ConfigService<BaseConfigInterface>,
    private readonly cacheService: CacheService,
    @InjectQueue(QueueId.EMAIL_BLAST) private readonly queue: Queue,
    private readonly logger: AppLoggingService,
  ) {
    super(jsonApiService, deliveryRepository, clsService, EmailBlastDeliveryDescriptor.model);
  }

  /**
   * Snapshots the recipients (once per blast) and sends every pending delivery in batches.
   * Safe to run again after a crash: claimed deliveries are never claimed twice.
   */
  async processBlast(params: { blastId: string }): Promise<{ sent: number; skipped: number; failed: number }> {
    const counts = { sent: 0, skipped: 0, failed: 0 };

    const blast = await this.blastRepository.findById({ id: params.blastId });
    if (!blast || blast.status !== "sending") return counts;

    await this.deliveryRepository.createSnapshot({ blastId: params.blastId });
    await this.invalidateCache();

    const appUrl = this.configService.get<ConfigAppInterface>("app").url;
    const apiUrl = this.configService.get<ConfigApiInterface>("api").url;

    for (;;) {
      const batch = await this.deliveryRepository.claimBatch({
        blastId: params.blastId,
        limit: EMAIL_BLAST_BATCH_SIZE,
        claimedAt: new Date(),
      });
      if (batch.length === 0) break;

      for (const delivery of batch) {
        try {
          const outcome = await this.deliverOne({ blast, delivery, appUrl, apiUrl });
          counts[outcome]++;
        } catch (error) {
          // A database error: the delivery stays in `sending` and recoverStuck fails it later.
          counts.failed++;
          this.logger.error(
            `Failed to process email blast delivery ${delivery.id}: ${(error as Error).message}`,
            "EmailBlastDeliveryService",
          );
        }
      }

      await this.invalidateCache();
    }

    await this.blastRepository.markSentIfDone({ id: params.blastId });
    await this.invalidateCache();

    return counts;
  }

  /**
   * Fails every delivery claimed more than EMAIL_BLAST_STUCK_MINUTES ago (never resent),
   * then queues the send job again for every blast still `sending`, so a crashed run ends.
   */
  async recoverStuck(params: { now: Date }): Promise<void> {
    await this.deliveryRepository.failStuck({
      claimedBefore: new Date(params.now.getTime() - EMAIL_BLAST_STUCK_MINUTES * MINUTE_MS),
    });

    const sending = await this.blastRepository.findSending();
    for (const blast of sending) {
      const jobId = emailBlastJobId(blast.id);
      try {
        const existing = await this.queue.getJob(jobId);
        if (existing && (await existing.isFailed())) await existing.remove();

        const data: EmailBlastJobData = { blastId: blast.id };
        await this.queue.add(EMAIL_BLAST_JOB_NAMES.sendBlast, data, { ...EMAIL_BLAST_JOB_OPTIONS, jobId });
      } catch (error) {
        this.logger.error(
          `Failed to queue email blast ${blast.id}: ${(error as Error).message}`,
          "EmailBlastDeliveryService",
        );
      }
    }

    await this.invalidateCache();
  }

  /**
   * Stops every marketing email to the delivery's address: counts the unsubscribe on the
   * blast once, finishes the address's active automation enrolments and writes the shared
   * opt-out. Idempotent. Answers nothing, so a token holder never learns the email or user.
   */
  async unsubscribe(params: { token: string; source: "link" | "header" }): Promise<void> {
    const delivery = await this.deliveryRepository.findByUnsubscribeToken({ token: params.token });
    if (!delivery) throw new NotFoundException("Invalid unsubscribe token");

    const now = new Date();

    await this.deliveryRepository.markUnsubscribed({ id: delivery.id, unsubscribedAt: now });

    const activeEnrollments = await this.enrollmentRepository.findActiveByEmail({ email: delivery.email });
    for (const enrollment of activeEnrollments) {
      await this.enrollmentRepository.finish({ enrollmentId: enrollment.id, status: "unsubscribed", finishedAt: now });
    }

    await this.optOutRepository.createOptOut({
      id: randomUUID(),
      email: delivery.email,
      optedOutAt: now,
      source: params.source,
    });
  }

  private async deliverOne(params: {
    blast: EmailBlast;
    delivery: EmailBlastDelivery;
    appUrl: string;
    apiUrl: string;
  }): Promise<DeliveryOutcome> {
    const { blast, delivery, appUrl, apiUrl } = params;

    // The address may have opted out after the snapshot.
    const optOut = await this.optOutRepository.findByEmail({ email: delivery.email });
    if (optOut) {
      await this.deliveryRepository.markSkipped({ id: delivery.id });
      return "skipped";
    }

    try {
      const locale = (await this.responseLanguage.resolveForEmail({ email: delivery.email })) ?? "en";
      const rendered = await renderEmailBlast({
        blast,
        recipient: { email: delivery.email, name: delivery.name },
        unsubscribeToken: delivery.unsubscribeToken,
        locale,
        appUrl,
        apiUrl,
      });
      await this.emailService.sendEmail(
        "emailBlast",
        {
          to: delivery.email,
          subject: rendered.subject,
          content: rendered.content,
          replyTo: rendered.replyTo,
          headers: rendered.headers,
          unsubscribeAllUrl: rendered.unsubscribeAllUrl,
        },
        locale,
      );
    } catch (error) {
      const message = (error as Error).message;
      this.logger.error(
        `Failed to send email blast ${blast.id} delivery ${delivery.id}: ${message}`,
        "EmailBlastDeliveryService",
      );
      await this.deliveryRepository.markFailed({ id: delivery.id, error: message });
      return "failed";
    }

    // Outside the send try: a database error here must never count a delivered email as failed.
    await this.deliveryRepository.markSent({ id: delivery.id, sentAt: new Date() });
    return "sent";
  }

  private async invalidateCache(): Promise<void> {
    await this.cacheService.invalidateByType(emailBlastMeta.endpoint);
  }
}
