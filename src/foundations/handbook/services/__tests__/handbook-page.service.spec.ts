import { NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HandbookPageService } from "../handbook-page.service";

/**
 * The delete override is the whole subject here. The inherited
 * `AbstractService.delete` gates on `(companyId ?? "") !== entity.company?.id`,
 * which for a company-less entity read by a company-less administrator is
 * `"" !== undefined` — every delete would 403 — and it never drops the page's
 * chunks.
 */
function makeService(params: { page?: unknown } = {}) {
  // `"page" in params`, not `??`: the missing-page case passes null deliberately
  // and `null ?? default` would hand back a page, silently proving nothing.
  const found = "page" in params ? params.page : { id: "page-1", path: "a.md" };

  const handbookPageRepository = {
    findById: vi.fn(async () => found),
    deletePage: vi.fn(async () => {}),
  };
  const chunkService = { deleteChunks: vi.fn(async () => {}) };

  const service = new HandbookPageService(
    {} as any,
    handbookPageRepository as any,
    { get: vi.fn(), set: vi.fn() } as any,
    chunkService as any,
    {} as any,
    { add: vi.fn() } as any,
    { get: vi.fn(() => ({ process: {}, notifications: {} })) } as any,
  );

  return { service, handbookPageRepository, chunkService };
}

describe("HandbookPageService.delete", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes the page for an administrator with no company", async () => {
    const { service, handbookPageRepository } = makeService();

    await service.delete({ id: "page-1" });

    expect(handbookPageRepository.deletePage).toHaveBeenCalledWith({ id: "page-1" });
  });

  it("drops the page's chunks BEFORE the page itself", async () => {
    const order: string[] = [];
    const { service, handbookPageRepository, chunkService } = makeService();
    chunkService.deleteChunks.mockImplementation(async () => {
      order.push("chunks");
    });
    handbookPageRepository.deletePage.mockImplementation(async () => {
      order.push("page");
    });

    await service.delete({ id: "page-1" });

    expect(chunkService.deleteChunks).toHaveBeenCalledWith({ id: "page-1", nodeType: "HandbookPage" });
    expect(order).toEqual(["chunks", "page"]);
  });

  it("throws NotFound and touches nothing when the page does not exist", async () => {
    const { service, handbookPageRepository, chunkService } = makeService({ page: null });

    await expect(service.delete({ id: "missing" })).rejects.toBeInstanceOf(NotFoundException);
    expect(chunkService.deleteChunks).not.toHaveBeenCalled();
    expect(handbookPageRepository.deletePage).not.toHaveBeenCalled();
  });
});
