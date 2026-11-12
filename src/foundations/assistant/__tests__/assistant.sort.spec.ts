import { describe, expect, it, vi } from "vitest";
import { AssistantController } from "../controllers/assistant.controller";

/** Library controller C10: keeps `orderBy`, adds `sort` (sort wins in AbstractService). */

describe("AssistantController.findAll sort", () => {
  it("forwards sort and the legacy orderBy", async () => {
    const service = { find: vi.fn().mockResolvedValue({}) };
    const controller = new AssistantController(service as any, {} as any);
    await controller.findAll({ send: vi.fn() } as any, {}, undefined, undefined, "name", "-updatedAt");
    expect(service.find).toHaveBeenCalledWith(expect.objectContaining({ sort: "-updatedAt", orderBy: "name" }));
  });
});
