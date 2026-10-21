import { BadRequestException } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MockedObject } from "vitest";
import { JsonApiPaginator } from "../../../core/jsonapi/serialisers/jsonapi.paginator";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AbstractService } from "../../../core/neo4j/abstracts/abstract.service";
import { EmailAutomationEnrollmentDescriptor } from "../entities/email-automation-enrollment";
import { EmailAutomationTriggerDescriptor } from "../entities/email-automation-trigger";
import { EmailAutomationModuleConfig } from "../interfaces/email-automation.config.interface";
import { EmailAutomationEnrollmentRepository } from "../repositories/email-automation-enrollment.repository";
import { EmailAutomationStepRepository } from "../repositories/email-automation-step.repository";
import { EmailAutomationRepository } from "../repositories/email-automation.repository";
import { EmailAutomationService } from "../services/email-automation.service";

describe("EmailAutomationService", () => {
  let service: EmailAutomationService;
  let repository: MockedObject<EmailAutomationRepository>;
  let stepRepository: MockedObject<EmailAutomationStepRepository>;
  let enrollmentRepository: MockedObject<EmailAutomationEnrollmentRepository>;
  let jsonApiService: MockedObject<JsonApiService>;
  let clsService: MockedObject<ClsService>;

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
    repository = {} as unknown as MockedObject<EmailAutomationRepository>;
    stepRepository = {
      clearPositions: vi.fn().mockResolvedValue(undefined),
    } as unknown as MockedObject<EmailAutomationStepRepository>;
    enrollmentRepository = {
      findByAutomation: vi.fn().mockResolvedValue([]),
    } as unknown as MockedObject<EmailAutomationEnrollmentRepository>;
    jsonApiService = {
      buildList: vi.fn(async (_model: unknown, records: any[]) => ({ data: records })),
      buildSingle: vi.fn().mockResolvedValue({ data: {} }),
    } as unknown as MockedObject<JsonApiService>;
    clsService = { get: vi.fn() } as unknown as MockedObject<ClsService>;

    service = new EmailAutomationService(
      jsonApiService,
      repository,
      clsService,
      stepRepository,
      enrollmentRepository,
      config,
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
});
