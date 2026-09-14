import { HttpStatus, RequestMethod } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { AdminJwtAuthGuard } from "../../../../common/guards/jwt.auth.admin.guard";
import { JwtAuthGuard } from "../../../../common/guards/jwt.auth.guard";
import { handbookThreadMeta } from "../../entities/handbook-thread.meta";
import { handbookThreadMessageMeta } from "../../entities/handbook-thread-message.meta";
import { HandbookThreadController } from "../handbook-thread.controller";

const HANDLERS = ["findAll", "create", "findById", "patch", "delete", "appendMessage"] as const;

function makeReply() {
  return { send: vi.fn(), code: vi.fn().mockReturnThis() };
}

// `@CacheInvalidate` calls through to `this.cacheService` whenever it is truthy,
// so the stub has to answer the two invalidation methods rather than be `{}`.
function makeCacheService() {
  return { invalidateByType: vi.fn(), invalidateByElement: vi.fn() };
}

function makeController(service: Record<string, unknown> = {}) {
  return new HandbookThreadController(service as any, makeCacheService() as any);
}

describe("HandbookThreadController — administrator gate", () => {
  // Developer documentation is administrator-only on the API, not merely in
  // whatever admin layout a consumer's frontend happens to have.
  it("is guarded by the administrator guard, not the plain jwt guard", () => {
    const guards = Reflect.getMetadata("__guards__", HandbookThreadController) ?? [];

    expect(guards).toContain(AdminJwtAuthGuard);
    expect(guards).not.toContain(JwtAuthGuard);
  });

  // A handler-level @UseGuards REPLACES the class-level list for that handler,
  // which is the usual way one route quietly loses the admin check. Every route
  // must therefore declare none of its own.
  it.each(HANDLERS)("leaves %s on the class-level administrator guard", (handler) => {
    expect(Reflect.getMetadata("__guards__", HandbookThreadController.prototype[handler])).toBeUndefined();
    expect(Reflect.getMetadata("__guards__", HandbookThreadController) ?? []).toContain(AdminJwtAuthGuard);
  });
});

describe("HandbookThreadController — pinned routes", () => {
  const expected: Array<[(typeof HANDLERS)[number], RequestMethod, string]> = [
    ["findAll", RequestMethod.GET, handbookThreadMeta.endpoint],
    ["create", RequestMethod.POST, handbookThreadMeta.endpoint],
    ["findById", RequestMethod.GET, `${handbookThreadMeta.endpoint}/:handbookThreadId`],
    ["patch", RequestMethod.PATCH, `${handbookThreadMeta.endpoint}/:handbookThreadId`],
    ["delete", RequestMethod.DELETE, `${handbookThreadMeta.endpoint}/:handbookThreadId`],
    [
      "appendMessage",
      RequestMethod.POST,
      `${handbookThreadMeta.endpoint}/:handbookThreadId/${handbookThreadMessageMeta.endpoint}`,
    ],
  ];

  it.each(expected)("mounts %s", (handler, method, path) => {
    expect(Reflect.getMetadata("path", HandbookThreadController.prototype[handler])).toBe(path);
    expect(Reflect.getMetadata("method", HandbookThreadController.prototype[handler])).toBe(method);
  });

  it("uses the meta constants rather than hardcoded endpoint strings", () => {
    expect(handbookThreadMeta.endpoint).toBe("handbookthreads");
    expect(handbookThreadMessageMeta.endpoint).toBe("handbookthreadmessages");
  });

  it("declares 204 on delete", () => {
    expect(Reflect.getMetadata("__httpCode__", HandbookThreadController.prototype.delete)).toBe(HttpStatus.NO_CONTENT);
  });
});

describe("HandbookThreadController — delegation", () => {
  it("creates a thread from the question and replies with what the service built", async () => {
    const built = { data: { type: handbookThreadMeta.type, id: "thread-1" } };
    const service = { createWithFirstMessage: vi.fn(async () => built) };
    const controller = makeController(service);
    const reply = makeReply();

    await controller.create(
      reply as any,
      {
        data: { type: handbookThreadMeta.endpoint, attributes: { question: "How does X work?" } },
      } as any,
    );

    expect(service.createWithFirstMessage).toHaveBeenCalledWith({ question: "How does X work?" });
    expect(reply.send).toHaveBeenCalledWith(built);
  });

  it("reads one thread with its messages", async () => {
    const built = { data: { type: handbookThreadMeta.type, id: "thread-1" }, included: [] };
    const service = { findThreadWithMessages: vi.fn(async () => built) };
    const controller = makeController(service);
    const reply = makeReply();

    await controller.findById(reply as any, "thread-1");

    expect(service.findThreadWithMessages).toHaveBeenCalledWith({ threadId: "thread-1" });
    expect(reply.send).toHaveBeenCalledWith(built);
  });

  it("appends a question to the thread named by the URL", async () => {
    const built = { data: [] };
    const service = { appendMessage: vi.fn(async () => built) };
    const controller = makeController(service);
    const reply = makeReply();

    await controller.appendMessage(reply as any, "thread-1", {
      data: { type: handbookThreadMessageMeta.endpoint, attributes: { question: "And then?" } },
    } as any);

    expect(service.appendMessage).toHaveBeenCalledWith({ threadId: "thread-1", question: "And then?" });
    expect(reply.send).toHaveBeenCalledWith(built);
  });

  it("lists through the CRUD handler so pagination and search behave as everywhere else", async () => {
    const service = { find: vi.fn(async () => ({ data: [] })) };
    const controller = makeController(service);
    const reply = makeReply();

    await controller.findAll(reply as any, { page: 1 }, "term", true, "title ASC");

    expect(service.find).toHaveBeenCalledWith({
      query: { page: 1 },
      term: "term",
      fetchAll: true,
      orderBy: "title ASC",
    });
  });

  it("renames through the CRUD handler", async () => {
    const service = { patchFromDTO: vi.fn(async () => ({ data: {} })) };
    const controller = makeController(service);
    const reply = makeReply();
    const body = {
      data: { type: handbookThreadMeta.endpoint, id: "thread-1", attributes: { title: "Renamed" } },
    };

    await controller.patch(reply as any, body as any);

    expect(service.patchFromDTO).toHaveBeenCalledWith({ data: body.data });
  });

  it("deletes through the CRUD handler", async () => {
    const service = { delete: vi.fn(async () => undefined) };
    const controller = makeController(service);
    const reply = makeReply();

    await controller.delete(reply as any, "thread-1");

    expect(service.delete).toHaveBeenCalledWith({ id: "thread-1" });
    expect(reply.send).toHaveBeenCalledWith();
  });
});
