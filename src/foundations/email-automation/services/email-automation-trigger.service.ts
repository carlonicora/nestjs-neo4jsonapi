import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { randomUUID } from "crypto";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { EmailAutomation } from "../entities/email-automation";
import {
  EMAIL_AUTOMATION_CONFIG,
  EmailAutomationModuleConfig,
  EmailAutomationRecipient,
  EmailAutomationTriggerDefinition,
} from "../interfaces/email-automation.config.interface";
import { EmailAutomationCandidateRepository } from "../repositories/email-automation-candidate.repository";
import { EmailAutomationEnrollmentRepository } from "../repositories/email-automation-enrollment.repository";
import { EmailAutomationStepRepository } from "../repositories/email-automation-step.repository";
import { EmailAutomationRepository } from "../repositories/email-automation.repository";
import { EmailOptOutRepository } from "../repositories/email-opt-out.repository";
import { emailAutomationIneligibleReason, resolveEmailPurpose } from "../utils/email-purpose";

const HOUR_MS = 60 * 60 * 1000;

/**
 * What `enrol` did: `enrolled` with the new enrolment's id, or why it wrote nothing
 * (`already_enrolled`: the email has an enrolment in the automation, whatever its status;
 * `no_steps`: the automation has no head step).
 */
export type EmailAutomationEnrolResult =
  { status: "enrolled"; enrollmentId: string } | { status: "already_enrolled" } | { status: "no_steps" };

/**
 * Listens to the events behind every declared trigger and moves people in and out of automations.
 * On each trigger the exits run first, then the entries, so one trigger can end automation A and
 * start automation B for the same person. Failures are logged and never reach the emitter.
 */
@Injectable()
export class EmailAutomationTriggerService implements OnModuleInit {
  constructor(
    @Inject(EMAIL_AUTOMATION_CONFIG) private readonly config: EmailAutomationModuleConfig,
    private readonly eventEmitter: EventEmitter2,
    private readonly automationRepository: EmailAutomationRepository,
    private readonly stepRepository: EmailAutomationStepRepository,
    private readonly enrollmentRepository: EmailAutomationEnrollmentRepository,
    private readonly optOutRepository: EmailOptOutRepository,
    private readonly candidateRepository: EmailAutomationCandidateRepository,
    private readonly logger: AppLoggingService,
  ) {}

  onModuleInit(): void {
    const byEvent = new Map<string, EmailAutomationTriggerDefinition[]>();
    for (const def of this.config.triggers ?? []) {
      byEvent.set(def.event, [...(byEvent.get(def.event) ?? []), def]);
    }

    for (const [event, defs] of byEvent) {
      this.eventEmitter.on(event, async (payload: unknown) => {
        for (const def of defs) await this.handle(def, payload);
      });
    }
  }

  async handle(def: EmailAutomationTriggerDefinition, payload: unknown): Promise<void> {
    try {
      const recipient = def.toRecipient(payload);
      if (!recipient) return;

      await this.exit(def.key, recipient);
      await this.enter(def.key, recipient);
    } catch (error) {
      this.logger.error(
        `Email automation trigger "${def.key}" failed`,
        error instanceof Error ? error : String(error),
        EmailAutomationTriggerService.name,
      );
    }
  }

  async exit(triggerKey: string, recipient: EmailAutomationRecipient): Promise<void> {
    const automations = await this.automationRepository.findActiveByExitTrigger({ exitTrigger: triggerKey });

    for (const automation of automations) {
      const enrollments = await this.enrollmentRepository.findActiveByEmailAndAutomation({
        email: recipient.email,
        automationId: automation.id,
      });

      for (const enrollment of enrollments) {
        await this.enrollmentRepository.finish({
          enrollmentId: enrollment.id,
          status: "exited",
          finishedAt: new Date(),
        });
      }
    }
  }

  /**
   * Enrols the recipient in every active automation started by the trigger they may enter:
   * Marketing needs consent and no global opt-out, Service needs neither
   * (`emailAutomationIneligibleReason`). "Already enrolled" and "no steps" are handled by `enrol`.
   * The consent that counts is the one on the recipient record now, not the event payload's: a
   * registered waitlist entry answers with the linked User's consent.
   */
  async enter(triggerKey: string, recipient: EmailAutomationRecipient): Promise<void> {
    const automations = await this.automationRepository.findActiveByTrigger({ trigger: triggerKey });
    if (automations.length === 0) return;

    // Opt-out and consent only matter to Marketing: read each once, and only when a Marketing automation is involved.
    const anyMarketing = automations.some((automation) => resolveEmailPurpose(automation.purpose) === "marketing");
    const optedOut = anyMarketing ? !!(await this.optOutRepository.findByEmail({ email: recipient.email })) : false;
    const marketingConsent = anyMarketing
      ? await this.candidateRepository.findRecipientMarketingConsent({
          recipientType: recipient.recipientType,
          recipientId: recipient.recipientId,
        })
      : false;

    for (const automation of automations) {
      const reason = emailAutomationIneligibleReason({
        purpose: resolveEmailPurpose(automation.purpose),
        marketingConsent,
        optedOut,
        alreadyEnrolled: false,
      });
      if (reason) continue;

      await this.enrol({ automation, recipient });
    }
  }

  /**
   * Creates the recipient's enrolment at the automation's head step (`nextSendAt` = now + the head's
   * delay) with a new unsubscribe token. Answers `enrolled` with its id, `already_enrolled` when the
   * email already has an enrolment in it (whatever its status), or `no_steps` when the automation
   * has no head step. It does NOT check consent or the opt-out: callers do, through
   * `emailAutomationIneligibleReason`.
   */
  async enrol(params: {
    automation: EmailAutomation;
    recipient: EmailAutomationRecipient;
    enrollmentId?: string;
  }): Promise<EmailAutomationEnrolResult> {
    const { automation, recipient } = params;

    const existing = await this.enrollmentRepository.findByAutomationAndEmail({
      automationId: automation.id,
      email: recipient.email,
    });
    if (existing) return { status: "already_enrolled" };

    const head = await this.stepRepository.findHead({ automationId: automation.id });
    if (!head) return { status: "no_steps" };

    const id = params.enrollmentId ?? randomUUID();
    const enrolledAt = new Date();
    await this.enrollmentRepository.createEnrollment({
      id,
      automationId: automation.id,
      stepId: head.id,
      recipient,
      enrolledAt,
      nextSendAt: new Date(enrolledAt.getTime() + (head.delayHours ?? 0) * HOUR_MS),
      unsubscribeToken: randomUUID(),
    });

    return { status: "enrolled", enrollmentId: id };
  }
}
