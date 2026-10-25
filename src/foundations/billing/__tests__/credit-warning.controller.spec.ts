import { HttpStatus, RequestMethod } from "@nestjs/common";
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { describe, expect, it, vi } from "vitest";
import type { Mocked } from "vitest";

vi.mock("../services/credit-warning.service", () => ({
  CreditWarningService: class CreditWarningService {},
}));
vi.mock("../../../core/cache/services/cache.service", () => ({
  CacheService: class CacheService {},
}));
vi.mock("../../../common/guards/jwt.auth.guard", () => ({
  JwtAuthGuard: class JwtAuthGuard {},
}));

import { FastifyReply } from "fastify";
import { AuthenticatedRequest } from "../../../common/interfaces/authenticated.request.interface";
import { CacheService } from "../../../core/cache/services/cache.service";
import { companyMeta } from "../../company/entities/company.meta";
import { CreditWarningController } from "../controllers/credit-warning.controller";
import { CREDIT_WARNING_DISMISS_SEGMENT } from "../interfaces/credit-warning.interface";
import { CreditWarningService } from "../services/credit-warning.service";

describe("CREDIT_WARNING_DISMISS_SEGMENT", () => {
  it("matches the frontend library's segment", () => {
    expect(CREDIT_WARNING_DISMISS_SEGMENT).toBe("credit-warning/dismiss");
  });
});

describe("CreditWarningController", () => {
  const setup = () => {
    const creditWarningService = {
      dismiss: vi.fn().mockResolvedValue(undefined),
    } as unknown as Mocked<CreditWarningService>;
    const cacheService = {
      invalidateByElement: vi.fn().mockResolvedValue(undefined),
      invalidateByType: vi.fn().mockResolvedValue(undefined),
    } as unknown as Mocked<CacheService>;
    const controller = new CreditWarningController(creditWarningService, cacheService);
    const reply = { send: vi.fn() } as unknown as Mocked<FastifyReply>;
    return { controller, creditWarningService, cacheService, reply };
  };

  it("defines the class without throwing (the @CacheInvalidate + @Req() guard)", () => {
    expect(typeof CreditWarningController).toBe("function");
  });

  it("declares POST companies/:companyId/credit-warning/dismiss with 204", () => {
    const handler = CreditWarningController.prototype.dismiss;

    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(
      `${companyMeta.endpoint}/:companyId/credit-warning/dismiss`,
    );
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(HttpStatus.NO_CONTENT);
  });

  it("calls dismiss with the route param and replies with no body", async () => {
    const { controller, creditWarningService, cacheService, reply } = setup();
    const req = { params: { companyId: "c1" }, user: { companyId: "c1" } } as unknown as AuthenticatedRequest;

    await controller.dismiss(req, reply, "c1");

    expect(creditWarningService.dismiss).toHaveBeenCalledWith({ companyId: "c1" });
    expect(reply.send).toHaveBeenCalledWith();
    expect(cacheService.invalidateByElement).toHaveBeenCalledWith(companyMeta.endpoint, "c1");
  });
});
