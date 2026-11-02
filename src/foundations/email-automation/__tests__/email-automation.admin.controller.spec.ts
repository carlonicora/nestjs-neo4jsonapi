import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MockedObject } from "vitest";
import type { FastifyReply } from "fastify";
import { SystemRoles } from "../../../common/constants/system.roles";
import type { AuthenticatedRequest } from "../../../common/interfaces/authenticated.request.interface";
import { CacheService } from "../../../core/cache/services/cache.service";
import { EmailAutomationAdminController } from "../controllers/email-automation.admin.controller";
import { EmailAutomationEnrollmentPostDTO } from "../dtos/email-automation-enrollment.post.dto";
import { emailAutomationMeta } from "../entities/email-automation.meta";
import { EmailAutomationService } from "../services/email-automation.service";

describe("EmailAutomationAdminController", () => {
  let controller: EmailAutomationAdminController;
  let service: MockedObject<EmailAutomationService>;
  let cacheService: MockedObject<CacheService>;
  let reply: FastifyReply;
  const request = { params: { emailAutomationId: "auto-1" } } as unknown as AuthenticatedRequest;

  beforeEach(() => {
    service = {
      findCandidates: vi.fn().mockResolvedValue({ data: [] }),
      addEnrollment: vi.fn().mockResolvedValue({ data: { id: "enr-1" } }),
    } as unknown as MockedObject<EmailAutomationService>;
    cacheService = {
      invalidateByElement: vi.fn().mockResolvedValue(undefined),
      invalidateByType: vi.fn().mockResolvedValue(undefined),
    } as unknown as MockedObject<CacheService>;
    reply = { send: vi.fn() } as unknown as FastifyReply;

    controller = new EmailAutomationAdminController(service, cacheService);
  });

  it("findCandidates calls the service with the automation id, the request query and the search", async () => {
    const query = { search: "ann", page: { size: "10" } };
    await controller.findCandidates(reply, "auto-1", query, "ann");

    expect(service.findCandidates).toHaveBeenCalledWith({ id: "auto-1", search: "ann", query });
    expect(reply.send).toHaveBeenCalledWith({ data: [] });
  });

  it("addEnrollment calls the service with the DTO data and invalidates the automation", async () => {
    const body = {
      data: {
        type: "email-automation-enrollments",
        id: "6f1c1f3e-8a5b-4c3d-9e2f-1a2b3c4d5e6f",
        attributes: { recipientType: "user", recipientId: "u-1" },
      },
    } as EmailAutomationEnrollmentPostDTO;

    await controller.addEnrollment(request, reply, "auto-1", body);

    expect(service.addEnrollment).toHaveBeenCalledWith({ id: "auto-1", data: body.data });
    expect(reply.send).toHaveBeenCalledWith({ data: { id: "enr-1" } });
    expect(cacheService.invalidateByElement).toHaveBeenCalledWith(emailAutomationMeta.endpoint, "auto-1");
  });

  it.each(["findCandidates", "addEnrollment"] as const)("%s is administrator-only", (method) => {
    const roles = Reflect.getMetadata("roles", EmailAutomationAdminController.prototype[method]);

    expect(roles).toEqual([SystemRoles.Administrator]);
  });
});
