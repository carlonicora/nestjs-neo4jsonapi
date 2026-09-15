import { PreconditionFailedException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The controller carries a class-level `@UseGuards(JwtAuthGuard)`, and the
// testing module instantiates the guard — which pulls in ClsService, Neo4j and
// the auth-context hook. Stubbed exactly as `notification.controller.spec.ts`
// does, so the spec exercises the handlers and their decorators only.
vi.mock("../../../common/guards/jwt.auth.guard", () => ({
  JwtAuthGuard: class MockJwtAuthGuard {
    canActivate = () => true;
  },
}));

import { CacheService } from "../../../core/cache/services/cache.service";
import { AuditService } from "../../audit/services/audit.service";
import { howToMeta } from "../entities/how-to.meta";
import { HowToService } from "../services/how-to.service";
import { HowToController } from "./how-to.controller";

describe("HowToController decorators", () => {
  let controller: HowToController;
  const auditService = { logRead: vi.fn() };
  const cacheService = { invalidateByType: vi.fn(), invalidateByElement: vi.fn() };
  const howToService = {
    find: vi.fn(),
    findById: vi.fn().mockResolvedValue({ data: {} }),
    createFromDTO: vi.fn(),
    putFromDTO: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn(),
    queueHowToForProcessing: vi.fn(),
    addRelated: vi.fn(),
    removeRelated: vi.fn(),
    reindexAll: vi.fn(),
  };
  const reply = { send: vi.fn(), status: vi.fn().mockReturnThis(), code: vi.fn().mockReturnThis() } as any;
  const req = (params: Record<string, string>) => ({ params }) as any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [HowToController],
      providers: [
        { provide: HowToService, useValue: howToService },
        { provide: CacheService, useValue: cacheService },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();
    controller = module.get(HowToController);
  });

  it("audits GET :howToId", async () => {
    await controller.findById(req({ howToId: "h1" }), reply, "h1");
    expect(auditService.logRead).toHaveBeenCalledWith({ entityType: howToMeta.labelName, entityId: "h1" });
  });

  it("rejects a PUT whose URL id differs from the body id", async () => {
    await expect(
      controller.update(req({ howToId: "h1" }), reply, {
        data: { id: "other", type: howToMeta.endpoint, attributes: { name: "n", description: "[]" } },
      } as any),
    ).rejects.toBeInstanceOf(PreconditionFailedException);
  });

  it("invalidates the element cache on PUT and DELETE", async () => {
    await controller.update(req({ howToId: "h1" }), reply, {
      data: { id: "h1", type: howToMeta.endpoint, attributes: { name: "n", description: "[]" } },
    } as any);
    await controller.delete(req({ howToId: "h1" }), reply, "h1");
    expect(cacheService.invalidateByElement).toHaveBeenCalledWith(howToMeta.endpoint, "h1");
    expect(cacheService.invalidateByElement).toHaveBeenCalledTimes(2);
  });
});
