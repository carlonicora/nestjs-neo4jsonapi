import { EventEmitter2 } from "@nestjs/event-emitter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockedObject } from "vitest";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { EmailAutomation } from "../entities/email-automation";
import { EmailAutomationEnrollment } from "../entities/email-automation-enrollment";
import { EmailAutomationStep } from "../entities/email-automation-step";
import { EmailOptOut } from "../entities/email-opt-out";
import { EmailAutomationRecipient } from "../interfaces/email-automation.config.interface";
import { EmailAutomationEnrollmentRepository } from "../repositories/email-automation-enrollment.repository";
import { EmailAutomationStepRepository } from "../repositories/email-automation-step.repository";
import { EmailAutomationRepository } from "../repositories/email-automation.repository";
import { EmailOptOutRepository } from "../repositories/email-opt-out.repository";
import { EmailAutomationTriggerService } from "../services/email-automation-trigger.service";
import { userActivatedTrigger, waitlistConfirmedTrigger } from "../triggers/built-in.triggers";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("EmailAutomationTriggerService", () => {
  const wl = waitlistConfirmedTrigger("wl");
  const reg = userActivatedTrigger("reg");
  const now = new Date("2026-10-21T10:00:00.000Z");

  const userPayload = (marketingConsent: boolean) => ({
    user: { id: "user-1", email: "gm@example.com", name: "GM", marketingConsent },
  });

  const automationA = { id: "automation-a", name: "A", isActive: true, exitTrigger: "reg" } as EmailAutomation;
  const automationB = { id: "automation-b", name: "B", isActive: true, trigger: "reg" } as EmailAutomation;
  const head = { id: "step-1", subject: "Hi", body: "Body", delayHours: 24 } as EmailAutomationStep;

  let eventEmitter: MockedObject<Pick<EventEmitter2, "on">>;
  let automationRepository: MockedObject<
    Pick<EmailAutomationRepository, "findActiveByTrigger" | "findActiveByExitTrigger">
  >;
  let stepRepository: MockedObject<Pick<EmailAutomationStepRepository, "findHead">>;
  let enrollmentRepository: MockedObject<
    Pick<
      EmailAutomationEnrollmentRepository,
      "findByAutomationAndEmail" | "findActiveByEmailAndAutomation" | "finish" | "createEnrollment"
    >
  >;
  let optOutRepository: MockedObject<Pick<EmailOptOutRepository, "findByEmail">>;
  let logger: MockedObject<Pick<AppLoggingService, "error">>;
  let service: EmailAutomationTriggerService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);

    eventEmitter = { on: vi.fn() } as MockedObject<Pick<EventEmitter2, "on">>;
    automationRepository = {
      findActiveByTrigger: vi.fn().mockResolvedValue([automationB]),
      findActiveByExitTrigger: vi.fn().mockResolvedValue([]),
    };
    stepRepository = { findHead: vi.fn().mockResolvedValue(head) };
    enrollmentRepository = {
      findByAutomationAndEmail: vi.fn().mockResolvedValue(null),
      findActiveByEmailAndAutomation: vi.fn().mockResolvedValue([]),
      finish: vi.fn().mockResolvedValue(undefined),
      createEnrollment: vi.fn().mockResolvedValue(undefined),
    };
    optOutRepository = { findByEmail: vi.fn().mockResolvedValue(null) };
    logger = { error: vi.fn() };

    service = new EmailAutomationTriggerService(
      { triggers: [wl, reg] },
      eventEmitter as unknown as EventEmitter2,
      automationRepository as unknown as EmailAutomationRepository,
      stepRepository as unknown as EmailAutomationStepRepository,
      enrollmentRepository as unknown as EmailAutomationEnrollmentRepository,
      optOutRepository as unknown as EmailOptOutRepository,
      logger as unknown as AppLoggingService,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("onModuleInit", () => {
    it("subscribes once per distinct event name", () => {
      const service2 = new EmailAutomationTriggerService(
        { triggers: [wl, reg, userActivatedTrigger("reg-2")] },
        eventEmitter as unknown as EventEmitter2,
        automationRepository as unknown as EmailAutomationRepository,
        stepRepository as unknown as EmailAutomationStepRepository,
        enrollmentRepository as unknown as EmailAutomationEnrollmentRepository,
        optOutRepository as unknown as EmailOptOutRepository,
        logger as unknown as AppLoggingService,
      );

      service2.onModuleInit();

      expect(eventEmitter.on).toHaveBeenCalledTimes(2);
      expect(eventEmitter.on.mock.calls.map((call) => call[0]).sort()).toEqual([reg.event, wl.event].sort());
    });

    it("routes an emitted payload to handle with the matching definition", async () => {
      const handle = vi.spyOn(service, "handle").mockResolvedValue(undefined);
      service.onModuleInit();

      const listener = eventEmitter.on.mock.calls.find((call) => call[0] === reg.event)?.[1] as (
        payload: unknown,
      ) => Promise<void>;
      await listener(userPayload(true));

      expect(handle).toHaveBeenCalledWith(reg, userPayload(true));
    });
  });

  describe("handle", () => {
    it("does not enrol without marketing consent", async () => {
      await service.handle(reg, userPayload(false));

      expect(enrollmentRepository.createEnrollment).not.toHaveBeenCalled();
    });

    it("does not enrol an opted-out email", async () => {
      optOutRepository.findByEmail.mockResolvedValue({ id: "opt-1", email: "gm@example.com" } as EmailOptOut);

      await service.handle(reg, userPayload(true));

      expect(enrollmentRepository.createEnrollment).not.toHaveBeenCalled();
    });

    it("does not enrol twice in the same automation, whatever the earlier status", async () => {
      enrollmentRepository.findByAutomationAndEmail.mockResolvedValue({
        id: "enrollment-1",
        status: "completed",
      } as EmailAutomationEnrollment);

      await service.handle(reg, userPayload(true));

      expect(enrollmentRepository.createEnrollment).not.toHaveBeenCalled();
    });

    it("does not enrol in an automation without steps", async () => {
      stepRepository.findHead.mockResolvedValue(null);

      await service.handle(reg, userPayload(true));

      expect(enrollmentRepository.createEnrollment).not.toHaveBeenCalled();
    });

    it("does nothing when the payload has no recipient", async () => {
      await service.handle(reg, {});

      expect(automationRepository.findActiveByExitTrigger).not.toHaveBeenCalled();
      expect(enrollmentRepository.createEnrollment).not.toHaveBeenCalled();
    });

    it("enrols at the head step, due after its delay", async () => {
      await service.handle(reg, userPayload(true));

      expect(automationRepository.findActiveByTrigger).toHaveBeenCalledWith({ trigger: "reg" });
      expect(enrollmentRepository.createEnrollment).toHaveBeenCalledTimes(1);

      const params = enrollmentRepository.createEnrollment.mock.calls[0][0];
      expect(params.automationId).toBe(automationB.id);
      expect(params.stepId).toBe(head.id);
      expect(params.enrolledAt).toEqual(now);
      expect(params.nextSendAt).toEqual(new Date(now.getTime() + 24 * 60 * 60 * 1000));
      expect(params.id).toMatch(UUID);
      expect(params.unsubscribeToken).toMatch(UUID);
      expect(params.unsubscribeToken).not.toBe(params.id);
      expect(params.recipient).toEqual<EmailAutomationRecipient>({
        email: "gm@example.com",
        name: "GM",
        recipientType: "user",
        recipientId: "user-1",
        marketingConsent: true,
      });
    });

    it("exits automation A before entering automation B on the same trigger", async () => {
      automationRepository.findActiveByExitTrigger.mockResolvedValue([automationA]);
      enrollmentRepository.findActiveByEmailAndAutomation.mockResolvedValue([
        { id: "enrollment-a", status: "active" } as EmailAutomationEnrollment,
      ]);

      await service.handle(reg, userPayload(true));

      expect(automationRepository.findActiveByExitTrigger).toHaveBeenCalledWith({ exitTrigger: "reg" });
      expect(enrollmentRepository.findActiveByEmailAndAutomation).toHaveBeenCalledWith({
        email: "gm@example.com",
        automationId: automationA.id,
      });
      expect(enrollmentRepository.finish).toHaveBeenCalledWith({
        enrollmentId: "enrollment-a",
        status: "exited",
        finishedAt: now,
      });
      expect(enrollmentRepository.createEnrollment).toHaveBeenCalledWith(
        expect.objectContaining({ automationId: automationB.id }),
      );
      expect(enrollmentRepository.finish.mock.invocationCallOrder[0]).toBeLessThan(
        enrollmentRepository.createEnrollment.mock.invocationCallOrder[0],
      );
    });

    it("exits even without marketing consent", async () => {
      automationRepository.findActiveByExitTrigger.mockResolvedValue([automationA]);
      enrollmentRepository.findActiveByEmailAndAutomation.mockResolvedValue([
        { id: "enrollment-a", status: "active" } as EmailAutomationEnrollment,
      ]);

      await service.handle(reg, userPayload(false));

      expect(enrollmentRepository.finish).toHaveBeenCalledWith(expect.objectContaining({ status: "exited" }));
      expect(enrollmentRepository.createEnrollment).not.toHaveBeenCalled();
    });

    it("logs a repository failure and resolves", async () => {
      const failure = new Error("neo4j down");
      automationRepository.findActiveByTrigger.mockRejectedValue(failure);

      await expect(service.handle(reg, userPayload(true))).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("reg"), failure, expect.any(String));
    });
  });
});
