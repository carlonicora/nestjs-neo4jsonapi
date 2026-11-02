import { EventEmitter2 } from "@nestjs/event-emitter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockedObject } from "vitest";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { EmailAutomation } from "../entities/email-automation";
import { EmailAutomationEnrollment } from "../entities/email-automation-enrollment";
import { EmailAutomationStep } from "../entities/email-automation-step";
import { EmailOptOut } from "../entities/email-opt-out";
import { EmailAutomationRecipient } from "../interfaces/email-automation.config.interface";
import { EmailAutomationCandidateRepository } from "../repositories/email-automation-candidate.repository";
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
  const userRecipient: EmailAutomationRecipient = {
    email: "gm@example.com",
    name: "GM",
    recipientType: "user",
    recipientId: "user-1",
    marketingConsent: true,
  };

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
  let candidateRepository: MockedObject<Pick<EmailAutomationCandidateRepository, "findRecipientMarketingConsent">>;
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
    // The consent stored on the recipient record (the payload's is not trusted for Marketing).
    candidateRepository = { findRecipientMarketingConsent: vi.fn().mockResolvedValue(true) };
    logger = { error: vi.fn() };

    service = new EmailAutomationTriggerService(
      { triggers: [wl, reg] },
      eventEmitter as unknown as EventEmitter2,
      automationRepository as unknown as EmailAutomationRepository,
      stepRepository as unknown as EmailAutomationStepRepository,
      enrollmentRepository as unknown as EmailAutomationEnrollmentRepository,
      optOutRepository as unknown as EmailOptOutRepository,
      candidateRepository as unknown as EmailAutomationCandidateRepository,
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
        candidateRepository as unknown as EmailAutomationCandidateRepository,
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
      candidateRepository.findRecipientMarketingConsent.mockResolvedValue(false);

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
      candidateRepository.findRecipientMarketingConsent.mockResolvedValue(false);

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

  describe("enter (purpose)", () => {
    const service_ = {
      id: "automation-s",
      name: "S",
      isActive: true,
      trigger: "reg",
      purpose: "service",
    } as EmailAutomation;
    const marketing = {
      id: "automation-m",
      name: "M",
      isActive: true,
      trigger: "reg",
      purpose: "marketing",
    } as EmailAutomation;
    const recipient = (marketingConsent: boolean): EmailAutomationRecipient => ({
      email: "gm@example.com",
      name: "GM",
      recipientType: "user",
      recipientId: "user-1",
      marketingConsent,
    });

    it("enter: service automation enrols a recipient without consent", async () => {
      automationRepository.findActiveByTrigger.mockResolvedValue([service_]);
      candidateRepository.findRecipientMarketingConsent.mockResolvedValue(false);

      await service.enter("reg", recipient(false));

      expect(enrollmentRepository.createEnrollment).toHaveBeenCalledWith(
        expect.objectContaining({ automationId: service_.id }),
      );
      expect(optOutRepository.findByEmail).not.toHaveBeenCalled();
      expect(candidateRepository.findRecipientMarketingConsent).not.toHaveBeenCalled();
    });

    it("enter: marketing automation skips a recipient without consent", async () => {
      automationRepository.findActiveByTrigger.mockResolvedValue([marketing]);
      candidateRepository.findRecipientMarketingConsent.mockResolvedValue(false);

      await service.enter("reg", recipient(false));

      expect(enrollmentRepository.createEnrollment).not.toHaveBeenCalled();
    });

    it("enter: an automation without purpose counts as marketing", async () => {
      automationRepository.findActiveByTrigger.mockResolvedValue([automationB]);
      candidateRepository.findRecipientMarketingConsent.mockResolvedValue(false);

      await service.enter("reg", recipient(false));

      expect(enrollmentRepository.createEnrollment).not.toHaveBeenCalled();
    });

    it("enter: service automation enrols an opted-out recipient", async () => {
      automationRepository.findActiveByTrigger.mockResolvedValue([service_, marketing]);
      optOutRepository.findByEmail.mockResolvedValue({ id: "opt-1", email: "gm@example.com" } as EmailOptOut);

      await service.enter("reg", recipient(true));

      expect(optOutRepository.findByEmail).toHaveBeenCalledTimes(1);
      expect(enrollmentRepository.createEnrollment).toHaveBeenCalledTimes(1);
      expect(enrollmentRepository.createEnrollment).toHaveBeenCalledWith(
        expect.objectContaining({ automationId: service_.id }),
      );
    });

    it("enter: one trigger enrols into service and skips marketing for the same no-consent recipient", async () => {
      automationRepository.findActiveByTrigger.mockResolvedValue([marketing, service_]);
      candidateRepository.findRecipientMarketingConsent.mockResolvedValue(false);

      await service.enter("reg", recipient(false));

      expect(enrollmentRepository.createEnrollment).toHaveBeenCalledTimes(1);
      expect(enrollmentRepository.createEnrollment).toHaveBeenCalledWith(
        expect.objectContaining({ automationId: service_.id }),
      );
    });
  });

  describe("enter (consent from the recipient record)", () => {
    const marketing = {
      id: "automation-m",
      name: "M",
      isActive: true,
      trigger: "wl",
      purpose: "marketing",
    } as EmailAutomation;
    const service_ = {
      id: "automation-s",
      name: "S",
      isActive: true,
      trigger: "wl",
      purpose: "service",
    } as EmailAutomation;
    // A registered waitlist entry: its payload still says consent true, the linked user said no.
    const registeredWaitlist: EmailAutomationRecipient = {
      email: "player@example.com",
      recipientType: "waitlist",
      recipientId: "wl-1",
      marketingConsent: true,
    };

    it("enter: a waitlist recipient whose linked user has no consent is not enrolled in marketing", async () => {
      automationRepository.findActiveByTrigger.mockResolvedValue([marketing]);
      candidateRepository.findRecipientMarketingConsent.mockResolvedValue(false);

      await service.enter("wl", registeredWaitlist);

      expect(candidateRepository.findRecipientMarketingConsent).toHaveBeenCalledWith({
        recipientType: "waitlist",
        recipientId: "wl-1",
      });
      expect(enrollmentRepository.createEnrollment).not.toHaveBeenCalled();
    });

    it("enter: the same recipient is still enrolled in a service automation", async () => {
      automationRepository.findActiveByTrigger.mockResolvedValue([marketing, service_]);
      candidateRepository.findRecipientMarketingConsent.mockResolvedValue(false);

      await service.enter("wl", registeredWaitlist);

      expect(enrollmentRepository.createEnrollment).toHaveBeenCalledTimes(1);
      expect(enrollmentRepository.createEnrollment).toHaveBeenCalledWith(
        expect.objectContaining({ automationId: service_.id }),
      );
    });

    it("enter: the record's consent enrols in marketing even when the payload says no", async () => {
      automationRepository.findActiveByTrigger.mockResolvedValue([marketing]);
      candidateRepository.findRecipientMarketingConsent.mockResolvedValue(true);

      await service.enter("wl", { ...registeredWaitlist, marketingConsent: false });

      expect(enrollmentRepository.createEnrollment).toHaveBeenCalledWith(
        expect.objectContaining({ automationId: marketing.id }),
      );
    });

    it("enter: reads the consent once for several marketing automations", async () => {
      automationRepository.findActiveByTrigger.mockResolvedValue([marketing, { ...marketing, id: "automation-m2" }]);

      await service.enter("wl", registeredWaitlist);

      expect(candidateRepository.findRecipientMarketingConsent).toHaveBeenCalledTimes(1);
      expect(enrollmentRepository.createEnrollment).toHaveBeenCalledTimes(2);
    });
  });

  describe("enrol", () => {
    it("enrol: answers no_steps when the automation has no head step", async () => {
      stepRepository.findHead.mockResolvedValue(null);

      await expect(service.enrol({ automation: automationB, recipient: userRecipient })).resolves.toEqual({
        status: "no_steps",
      });
      expect(enrollmentRepository.createEnrollment).not.toHaveBeenCalled();
    });

    it("enrol: answers already_enrolled when an enrolment exists", async () => {
      enrollmentRepository.findByAutomationAndEmail.mockResolvedValue({
        id: "enrollment-1",
        status: "exited",
      } as EmailAutomationEnrollment);

      await expect(service.enrol({ automation: automationB, recipient: userRecipient })).resolves.toEqual({
        status: "already_enrolled",
      });
      expect(enrollmentRepository.createEnrollment).not.toHaveBeenCalled();
    });

    it("enrol: uses the given enrollmentId", async () => {
      const result = await service.enrol({
        automation: automationB,
        recipient: userRecipient,
        enrollmentId: "given-id",
      });

      expect(result).toEqual({ status: "enrolled", enrollmentId: "given-id" });
      expect(enrollmentRepository.createEnrollment).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "given-id",
          automationId: automationB.id,
          stepId: head.id,
          recipient: userRecipient,
          enrolledAt: now,
          nextSendAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        }),
      );
    });

    it("enrol: generates an id when none is given and does not check consent", async () => {
      const result = await service.enrol({
        automation: automationB,
        recipient: { ...userRecipient, marketingConsent: false },
      });

      expect(result.status).toBe("enrolled");
      const id = result.status === "enrolled" ? result.enrollmentId : "";
      expect(id).toMatch(UUID);
      expect(enrollmentRepository.createEnrollment.mock.calls[0][0].id).toBe(id);
    });
  });
});
