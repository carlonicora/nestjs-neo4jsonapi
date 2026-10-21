import { Injectable } from "@nestjs/common";
import { EmailService } from "../../../core/email/services/email.service";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { ResponseLanguageService } from "../../user/services/response-language.service";
import { EmailAutomationEnrollment } from "../entities/email-automation-enrollment";
import { EmailAutomationEnrollmentRepository } from "../repositories/email-automation-enrollment.repository";
import { EmailAutomationStepRepository } from "../repositories/email-automation-step.repository";
import { EmailOptOutRepository } from "../repositories/email-opt-out.repository";
import { EmailAutomationRenderer } from "./email-automation-renderer.service";

const HOUR_MS = 60 * 60 * 1000;
const MAX_ATTEMPTS = 3;

type ProcessOutcome = "sent" | "skipped" | "failed";

@Injectable()
export class EmailAutomationSenderService {
  constructor(
    private readonly enrollmentRepository: EmailAutomationEnrollmentRepository,
    private readonly stepRepository: EmailAutomationStepRepository,
    private readonly optOutRepository: EmailOptOutRepository,
    private readonly renderer: EmailAutomationRenderer,
    private readonly emailService: EmailService,
    private readonly responseLanguage: ResponseLanguageService,
    private readonly logger: AppLoggingService,
  ) {}

  /**
   * Sends every due email of the active automations, one enrolment at a time.
   * A failure on one enrolment is logged and the loop continues.
   */
  async processDue(params: { now: Date; limit: number }): Promise<{ sent: number; skipped: number; failed: number }> {
    const counts = { sent: 0, skipped: 0, failed: 0 };

    const dueEnrollments = await this.enrollmentRepository.findDue({ now: params.now, limit: params.limit });
    for (const enrollment of dueEnrollments) {
      try {
        const outcome = await this.processOne({ enrollment, now: params.now });
        counts[outcome]++;
      } catch (error) {
        counts.failed++;
        this.logger.error(
          `Failed to process email automation enrollment ${enrollment.id}: ${(error as Error).message}`,
          "EmailAutomationSenderService",
        );
      }
    }

    return counts;
  }

  private async processOne(params: { enrollment: EmailAutomationEnrollment; now: Date }): Promise<ProcessOutcome> {
    const { enrollment, now } = params;

    const optOut = await this.optOutRepository.findByEmail({ email: enrollment.email });
    if (optOut) {
      await this.enrollmentRepository.finish({ enrollmentId: enrollment.id, status: "unsubscribed", finishedAt: now });
      return "skipped";
    }

    if (!enrollment.currentStep?.id || !enrollment.automation) {
      this.logger.warn(
        `Email automation enrollment ${enrollment.id} has no current step or automation`,
        "EmailAutomationSenderService",
      );
      return "skipped";
    }

    // Loaded in full: the step's body and its `next` step (with its delay) are needed below.
    const step = await this.stepRepository.findById({ id: enrollment.currentStep.id });
    if (!step) {
      this.logger.warn(
        `Email automation step ${enrollment.currentStep.id} of enrollment ${enrollment.id} not found`,
        "EmailAutomationSenderService",
      );
      return "skipped";
    }

    // A previous run died between the send and the bookkeeping: never send the same step twice.
    const alreadySent = await this.enrollmentRepository.hasSent({ enrollmentId: enrollment.id, stepId: step.id });

    if (!alreadySent) {
      try {
        const locale = (await this.responseLanguage.resolveForEmail({ email: enrollment.email })) ?? "en";
        const rendered = await this.renderer.render({
          step,
          enrollment,
          automation: enrollment.automation,
          locale,
        });
        await this.emailService.sendEmail(
          "emailAutomation",
          {
            to: enrollment.email,
            subject: rendered.subject,
            content: rendered.content,
            replyTo: rendered.replyTo,
            headers: rendered.headers,
            unsubscribeUrl: rendered.unsubscribeUrl,
            unsubscribeAllUrl: rendered.unsubscribeAllUrl,
          },
          locale,
        );
      } catch (error) {
        const message = (error as Error).message;
        this.logger.error(
          `Failed to send email automation step ${step.id} to enrollment ${enrollment.id}: ${message}`,
          "EmailAutomationSenderService",
        );
        await this.enrollmentRepository.recordFailure({
          enrollmentId: enrollment.id,
          error: message,
          nextSendAt: new Date(now.getTime() + HOUR_MS),
        });
        if ((enrollment.attempts ?? 0) + 1 >= MAX_ATTEMPTS) {
          await this.enrollmentRepository.finish({ enrollmentId: enrollment.id, status: "failed", finishedAt: now });
        }
        return "failed";
      }

      await this.enrollmentRepository.markSent({ enrollmentId: enrollment.id, stepId: step.id, sentAt: now });
    }

    if (step.next?.id) {
      await this.enrollmentRepository.advance({
        enrollmentId: enrollment.id,
        nextStepId: step.next.id,
        nextSendAt: new Date(now.getTime() + (step.next.delayHours ?? 0) * HOUR_MS),
      });
    } else {
      await this.enrollmentRepository.finish({ enrollmentId: enrollment.id, status: "completed", finishedAt: now });
    }

    return alreadySent ? "skipped" : "sent";
  }
}
