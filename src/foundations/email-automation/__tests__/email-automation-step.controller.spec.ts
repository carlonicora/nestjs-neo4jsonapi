import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MockedObject } from "vitest";
import type { FastifyReply } from "fastify";
import type { AuthenticatedRequest } from "../../../common/interfaces/authenticated.request.interface";
import { CacheService } from "../../../core/cache/services/cache.service";
import { AuditService } from "../../audit/services/audit.service";
import { EmailAutomationStepController } from "../controllers/email-automation-step.controller";
import { EmailAutomationStepDataDTO } from "../dtos/email-automation-step.dto";
import { emailAutomationStepMeta } from "../entities/email-automation-step.meta";
import { emailAutomationMeta } from "../entities/email-automation.meta";
import { EmailAutomationStepService } from "../services/email-automation-step.service";

describe("EmailAutomationStepController", () => {
  let controller: EmailAutomationStepController;
  let stepService: MockedObject<EmailAutomationStepService>;
  let cacheService: MockedObject<CacheService>;
  let auditService: MockedObject<AuditService>;
  let reply: FastifyReply;
  const request = { params: { stepId: "step-1" } } as unknown as AuthenticatedRequest;

  beforeEach(() => {
    stepService = {
      deleteStep: vi.fn().mockResolvedValue("auto-1"),
      setNext: vi.fn().mockResolvedValue({ data: { id: "step-1" } }),
      findAutomationId: vi.fn().mockResolvedValue("auto-1"),
      findById: vi.fn().mockResolvedValue({ data: { id: "step-1" } }),
    } as unknown as MockedObject<EmailAutomationStepService>;

    cacheService = {
      invalidateByElement: vi.fn().mockResolvedValue(undefined),
      invalidateByType: vi.fn().mockResolvedValue(undefined),
    } as unknown as MockedObject<CacheService>;

    // Injected so the @Audit decorator (which reads this.auditService) is active at runtime.
    auditService = {
      logRead: vi.fn().mockResolvedValue(undefined),
    } as unknown as MockedObject<AuditService>;

    reply = { send: vi.fn() } as unknown as FastifyReply;

    controller = new EmailAutomationStepController(stepService, cacheService, auditService);
  });

  it("findById audits the read via @Audit with the step label and the stepId route param", async () => {
    await controller.findById(request, reply, "step-1");

    expect(auditService.logRead).toHaveBeenCalledWith({
      entityType: emailAutomationStepMeta.labelName,
      entityId: "step-1",
    });
  });

  it("delete invalidates the parent automation and the step", async () => {
    await controller.delete(request, reply, "step-1");

    expect(stepService.deleteStep).toHaveBeenCalledWith({ id: "step-1" });
    expect(cacheService.invalidateByElement).toHaveBeenCalledWith(emailAutomationMeta.endpoint, "auto-1");
    expect(cacheService.invalidateByElement).toHaveBeenCalledWith(emailAutomationStepMeta.endpoint, "step-1");
  });

  it("setNext invalidates the parent automation and the step", async () => {
    const body = { data: { type: emailAutomationStepMeta.endpoint, id: "step-2" } } as EmailAutomationStepDataDTO;

    await controller.setNext(request, reply, "step-1", body);

    expect(stepService.setNext).toHaveBeenCalledWith({ stepId: "step-1", nextStepId: "step-2" });
    expect(stepService.findAutomationId).toHaveBeenCalledWith({ stepId: "step-1" });
    expect(cacheService.invalidateByElement).toHaveBeenCalledWith(emailAutomationMeta.endpoint, "auto-1");
    expect(cacheService.invalidateByElement).toHaveBeenCalledWith(emailAutomationStepMeta.endpoint, "step-1");
  });

  it("clearNext invalidates the parent automation and the step", async () => {
    await controller.clearNext(request, reply, "step-1");

    expect(stepService.setNext).toHaveBeenCalledWith({ stepId: "step-1", nextStepId: null });
    expect(stepService.findAutomationId).toHaveBeenCalledWith({ stepId: "step-1" });
    expect(cacheService.invalidateByElement).toHaveBeenCalledWith(emailAutomationMeta.endpoint, "auto-1");
    expect(cacheService.invalidateByElement).toHaveBeenCalledWith(emailAutomationStepMeta.endpoint, "step-1");
  });

  it("skips the automation invalidation when the step has no parent", async () => {
    stepService.deleteStep.mockResolvedValue(undefined);

    await controller.delete(request, reply, "step-1");

    expect(cacheService.invalidateByElement).not.toHaveBeenCalledWith(emailAutomationMeta.endpoint, expect.anything());
  });
});
