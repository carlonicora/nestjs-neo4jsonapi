import { describe, expect, it, vi } from "vitest";
import { HandbookThreadController } from "../controllers/handbook-thread.controller";
import { HandbookController } from "../controllers/handbook.controller";

/** Library controllers C10: keep `orderBy`, add `sort` (sort wins in AbstractService). */

const reply = { send: vi.fn() } as any;

describe("Handbook controllers sort", () => {
  it("HandbookController.findAll and findAllSections forward sort and the legacy orderBy", async () => {
    const pages = { find: vi.fn().mockResolvedValue({}) };
    const sections = { find: vi.fn().mockResolvedValue({}) };
    const controller = new HandbookController(pages as any, sections as any, {} as any, {} as any, {} as any);
    await controller.findAll(reply, {}, undefined, undefined, "path", "-updatedAt");
    await controller.findAllSections(reply, {}, undefined, undefined, "name", "createdAt");
    expect(pages.find).toHaveBeenCalledWith(expect.objectContaining({ sort: "-updatedAt", orderBy: "path" }));
    expect(sections.find).toHaveBeenCalledWith(expect.objectContaining({ sort: "createdAt", orderBy: "name" }));
  });

  it("HandbookThreadController.findAll forwards sort", async () => {
    const service = { find: vi.fn().mockResolvedValue({}) };
    const controller = new HandbookThreadController(service as any, {} as any);
    await controller.findAll(reply, {}, undefined, undefined, undefined, "-updatedAt");
    expect(service.find).toHaveBeenCalledWith(expect.objectContaining({ sort: "-updatedAt" }));
  });
});
