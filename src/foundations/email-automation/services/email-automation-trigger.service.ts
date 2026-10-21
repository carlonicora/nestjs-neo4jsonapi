import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { randomUUID } from "crypto";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import {
  EMAIL_AUTOMATION_CONFIG,
  EmailAutomationModuleConfig,
  EmailAutomationRecipient,
  EmailAutomationTriggerDefinition,
} from "../interfaces/email-automation.config.interface";
import { EmailAutomationEnrollmentRepository } from "../repositories/email-automation-enrollment.repository";
import { EmailAutomationStepRepository } from "../repositories/email-automation-step.repository";
import { EmailAutomationRepository } from "../repositories/email-automation.repository";
import { EmailOptOutRepository } from "../repositories/email-opt-out.repository";

const HOUR_MS = 60 * 60 * 1000;

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

  async enter(triggerKey: string, recipient: EmailAutomationRecipient): Promise<void> {
    if (!recipient.marketingConsent) return;

    const automations = await this.automationRepository.findActiveByTrigger({ trigger: triggerKey });
    if (automations.length === 0) return;

    const optOut = await this.optOutRepository.findByEmail({ email: recipient.email });
    if (optOut) return;

    for (const automation of automations) {
      const existing = await this.enrollmentRepository.findByAutomationAndEmail({
        automationId: automation.id,
        email: recipient.email,
      });
      if (existing) continue;

      const head = await this.stepRepository.findHead({ automationId: automation.id });
      if (!head) continue;

      const enrolledAt = new Date();
      await this.enrollmentRepository.createEnrollment({
        id: randomUUID(),
        automationId: automation.id,
        stepId: head.id,
        recipient,
        enrolledAt,
        nextSendAt: new Date(enrolledAt.getTime() + (head.delayHours ?? 0) * HOUR_MS),
        unsubscribeToken: randomUUID(),
      });
    }
  }
}
