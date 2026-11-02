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
      findActiveMarketingByEmail: vi.fn().mockResolvedValue([]),
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
    enrollmentRepository.findActiveMarketingByEmail.mockResolvedValue([
      buildEnrollment({ id: "enrollment-2" }),
      buildEnrollment({ id: "enrollment-3" }),
    ]);

    await service.unsubscribe({ token: "token-1", scope: "all", source: "header" });

    expect(enrollmentRepository.findActiveMarketingByEmail).toHaveBeenCalledWith({ email: "player@example.com" });
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

  it("scope all finishes only marketing enrolments", async () => {
    // The token's own enrolment is a Service one: "Stop these emails" still ends it.
    enrollmentRepository.findByUnsubscribeToken.mockResolvedValue(
      buildEnrollment({ automation: { id: "automation-1", name: "Welcome", purpose: "service" } as any }),
    );
    enrollmentRepository.findActiveMarketingByEmail.mockResolvedValue([buildEnrollment({ id: "enrollment-m" })]);

    await service.unsubscribe({ token: "token-1", scope: "all", source: "link" });

    expect(enrollmentRepository.findActiveMarketingByEmail).toHaveBeenCalledWith({ email: "player@example.com" });
    expect(enrollmentRepository.finish.mock.calls.map((call) => call[0].enrollmentId).sort()).toEqual([
      "enrollment-1",
      "enrollment-m",
    ]);
    expect(optOutRepository.createOptOut).toHaveBeenCalledTimes(1);
  });

  it("returns the enrolment as a JSON:API document", async () => {
    const before = buildEnrollment();
    const after = buildEnrollment({ status: "unsubscribed" });
    enrollmentRepository.findByUnsubscribeToken.mockResolvedValueOnce(before).mockResolvedValueOnce(after);

    const result = await service.unsubscribe({ token: "token-1", scope: "automation", source: "link" });

    expect(jsonApiService.buildSingle).toHaveBeenCalledWith(EmailAutomationEnrollmentDescriptor.model, after);
    expect(result).toBe(document);
  });

  it("the public answer never carries the recipient's marketing consent", async () => {
    // A real JsonApiService over the real enrolment serialiser: what the public route sends.
    const configService = { get: vi.fn(() => ({ url: "https://api.test/" })) } as any;
    const Serialiser = EmailAutomationEnrollmentDescriptor.model.serialiser as any;
    const serialiser = new Serialiser({} as any, {} as any, configService);
    const realJsonApiService = new JsonApiService(
      { create: vi.fn(() => serialiser) } as any,
      { get: vi.fn(), has: vi.fn(() => false) } as unknown as ClsService,
      configService,
    );
    const publicService = new EmailAutomationUnsubscribeService(
      realJsonApiService,
      enrollmentRepository,
      {} as ClsService,
      optOutRepository,
    );
    enrollmentRepository.findByUnsubscribeToken.mockResolvedValue(
      buildEnrollment({ status: "unsubscribed", recipientMarketingConsent: false, automation: undefined }),
    );

    const result: any = await publicService.unsubscribe({ token: "token-1", scope: "automation", source: "link" });

    expect(result.data.type).toBe("email-automation-enrollments");
    expect(result.data.attributes.status).toBe("unsubscribed");
    expect(result.data.attributes).not.toHaveProperty("recipientMarketingConsent");
    expect(result.data.meta ?? {}).not.toHaveProperty("recipientMarketingConsent");
    expect(JSON.stringify(result)).not.toContain("recipientMarketingConsent");
  });
});
