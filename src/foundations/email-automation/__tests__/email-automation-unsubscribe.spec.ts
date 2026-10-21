import { NotFoundException } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockedObject } from "vitest";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import {
  EmailAutomationEnrollment,
  EmailAutomationEnrollmentDescriptor,
} from "../entities/email-automation-enrollment";
import { EmailAutomationEnrollmentRepository } from "../repositories/email-automation-enrollment.repository";
import { EmailOptOutRepository } from "../repositories/email-opt-out.repository";
import { EmailAutomationUnsubscribeService } from "../services/email-automation-unsubscribe.service";

const NOW = new Date("2026-10-21T10:00:00.000Z");

describe("EmailAutomationUnsubscribeService", () => {
  let service: EmailAutomationUnsubscribeService;
  let jsonApiService: MockedObject<JsonApiService>;
  let enrollmentRepository: MockedObject<EmailAutomationEnrollmentRepository>;
  let optOutRepository: MockedObject<EmailOptOutRepository>;

  const document = { data: { type: "email-automation-enrollments", id: "enrollment-1" } };

  const buildEnrollment = (overrides: Partial<EmailAutomationEnrollment> = {}): EmailAutomationEnrollment =>
    ({
      id: "enrollment-1",
      email: "player@example.com",
      status: "active",
      attempts: 0,
      automation: { id: "automation-1", name: "Welcome" },
      ...overrides,
    }) as EmailAutomationEnrollment;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    jsonApiService = {
      buildSingle: vi.fn().mockResolvedValue(document),
    } as unknown as MockedObject<JsonApiService>;
    enrollmentRepository = {
      findByUnsubscribeToken: vi.fn(),
      findActiveByEmail: vi.fn().mockResolvedValue([]),
      finish: vi.fn().mockResolvedValue(undefined),
    } as unknown as MockedObject<EmailAutomationEnrollmentRepository>;
    optOutRepository = {
      createOptOut: vi.fn().mockResolvedValue(undefined),
    } as unknown as MockedObject<EmailOptOutRepository>;

    service = new EmailAutomationUnsubscribeService(
      jsonApiService,
      enrollmentRepository,
      {} as ClsService,
      optOutRepository,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("answers 404 for an unknown token", async () => {
    enrollmentRepository.findByUnsubscribeToken.mockResolvedValue(null);

    await expect(service.unsubscribe({ token: "unknown", scope: "all", source: "header" })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(enrollmentRepository.finish).not.toHaveBeenCalled();
    expect(optOutRepository.createOptOut).not.toHaveBeenCalled();
  });

  it("stops one automation without an opt-out", async () => {
    enrollmentRepository.findByUnsubscribeToken.mockResolvedValue(buildEnrollment());

    await service.unsubscribe({ token: "token-1", scope: "automation", source: "link" });

    expect(enrollmentRepository.findByUnsubscribeToken).toHaveBeenCalledWith({ token: "token-1" });
    expect(enrollmentRepository.finish).toHaveBeenCalledTimes(1);
    expect(enrollmentRepository.finish).toHaveBeenCalledWith({
      enrollmentId: "enrollment-1",
      status: "unsubscribed",
      finishedAt: NOW,
    });
    expect(enrollmentRepository.findActiveByEmail).not.toHaveBeenCalled();
    expect(optOutRepository.createOptOut).not.toHaveBeenCalled();
  });

  it("changes nothing on an already finished enrolment and still resolves", async () => {
    enrollmentRepository.findByUnsubscribeToken.mockResolvedValue(buildEnrollment({ status: "unsubscribed" }));

    await expect(service.unsubscribe({ token: "token-1", scope: "automation", source: "link" })).resolves.toEqual(
      document,
    );
    expect(enrollmentRepository.finish).not.toHaveBeenCalled();
    expect(optOutRepository.createOptOut).not.toHaveBeenCalled();
  });

  it("stops every active enrolment of the address and records the opt-out", async () => {
    enrollmentRepository.findByUnsubscribeToken.mockResolvedValue(buildEnrollment());
    enrollmentRepository.findActiveByEmail.mockResolvedValue([
      buildEnrollment({ id: "enrollment-2" }),
      buildEnrollment({ id: "enrollment-3" }),
    ]);

    await service.unsubscribe({ token: "token-1", scope: "all", source: "header" });

    expect(enrollmentRepository.findActiveByEmail).toHaveBeenCalledWith({ email: "player@example.com" });
    for (const enrollmentId of ["enrollment-1", "enrollment-2", "enrollment-3"]) {
      expect(enrollmentRepository.finish).toHaveBeenCalledWith({
        enrollmentId,
        status: "unsubscribed",
        finishedAt: NOW,
      });
    }
    expect(enrollmentRepository.finish).toHaveBeenCalledTimes(3);
    expect(optOutRepository.createOptOut).toHaveBeenCalledWith({
      id: expect.any(String),
      email: "player@example.com",
      optedOutAt: NOW,
      source: "header",
    });
  });

  it("returns the enrolment as a JSON:API document", async () => {
    const before = buildEnrollment();
    const after = buildEnrollment({ status: "unsubscribed" });
    enrollmentRepository.findByUnsubscribeToken.mockResolvedValueOnce(before).mockResolvedValueOnce(after);

    const result = await service.unsubscribe({ token: "token-1", scope: "automation", source: "link" });

    expect(jsonApiService.buildSingle).toHaveBeenCalledWith(EmailAutomationEnrollmentDescriptor.model, after);
    expect(result).toBe(document);
  });
});
