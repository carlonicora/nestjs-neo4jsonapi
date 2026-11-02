import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MockedObject } from "vitest";
import { JsonApiPaginator } from "../../../core/jsonapi/serialisers/jsonapi.paginator";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AbstractService } from "../../../core/neo4j/abstracts/abstract.service";
import { EmailAutomationCandidate, EmailAutomationCandidateDescriptor } from "../entities/email-automation-candidate";
import { EmailAutomationEnrollmentDescriptor } from "../entities/email-automation-enrollment";
import { EmailAutomationTriggerDescriptor } from "../entities/email-automation-trigger";
import { EmailAutomationModuleConfig } from "../interfaces/email-automation.config.interface";
import { EmailAutomationEnrollmentRepository } from "../repositories/email-automation-enrollment.repository";
import { EmailAutomationStepRepository } from "../repositories/email-automation-step.repository";
import { EmailAutomationRepository } from "../repositories/email-automation.repository";
import { EmailAutomationCandidateRepository } from "../repositories/email-automation-candidate.repository";
import { EmailAutomationTriggerService } from "../services/email-automation-trigger.service";
import { EmailAutomationService } from "../services/email-automation.service";

describe("EmailAutomationService", () => {
  let service: EmailAutomationService;
  let repository: MockedObject<EmailAutomationRepository>;
  let stepRepository: MockedObject<EmailAutomationStepRepository>;
  let enrollmentRepository: MockedObject<EmailAutomationEnrollmentRepository>;
  let jsonApiService: MockedObject<JsonApiService>;
  let clsService: MockedObject<ClsService>;
  let triggerService: MockedObject<EmailAutomationTriggerService>;
  let candidateRepository: MockedObject<EmailAutomationCandidateRepository>;

  const config: Required<EmailAutomationModuleConfig> = {
    triggers: [
      { key: "wl", label: "Waitlist confirmed", event: "waitlist.confirmed", toRecipient: () => null },
      { key: "reg", label: "Registration completed", event: "user.activated", toRecipient: () => null },
    ],
  };

  const dto = (attributes: Record<string, any>) => ({
    data: { id: "auto-1", type: "email-automations", attributes },
  });

  beforeEach(() => {
    repository = {
      findById: vi.fn().mockResolvedValue({ id: "auto-1", purpose: "marketing" }),
    } as unknown as MockedObject<EmailAutomationRepository>;
    stepRepository = {
      clearPositions: vi.fn().mockResolvedValue(undefined),
    } as unknown as MockedObject<EmailAutomationStepRepository>;
    enrollmentRepository = {
      findByAutomation: vi.fn().mockResolvedValue([]),
      findById: vi.fn().mockResolvedValue({ id: "6f1c1f3e-8a5b-4c3d-9e2f-1a2b3c4d5e6f" }),
    } as unknown as MockedObject<EmailAutomationEnrollmentRepository>;
    jsonApiService = {
      buildList: vi.fn(async (_model: unknown, records: any[]) => ({ data: records })),
      buildSingle: vi.fn().mockResolvedValue({ data: {} }),
    } as unknown as MockedObject<JsonApiService>;
    clsService = { get: vi.fn() } as unknown as MockedObject<ClsService>;
    triggerService = {
      enrol: vi.fn().mockResolvedValue({ status: "enrolled", enrollmentId: "6f1c1f3e-8a5b-4c3d-9e2f-1a2b3c4d5e6f" }),
    } as unknown as MockedObject<EmailAutomationTriggerService>;
    candidateRepository = {
      findCandidates: vi.fn().mockResolvedValue([]),
      findCandidate: vi.fn().mockResolvedValue(null),
    } as unknown as MockedObject<EmailAutomationCandidateRepository>;

    service = new EmailAutomationService(
      jsonApiService,
      repository,
      clsService,
      stepRepository,
      enrollmentRepository,
      config,
      triggerService,
      candidateRepository,
    );
  });

  it("listTriggers lists every declared trigger with its key as id", async () => {
    const result = await service.listTriggers();

    expect(jsonApiService.buildList).toHaveBeenCalledWith(
      EmailAutomationTriggerDescriptor.model,
      expect.any(Array),
      expect.any(JsonApiPaginator),
    );
    expect(result.data).toEqual([
      { id: "wl", key: "wl", label: "Waitlist confirmed" },
      { id: "reg", key: "reg", label: "Registration completed" },
    ]);
  });

  it("createFromDTO rejects an unknown trigger", async () => {
    const superCreate = vi.spyOn(AbstractService.prototype, "createFromDTO").mockResolvedValue({ data: {} } as any);

    await expect(service.createFromDTO(dto({ name: "Welcome", trigger: "unknown" }))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(superCreate).not.toHaveBeenCalled();

    superCreate.mockRestore();
  });

  it("createFromDTO rejects an unknown exit trigger", async () => {
    const superCreate = vi.spyOn(AbstractService.prototype, "createFromDTO").mockResolvedValue({ data: {} } as any);

    await expect(
      service.createFromDTO(dto({ name: "Welcome", trigger: "wl", exitTrigger: "nope" })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(superCreate).not.toHaveBeenCalled();

    superCreate.mockRestore();
  });

  it("createFromDTO with declared keys delegates to the base service", async () => {
    const superCreate = vi.spyOn(AbstractService.prototype, "createFromDTO").mockResolvedValue({ data: {} } as any);
    const params = dto({ name: "Welcome", trigger: "wl", exitTrigger: "reg" });

    await service.createFromDTO(params);

    expect(superCreate).toHaveBeenCalledWith(params);

    superCreate.mockRestore();
  });

  it("patchFromDTO rejects an unknown trigger and accepts an empty one", async () => {
    const superPatch = vi.spyOn(AbstractService.prototype, "patchFromDTO").mockResolvedValue({ data: {} } as any);

    await expect(service.patchFromDTO(dto({ trigger: "unknown" }))).rejects.toBeInstanceOf(BadRequestException);
    expect(superPatch).not.toHaveBeenCalled();

    await service.patchFromDTO(dto({ trigger: "" }));
    expect(superPatch).toHaveBeenCalledTimes(1);

    superPatch.mockRestore();
  });

  it("findEnrollments pages the automation's enrolments filtered by status", async () => {
    await service.findEnrollments({ id: "auto-1", status: "active", query: {} });

    expect(enrollmentRepository.findByAutomation).toHaveBeenCalledWith({
      automationId: "auto-1",
      status: "active",
      cursor: expect.anything(),
    });
    expect(jsonApiService.buildList).toHaveBeenCalledWith(
      EmailAutomationEnrollmentDescriptor.model,
      [],
      expect.any(JsonApiPaginator),
    );
  });

  it("tidy clears the saved positions of the automation's steps", async () => {
    await service.tidy({ id: "auto-1" });

    expect(stepRepository.clearPositions).toHaveBeenCalledWith({ automationId: "auto-1" });
  });
  describe("manual add", () => {
    const enrollmentId = "6f1c1f3e-8a5b-4c3d-9e2f-1a2b3c4d5e6f";

    const candidate = (overrides: Partial<EmailAutomationCandidate> = {}): EmailAutomationCandidate =>
      ({
        id: "waitlist-wl-1",
        type: "email-automation-candidates",
        recipientType: "waitlist",
        recipientId: "wl-1",
        email: "ann@example.com",
        name: undefined,
        marketingConsent: true,
        optedOut: false,
        alreadyEnrolled: false,
        addable: false,
        reason: undefined,
        ...overrides,
      }) as EmailAutomationCandidate;

    const addDto = {
      id: enrollmentId,
      type: "email-automation-enrollments",
      attributes: { recipientType: "waitlist", recipientId: "wl-1" },
    };

    it("findCandidates marks a no-consent person not addable on a marketing automation", async () => {
      candidateRepository.findCandidates.mockResolvedValue([candidate({ marketingConsent: false })]);

      const query = { search: "ann", page: { size: "10", offset: "20" } };
      const result = await service.findCandidates({ id: "auto-1", search: "ann", query });

      expect(candidateRepository.findCandidates).toHaveBeenCalledWith({
        automationId: "auto-1",
        search: "ann",
        cursor: new JsonApiPaginator(query).generateCursor(),
      });
      expect(candidateRepository.findCandidates.mock.calls[0][0].cursor).toMatchObject({ cursor: 20, take: 11 });
      expect(jsonApiService.buildList).toHaveBeenCalledWith(
        EmailAutomationCandidateDescriptor.model,
        expect.any(Array),
        expect.any(JsonApiPaginator),
      );
      expect(result.data).toEqual([expect.objectContaining({ addable: false, reason: "no_consent" })]);
    });

    it("findCandidates marks the same person addable on a service automation", async () => {
      repository.findById.mockResolvedValue({ id: "auto-1", purpose: "service" } as never);
      candidateRepository.findCandidates.mockResolvedValue([candidate({ marketingConsent: false, optedOut: true })]);

      const result = await service.findCandidates({ id: "auto-1", query: {} });

      expect(result.data).toEqual([expect.objectContaining({ addable: true, reason: undefined })]);
    });

    it("findCandidates marks an enrolled person already_enrolled", async () => {
      candidateRepository.findCandidates.mockResolvedValue([candidate({ alreadyEnrolled: true })]);

      const result = await service.findCandidates({ id: "auto-1", query: {} });

      expect(result.data).toEqual([expect.objectContaining({ addable: false, reason: "already_enrolled" })]);
    });

    it("findCandidates returns 404 when the automation is missing", async () => {
      repository.findById.mockResolvedValue(null as never);

      await expect(service.findCandidates({ id: "auto-1", query: {} })).rejects.toBeInstanceOf(NotFoundException);
    });

    it("addEnrollment enrols an addable waitlist entry through trigger.enrol with the DTO id", async () => {
      candidateRepository.findCandidate.mockResolvedValue(candidate());

      await service.addEnrollment({ id: "auto-1", data: addDto });

      expect(candidateRepository.findCandidate).toHaveBeenCalledWith({
        automationId: "auto-1",
        recipientType: "waitlist",
        recipientId: "wl-1",
      });
      expect(triggerService.enrol).toHaveBeenCalledWith({
        automation: expect.objectContaining({ id: "auto-1" }),
        recipient: {
          email: "ann@example.com",
          name: undefined,
          recipientType: "waitlist",
          recipientId: "wl-1",
          marketingConsent: true,
        },
        enrollmentId,
      });
      expect(enrollmentRepository.findById).toHaveBeenCalledWith({ id: enrollmentId });
      expect(jsonApiService.buildSingle).toHaveBeenCalledWith(EmailAutomationEnrollmentDescriptor.model, {
        id: enrollmentId,
      });
    });

    it("addEnrollment refuses an opted-out person on a marketing automation", async () => {
      candidateRepository.findCandidate.mockResolvedValue(candidate({ optedOut: true }));

      await expect(service.addEnrollment({ id: "auto-1", data: addDto })).rejects.toThrow(
        new BadRequestException("Unsubscribed from marketing"),
      );
      expect(triggerService.enrol).not.toHaveBeenCalled();
    });

    it('addEnrollment returns 400 "This automation has no emails yet" when enrol finds no head step', async () => {
      candidateRepository.findCandidate.mockResolvedValue(candidate());
      triggerService.enrol.mockResolvedValue({ status: "no_steps" });

      await expect(service.addEnrollment({ id: "auto-1", data: addDto })).rejects.toThrow(
        new BadRequestException("This automation has no emails yet"),
      );
    });

    it('addEnrollment returns 400 "Already in this automation" when the person got enrolled after the check', async () => {
      // The candidate read said not enrolled; a trigger enrolled the same address before the write.
      candidateRepository.findCandidate.mockResolvedValue(candidate({ alreadyEnrolled: false }));
      triggerService.enrol.mockResolvedValue({ status: "already_enrolled" });

      await expect(service.addEnrollment({ id: "auto-1", data: addDto })).rejects.toThrow(
        new BadRequestException("Already in this automation"),
      );
      expect(enrollmentRepository.findById).not.toHaveBeenCalled();
    });

    it('addEnrollment returns 404 "Person not found"', async () => {
      candidateRepository.findCandidate.mockResolvedValue(null);

      await expect(service.addEnrollment({ id: "auto-1", data: addDto })).rejects.toThrow(
        new NotFoundException("Person not found"),
      );
      expect(triggerService.enrol).not.toHaveBeenCalled();
    });
  });
});
