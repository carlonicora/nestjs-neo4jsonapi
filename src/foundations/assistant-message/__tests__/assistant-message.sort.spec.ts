import { describe, expect, it, vi } from "vitest";
import { AssistantMessageController } from "../controllers/assistant-message.controller";

/** Library controller C10: keeps `orderBy` (default `position`), adds `sort` (sort wins in AbstractService). */

describe("AssistantMessageController.findByAssistant sort", () => {
  it("forwards sort beside the legacy orderBy", async () => {
    const service = { findByRelated: vi.fn().mockResolvedValue({}) };
    const controller = new AssistantMessageController(service as any);
    await controller.findByAssistant({ send: vi.fn() } as any, "a-1", {}, undefined, undefined, "-createdAt");
    expect(service.findByRelated).toHaveBeenCalledWith(
      expect.objectContaining({ id: "a-1", sort: "-createdAt", orderBy: "position" }),
    );
  });
});
