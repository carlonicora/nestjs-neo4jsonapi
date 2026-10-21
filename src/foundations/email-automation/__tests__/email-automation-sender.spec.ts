import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockedObject } from "vitest";
import { EmailService } from "../../../core/email/services/email.service";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { ResponseLanguageService } from "../../user/services/response-language.service";
import { EmailAutomationSenderCron } from "../cron/email-automation-sender.cron";
import { EmailAutomation } from "../entities/email-automation";
import { EmailAutomationEnrollment } from "../entities/email-automation-enrollment";
import { EmailAutomationStep } from "../entities/email-automation-step";
import { EmailOptOut } from "../entities/email-opt-out";
import { EmailAutomationEnrollmentRepository } from "../repositories/email-automation-enrollment.repository";
import { EmailAutomationStepRepository } from "../repositories/email-automation-step.repository";
import { EmailOptOutRepository } from "../repositories/email-opt-out.repository";
import { EmailAutomationRenderer } from "../services/email-automation-renderer.service";
import { EmailAutomationSenderService } from "../services/email-automation-sender.service";

const NOW = new Date("2026-10-21T10:00:00.000Z");
const ONE_HOUR_LATER = new Date("2026-10-21T11:00:00.000Z");

describe("EmailAutomationSenderService", () => {
  let service: EmailAutomationSenderService;
  let enrollmentRepository: MockedObject<EmailAutomationEnrollmentRepository>;
  let stepRepository: MockedObject<EmailAutomationStepRepository>;
  let optOutRepository: MockedObject<EmailOptOutRepository>;
  let renderer: MockedObject<EmailAutomationRenderer>;
  let emailService: MockedObject<EmailService>;
  let responseLanguage: MockedObject<ResponseLanguageService>;
  let logger: MockedObject<AppLoggingService>;

  const automation = { id: "automation-1", name: "Welcome", replyTo: "hello@example.com" } as EmailAutomation;
  const stepTwo = { id: "s2", subject: "Second", body: "Two", delayHours: 1 } as EmailAutomationStep;
  const stepOne = { id: "s1", subject: "First", body: "One", delayHours: 0, next: stepTwo } as EmailAutomationStep;
  const lastStep = { id: "s1", subject: "First", body: "One", delayHours: 0 } as EmailAutomationStep;

  const rendered = {
    subject: "First",
    content: "<p>One</p>",
    headers: {
      "List-Unsubscribe": "<https://api.example.com/x>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    replyTo: "hello@example.com",
    unsubscribeUrl: "https://app.example.com/en/unsubscribe/token-1",
    unsubscribeAllUrl: "https://app.example.com/en/unsubscribe/token-1?scope=all",
  };

  const buildEnrollment = (overrides: Partial<EmailAutomationEnrollment> = {}): EmailAutomationEnrollment =>
    ({
      id: "enrollment-1",
      email: "player@example.com",
      status: "active",
      attempts: 0,
      unsubscribeToken: "token-1",
      automation,
      currentStep: { id: "s1" },
      ...overrides,
    }) as EmailAutomationEnrollment;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    enrollmentRepository = {
      findDue: vi.fn(),
      hasSent: vi.fn().mockResolvedValue(false),
      markSent: vi.fn().mockResolvedValue(undefined),
      advance: vi.fn().mockResolvedValue(undefined),
      finish: vi.fn().mockResolvedValue(undefined),
      recordFailure: vi.fn().mockResolvedValue(undefined),
    } as unknown as MockedObject<EmailAutomationEnrollmentRepository>;
    stepRepository = {
      findById: vi.fn().mockResolvedValue(stepOne),
    } as unknown as MockedObject<EmailAutomationStepRepository>;
    optOutRepository = {
      findByEmail: vi.fn().mockResolvedValue(null),
    } as unknown as MockedObject<EmailOptOutRepository>;
    renderer = {
      render: vi.fn().mockResolvedValue(rendered),
    } as unknown as MockedObject<EmailAutomationRenderer>;
    emailService = {
      sendEmail: vi.fn().mockResolvedValue(undefined),
    } as unknown as MockedObject<EmailService>;
    responseLanguage = {
      resolveForEmail: vi.fn().mockResolvedValue(undefined),
    } as unknown as MockedObject<ResponseLanguageService>;
    logger = {
      log: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    } as unknown as MockedObject<AppLoggingService>;

    service = new EmailAutomationSenderService(
      enrollmentRepository,
      stepRepository,
      optOutRepository,
      renderer,
      emailService,
      responseLanguage,
      logger,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends the current step, records it and moves to the next step", async () => {
    enrollmentRepository.findDue.mockResolvedValue([buildEnrollment()]);

    const result = await service.processDue({ now: new Date(), limit: 200 });

    expect(enrollmentRepository.findDue).toHaveBeenCalledWith({ now: NOW, limit: 200 });
    expect(responseLanguage.resolveForEmail).toHaveBeenCalledWith({ email: "player@example.com" });
    expect(emailService.sendEmail).toHaveBeenCalledTimes(1);
    expect(emailService.sendEmail).toHaveBeenCalledWith(
      "emailAutomation",
      {
        to: "player@example.com",
        subject: rendered.subject,
        content: rendered.content,
        replyTo: rendered.replyTo,
        headers: rendered.headers,
        unsubscribeUrl: rendered.unsubscribeUrl,
        unsubscribeAllUrl: rendered.unsubscribeAllUrl,
      },
      "en",
    );
    expect(enrollmentRepository.markSent).toHaveBeenCalledWith({
      enrollmentId: "enrollment-1",
      stepId: "s1",
      sentAt: NOW,
    });
    expect(enrollmentRepository.advance).toHaveBeenCalledWith({
      enrollmentId: "enrollment-1",
      nextStepId: "s2",
      nextSendAt: ONE_HOUR_LATER,
    });
    expect(enrollmentRepository.finish).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 1, skipped: 0, failed: 0 });
  });

  it("uses the recipient's saved language", async () => {
    enrollmentRepository.findDue.mockResolvedValue([buildEnrollment()]);
    responseLanguage.resolveForEmail.mockResolvedValue("it");

    await service.processDue({ now: new Date(), limit: 200 });

    expect(renderer.render).toHaveBeenCalledWith({
      step: stepOne,
      enrollment: expect.objectContaining({ id: "enrollment-1" }),
      automation,
      locale: "it",
    });
    expect(emailService.sendEmail).toHaveBeenCalledWith("emailAutomation", expect.any(Object), "it");
  });

  it("completes the enrolment after the last step", async () => {
    enrollmentRepository.findDue.mockResolvedValue([buildEnrollment()]);
    stepRepository.findById.mockResolvedValue(lastStep);

    await service.processDue({ now: new Date(), limit: 200 });

    expect(enrollmentRepository.markSent).toHaveBeenCalled();
    expect(enrollmentRepository.advance).not.toHaveBeenCalled();
    expect(enrollmentRepository.finish).toHaveBeenCalledWith({
      enrollmentId: "enrollment-1",
      status: "completed",
      finishedAt: NOW,
    });
  });

  it("does not send a step twice after a crash between send and bookkeeping, but still advances", async () => {
    enrollmentRepository.findDue.mockResolvedValue([buildEnrollment()]);
    enrollmentRepository.hasSent.mockResolvedValue(true);

    const result = await service.processDue({ now: new Date(), limit: 200 });

    expect(enrollmentRepository.hasSent).toHaveBeenCalledWith({ enrollmentId: "enrollment-1", stepId: "s1" });
    expect(emailService.sendEmail).not.toHaveBeenCalled();
    expect(enrollmentRepository.markSent).not.toHaveBeenCalled();
    expect(enrollmentRepository.advance).toHaveBeenCalledWith({
      enrollmentId: "enrollment-1",
      nextStepId: "s2",
      nextSendAt: ONE_HOUR_LATER,
    });
    expect(result).toEqual({ sent: 0, skipped: 1, failed: 0 });
  });

  it("unsubscribes an opted-out address without sending", async () => {
    enrollmentRepository.findDue.mockResolvedValue([buildEnrollment()]);
    optOutRepository.findByEmail.mockResolvedValue({ id: "opt-1", email: "player@example.com" } as EmailOptOut);

    const result = await service.processDue({ now: new Date(), limit: 200 });

    expect(optOutRepository.findByEmail).toHaveBeenCalledWith({ email: "player@example.com" });
    expect(emailService.sendEmail).not.toHaveBeenCalled();
    expect(enrollmentRepository.finish).toHaveBeenCalledWith({
      enrollmentId: "enrollment-1",
      status: "unsubscribed",
      finishedAt: NOW,
    });
    expect(enrollmentRepository.advance).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, skipped: 1, failed: 0 });
  });

  it("records a failed send and retries in an hour", async () => {
    enrollmentRepository.findDue.mockResolvedValue([buildEnrollment({ attempts: 0 })]);
    emailService.sendEmail.mockRejectedValue(new Error("Brevo down"));

    const result = await service.processDue({ now: new Date(), limit: 200 });

    expect(enrollmentRepository.recordFailure).toHaveBeenCalledWith({
      enrollmentId: "enrollment-1",
      error: "Brevo down",
      nextSendAt: ONE_HOUR_LATER,
    });
    expect(enrollmentRepository.finish).not.toHaveBeenCalled();
    expect(enrollmentRepository.markSent).not.toHaveBeenCalled();
    expect(enrollmentRepository.advance).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, skipped: 0, failed: 1 });
  });

  it("marks the enrolment failed on the third failed attempt", async () => {
    enrollmentRepository.findDue.mockResolvedValue([buildEnrollment({ attempts: 2 })]);
    emailService.sendEmail.mockRejectedValue(new Error("Brevo down"));

    await service.processDue({ now: new Date(), limit: 200 });

    expect(enrollmentRepository.finish).toHaveBeenCalledWith({
      enrollmentId: "enrollment-1",
      status: "failed",
      finishedAt: NOW,
    });
    expect(enrollmentRepository.advance).not.toHaveBeenCalled();
  });

  it("keeps going after one enrolment throws and counts every outcome", async () => {
    enrollmentRepository.findDue.mockResolvedValue([
      buildEnrollment({ id: "enrollment-1" }),
      buildEnrollment({ id: "enrollment-2" }),
      buildEnrollment({ id: "enrollment-3" }),
    ]);
    enrollmentRepository.hasSent
      .mockRejectedValueOnce(new Error("Neo4j connection lost"))
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const result = await service.processDue({ now: new Date(), limit: 200 });

    expect(result).toEqual({ sent: 1, skipped: 1, failed: 1 });
    expect(logger.error).toHaveBeenCalledWith(
      "Failed to process email automation enrollment enrollment-1: Neo4j connection lost",
      "EmailAutomationSenderService",
    );
    expect(emailService.sendEmail).toHaveBeenCalledTimes(1);
  });
});

describe("EmailAutomationSenderCron", () => {
  let cron: EmailAutomationSenderCron;
  let senderService: MockedObject<EmailAutomationSenderService>;
  let logger: MockedObject<AppLoggingService>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    senderService = {
      processDue: vi.fn().mockResolvedValue({ sent: 2, skipped: 1, failed: 0 }),
    } as unknown as MockedObject<EmailAutomationSenderService>;
    logger = {
      log: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    } as unknown as MockedObject<AppLoggingService>;
    cron = new EmailAutomationSenderCron(senderService, logger);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("processes up to 200 due enrolments and logs the counts", async () => {
    await cron.run();

    expect(senderService.processDue).toHaveBeenCalledWith({ now: NOW, limit: 200 });
    expect(logger.log).toHaveBeenCalledWith(
      "Email automations: 2 sent, 1 skipped, 0 failed",
      "EmailAutomationSenderCron",
    );
  });

  it("logs and swallows a failure of the whole run", async () => {
    senderService.processDue.mockRejectedValue(new Error("Neo4j connection lost"));

    await expect(cron.run()).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      "Failed to process due email automations: Neo4j connection lost",
      "EmailAutomationSenderCron",
    );
  });
});
