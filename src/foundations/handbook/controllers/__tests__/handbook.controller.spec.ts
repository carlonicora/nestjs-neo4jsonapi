import { HttpStatus } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { AdminJwtAuthGuard } from "../../../../common/guards/jwt.auth.admin.guard";
import { handbookPageMeta } from "../../entities/handbook-page.meta";
import { handbookSectionMeta } from "../../entities/handbook-section.meta";
import { HandbookController } from "../handbook.controller";

function makeReply() {
  return { send: vi.fn(), code: vi.fn().mockReturnThis() };
}

// `@CacheInvalidate` calls through to `this.cacheService` whenever it is truthy,
// so the stub has to answer the two invalidation methods rather than be `{}`.
function makeCacheService() {
  return { invalidateByType: vi.fn(), invalidateByElement: vi.fn() };
}

// Sections are read-only: `find` is the only inherited method the controller reaches.
function makeSectionService() {
  return { find: vi.fn(async () => ({ data: [] })) };
}

describe("HandbookController", () => {
  it("is guarded by the administrator guard, not the plain jwt guard", () => {
    const guards = Reflect.getMetadata("__guards__", HandbookController) ?? [];
    expect(guards).toContain(AdminJwtAuthGuard);
  });

  it("replies 204 on sync and never invents a response body", async () => {
    const ingest = {
      sync: vi.fn(async () => ({ created: 1, updated: 0, unchanged: 0, deleted: 0, failed: [] })),
    };
    const controller = new HandbookController(
      {} as any,
      makeSectionService() as any,
      ingest as any,
      makeCacheService() as any,
      {} as any,
    );
    const reply = makeReply();

    await controller.sync(reply as any);

    expect(ingest.sync).toHaveBeenCalledTimes(1);
    expect(reply.send).toHaveBeenCalledWith();
  });

  it("declares 204 as the sync status code", () => {
    const code = Reflect.getMetadata("__httpCode__", HandbookController.prototype.sync);
    expect(code).toBe(HttpStatus.NO_CONTENT);
  });

  it("declares the sync route before the :handbookPageId route", () => {
    const handlers = Object.getOwnPropertyNames(HandbookController.prototype).filter((name) => name !== "constructor");

    expect(Reflect.getMetadata("path", HandbookController.prototype.sync)).toBe(`${handbookPageMeta.endpoint}/sync`);
    expect(Reflect.getMetadata("path", HandbookController.prototype.findById)).toBe(
      `${handbookPageMeta.endpoint}/:handbookPageId`,
    );
    expect(handlers.indexOf("sync")).toBeLessThan(handlers.indexOf("findById"));
  });

  it("serves the section list through the CRUD handler", async () => {
    const handbookSectionService = makeSectionService();
    const controller = new HandbookController(
      {} as any,
      handbookSectionService as any,
      {} as any,
      makeCacheService() as any,
      {} as any,
    );
    const reply = makeReply();

    await controller.findAllSections(reply as any, {}, undefined, undefined, undefined);

    expect(handbookSectionService.find).toHaveBeenCalled();
  });

  it("routes the section list through the meta constant, not a hardcoded path", () => {
    expect(Reflect.getMetadata("path", HandbookController.prototype.findAllSections)).toBe(
      handbookSectionMeta.endpoint,
    );
  });

  // The stateless ask surface was replaced by persisted handbook threads. The
  // route, its DTO, its service and the HandbookAnswer resource are gone — this
  // asserts the controller does not quietly keep a handler around.
  it("no longer exposes the stateless ask route", () => {
    const handlers = Object.getOwnPropertyNames(HandbookController.prototype).filter((name) => name !== "constructor");

    expect(handlers).not.toContain("ask");
    expect((HandbookController.prototype as Record<string, unknown>).ask).toBeUndefined();
  });
});
