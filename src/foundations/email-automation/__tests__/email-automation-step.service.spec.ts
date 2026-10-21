import { BadRequestException } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MockedObject } from "vitest";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { EmailAutomationStep } from "../entities/email-automation-step";
import { EmailAutomationEnrollmentRepository } from "../repositories/email-automation-enrollment.repository";
import { EmailAutomationStepRepository } from "../repositories/email-automation-step.repository";
import { EmailAutomationStepService } from "../services/email-automation-step.service";

const step = (id: string, automationId = "auto-1", nextId?: string): EmailAutomationStep =>
  ({
    id,
    subject: `Subject ${id}`,
    body: "Body",
    delayHours: 24,
    automation: { id: automationId },
    next: nextId ? { id: nextId } : undefined,
  }) as unknown as EmailAutomationStep;

describe("EmailAutomationStepService", () => {
  let service: EmailAutomationStepService;
  let stepRepository: MockedObject<EmailAutomationStepRepository>;
  let enrollmentRepository: MockedObject<EmailAutomationEnrollmentRepository>;
  let jsonApiService: MockedObject<JsonApiService>;
  let clsService: MockedObject<ClsService>;
  let steps: Record<string, EmailAutomationStep>;

  beforeEach(() => {
    steps = {};

    stepRepository = {
      findById: vi.fn(async ({ id }: { id: string }) => steps[id]),
      findByAutomation: vi.fn(),
      findPrevious: vi.fn(),
      setNext: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    } as unknown as MockedObject<EmailAutomationStepRepository>;

    enrollmentRepository = {
      repointStep: vi.fn().mockResolvedValue(undefined),
    } as unknown as MockedObject<EmailAutomationEnrollmentRepository>;

    jsonApiService = {
      buildSingle: vi.fn().mockResolvedValue({ data: { id: "built" } }),
      buildList: vi.fn().mockResolvedValue({ data: [] }),
    } as unknown as MockedObject<JsonApiService>;

    clsService = { get: vi.fn().mockReturnValue("user-1") } as unknown as MockedObject<ClsService>;

    service = new EmailAutomationStepService(jsonApiService, stepRepository, clsService, enrollmentRepository);
  });

  describe("setNext", () => {
    it("rejects a step pointing at itself without touching the chain", async () => {
      steps = { a: step("a") };

      await expect(service.setNext({ stepId: "a", nextStepId: "a" })).rejects.toBeInstanceOf(BadRequestException);
      expect(stepRepository.setNext).not.toHaveBeenCalled();
    });

    it("rejects a link that would close a loop", async () => {
      steps = { a: step("a", "auto-1", "b"), b: step("b") };
      stepRepository.findByAutomation.mockResolvedValue([step("a", "auto-1", "b"), step("b")]);

      await expect(service.setNext({ stepId: "b", nextStepId: "a" })).rejects.toBeInstanceOf(BadRequestException);
      expect(stepRepository.setNext).not.toHaveBeenCalled();
    });

    it("rejects a successor that already follows another step", async () => {
      steps = { a: step("a", "auto-1", "b"), b: step("b"), c: step("c") };
      stepRepository.findByAutomation.mockResolvedValue([step("a", "auto-1", "b"), step("b"), step("c")]);

      await expect(service.setNext({ stepId: "c", nextStepId: "b" })).rejects.toBeInstanceOf(BadRequestException);
      expect(stepRepository.setNext).not.toHaveBeenCalled();
    });

    it("rejects steps from different automations", async () => {
      steps = { a: step("a", "auto-1"), x: step("x", "auto-2") };
      stepRepository.findByAutomation.mockResolvedValue([]);

      await expect(service.setNext({ stepId: "a", nextStepId: "x" })).rejects.toBeInstanceOf(BadRequestException);
      expect(stepRepository.setNext).not.toHaveBeenCalled();
    });

    it("links two steps and returns the updated step", async () => {
      steps = { a: step("a"), b: step("b") };
      stepRepository.findByAutomation.mockResolvedValue([step("a"), step("b")]);

      const result = await service.setNext({ stepId: "a", nextStepId: "b" });

      expect(stepRepository.setNext).toHaveBeenCalledWith({ stepId: "a", nextStepId: "b" });
      expect(stepRepository.findById).toHaveBeenLastCalledWith({ id: "a" });
      expect(result).toEqual({ data: { id: "built" } });
    });

    it("clears the successor when nextStepId is null", async () => {
      steps = { a: step("a", "auto-1", "b") };

      await service.setNext({ stepId: "a", nextStepId: null });

      expect(stepRepository.setNext).toHaveBeenCalledWith({ stepId: "a", nextStepId: null });
    });
  });

  describe("findAutomationId", () => {
    it("returns the id of the step's parent automation", async () => {
      steps = { a: step("a", "auto-7") };

      await expect(service.findAutomationId({ stepId: "a" })).resolves.toBe("auto-7");
    });
  });

  describe("deleteStep", () => {
    it("returns the id of the deleted step's parent automation", async () => {
      steps = { a: step("a", "auto-3") };
      stepRepository.findPrevious.mockResolvedValue(null);

      await expect(service.deleteStep({ id: "a" })).resolves.toBe("auto-3");
    });

    it("closes the gap and moves waiting people to the successor", async () => {
      steps = { a: step("a", "auto-1", "b"), b: step("b", "auto-1", "c"), c: step("c") };
      stepRepository.findPrevious.mockResolvedValue(steps.a);

      await service.deleteStep({ id: "b" });

      expect(stepRepository.setNext).toHaveBeenCalledWith({ stepId: "a", nextStepId: "c" });
      expect(enrollmentRepository.repointStep).toHaveBeenCalledWith(
        expect.objectContaining({ fromStepId: "b", toStepId: "c" }),
      );
      expect(stepRepository.delete).toHaveBeenCalledWith({ id: "b" });
      expect(enrollmentRepository.repointStep.mock.invocationCallOrder[0]).toBeLessThan(
        stepRepository.delete.mock.invocationCallOrder[0],
      );
    });

    it("completes waiting people when the last step is deleted", async () => {
      steps = { a: step("a", "auto-1", "b"), b: step("b") };
      stepRepository.findPrevious.mockResolvedValue(steps.a);

      await service.deleteStep({ id: "b" });

      expect(stepRepository.setNext).toHaveBeenCalledWith({ stepId: "a", nextStepId: null });
      expect(enrollmentRepository.repointStep).toHaveBeenCalledWith(
        expect.objectContaining({ fromStepId: "b", toStepId: null }),
      );
      expect(stepRepository.delete).toHaveBeenCalledWith({ id: "b" });
    });

    it("does not relink when the deleted step is the head", async () => {
      steps = { a: step("a", "auto-1", "b"), b: step("b") };
      stepRepository.findPrevious.mockResolvedValue(null);

      await service.deleteStep({ id: "a" });

      expect(stepRepository.setNext).not.toHaveBeenCalled();
      expect(enrollmentRepository.repointStep).toHaveBeenCalledWith(
        expect.objectContaining({ fromStepId: "a", toStepId: "b" }),
      );
      expect(stepRepository.delete).toHaveBeenCalledWith({ id: "a" });
    });
  });
});
