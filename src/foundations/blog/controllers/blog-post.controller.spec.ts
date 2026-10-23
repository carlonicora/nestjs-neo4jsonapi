import { PreconditionFailedException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { FastifyReply } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mocked } from "vitest";

// The class-level `@UseGuards(JwtAuthGuard)` makes the testing module
// instantiate the guard; stubbed as in how-to.controller.spec.ts.
vi.mock("../../../common/guards/jwt.auth.guard", () => ({
  JwtAuthGuard: class MockJwtAuthGuard {
    canActivate = () => true;
  },
}));

import { CoreModuleId } from "../../../common/constants/core-module.ids";
import { RoleId } from "../../../common/constants/system.roles";
import { MODULE_ACL_METADATA } from "../../../common/decorators/module.decorator";
import type { AuthenticatedRequest } from "../../../common/interfaces/authenticated.request.interface";
import { CacheService } from "../../../core/cache/services/cache.service";
import { AuditService } from "../../audit/services/audit.service";
import { BlogPostPostDTO } from "../dtos/blog-post.post.dto";
import { BlogPostPutDTO } from "../dtos/blog-post.put.dto";
import { blogPostMeta } from "../entities/blog-post.meta";
import { BlogPostService } from "../services/blog-post.service";
import { BlogPostController } from "./blog-post.controller";

describe("BlogPostController", () => {
  let controller: BlogPostController;
  const auditService: Mocked<Pick<AuditService, "logRead">> = { logRead: vi.fn() };
  const cacheService: Mocked<Pick<CacheService, "invalidateByType" | "invalidateByElement">> = {
    invalidateByType: vi.fn(),
    invalidateByElement: vi.fn(),
  };
  const blogPostService: Mocked<
    Pick<BlogPostService, "find" | "findById" | "createFromDTO" | "putFromDTO" | "delete" | "publish" | "unpublish">
  > = {
    find: vi.fn(),
    findById: vi.fn().mockResolvedValue({ data: {} }),
    createFromDTO: vi.fn().mockResolvedValue({ data: {} }),
    putFromDTO: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn(),
    publish: vi.fn().mockResolvedValue({ data: {} }),
    unpublish: vi.fn().mockResolvedValue({ data: {} }),
  };
  const replyMock: Mocked<Pick<FastifyReply, "send" | "status" | "code">> = {
    send: vi.fn(),
    status: vi.fn().mockReturnThis(),
    code: vi.fn().mockReturnThis(),
  };
  const reply = replyMock as unknown as FastifyReply;
  // The @Audit / @CacheInvalidate wrappers read the route id from the request's params.
  const req = (params: Record<string, string>) => ({ params }) as unknown as AuthenticatedRequest;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [BlogPostController],
      providers: [
        { provide: BlogPostService, useValue: blogPostService },
        { provide: CacheService, useValue: cacheService },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();
    controller = module.get(BlogPostController);
  });

  describe("authorisation metadata", () => {
    const rolesOf = (method: keyof BlogPostController) =>
      Reflect.getMetadata("roles", BlogPostController.prototype[method]) as string[] | undefined;

    it.each(["create", "update", "delete", "publish", "unpublish"] as const)(
      "restricts %s to the platform Administrator",
      (method) => {
        expect(rolesOf(method)).toEqual([RoleId.Administrator]);
      },
    );

    it("declares the Blog permission section", () => {
      expect(Reflect.getMetadata(MODULE_ACL_METADATA, BlogPostController)).toEqual({ module: CoreModuleId.Blog });
    });
  });

  it("audits GET :blogPostId and reads through the crud handler", async () => {
    await controller.findById(req({ blogPostId: "p1" }), reply, "p1");

    expect(blogPostService.findById).toHaveBeenCalledWith({ id: "p1" });
    expect(auditService.logRead).toHaveBeenCalledWith({ entityType: blogPostMeta.labelName, entityId: "p1" });
  });

  it("rejects a PUT whose URL id differs from the body id", async () => {
    await expect(
      controller.update(req({ blogPostId: "p1" }), reply, {
        data: { id: "other", type: blogPostMeta.endpoint, attributes: {} },
      } as BlogPostPutDTO),
    ).rejects.toBeInstanceOf(PreconditionFailedException);
    expect(blogPostService.putFromDTO).not.toHaveBeenCalled();
  });

  it("creates through the crud handler and invalidates the type", async () => {
    const body = { data: { id: "p1", type: blogPostMeta.endpoint, attributes: {} } } as BlogPostPostDTO;

    await controller.create(reply, body);

    expect(blogPostService.createFromDTO).toHaveBeenCalledWith({ data: body.data, included: undefined });
    expect(cacheService.invalidateByType).toHaveBeenCalledWith(blogPostMeta.endpoint);
  });

  it("updates through the crud handler", async () => {
    const body = { data: { id: "p1", type: blogPostMeta.endpoint, attributes: {} } } as BlogPostPutDTO;

    await controller.update(req({ blogPostId: "p1" }), reply, body);

    expect(blogPostService.putFromDTO).toHaveBeenCalledWith({ data: body.data, included: undefined });
    expect(cacheService.invalidateByElement).toHaveBeenCalledWith(blogPostMeta.endpoint, "p1");
  });

  it("publishes and invalidates the post", async () => {
    await controller.publish(req({ blogPostId: "p1" }), reply, "p1");

    expect(blogPostService.publish).toHaveBeenCalledWith({ id: "p1" });
    expect(cacheService.invalidateByElement).toHaveBeenCalledWith(blogPostMeta.endpoint, "p1");
  });

  it("deletes through the service and invalidates the post", async () => {
    await controller.delete(req({ blogPostId: "p1" }), reply, "p1");

    expect(blogPostService.delete).toHaveBeenCalledWith({ id: "p1" });
    expect(cacheService.invalidateByElement).toHaveBeenCalledWith(blogPostMeta.endpoint, "p1");
  });
});
