import { describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";
import { ChunkProcessor } from "../chunk.processor";

describe("ChunkProcessor", () => {
  const build = (creditValidator?: { validateCredits: any; isAiEnabled?: any }) => {
    const chunkService = { generateGraph: vi.fn(async () => undefined) };
    const cls = { run: vi.fn(async (fn: () => Promise<void>) => fn()), set: vi.fn() };
    const config = { get: vi.fn(() => undefined) };
    const processor = new ChunkProcessor(
      { debug: vi.fn(), error: vi.fn() } as any,
      {} as any,
      cls as any,
      chunkService as any,
      { updateStatus: vi.fn() } as any,
      {} as any,
      config as any,
      creditValidator as any,
    );
    return { processor, chunkService };
  };

  const job = (data: Record<string, unknown>) =>
    ({
      name: "process_chunk",
      data: {
        chunkId: "ch-1",
        contentId: "item-1",
        contentType: "ScopedItem",
        companyId: "c-1",
        userId: "u-1",
        ...data,
      },
    }) as unknown as Job;

  it("finalises the content by default", async () => {
    const { processor, chunkService } = build();

    await processor.process(job({}));

    expect(chunkService.generateGraph).toHaveBeenCalledWith({
      companyId: "c-1",
      userId: "u-1",
      chunkId: "ch-1",
      id: "item-1",
      type: "ScopedItem",
      finalise: true,
    });
  });

  it("forwards finalise: false from the job payload", async () => {
    const { processor, chunkService } = build();

    await processor.process(job({ finalise: false }));

    expect(chunkService.generateGraph).toHaveBeenCalledWith(expect.objectContaining({ finalise: false }));
  });

  it("indexes platform content (no company) without running the company gates", async () => {
    // A platform administrator's reindex queues how-to chunks with no companyId.
    // The app's validator looks the company up by id, which throws without one.
    const creditValidator = {
      validateCredits: vi.fn(async () => {
        throw new Error("Neo4j Read Error: Expected parameter(s): companyId");
      }),
      isAiEnabled: vi.fn(async () => false),
    };
    const { processor, chunkService } = build(creditValidator);

    await processor.process(job({ companyId: undefined }));

    expect(creditValidator.isAiEnabled).not.toHaveBeenCalled();
    expect(creditValidator.validateCredits).not.toHaveBeenCalled();
    expect(chunkService.generateGraph).toHaveBeenCalledWith(expect.objectContaining({ companyId: undefined }));
  });

  it("still gates company content on the company's plan", async () => {
    const creditValidator = { validateCredits: vi.fn(async () => undefined), isAiEnabled: vi.fn(async () => false) };
    const { processor, chunkService } = build(creditValidator);

    await processor.process(job({}));

    expect(creditValidator.isAiEnabled).toHaveBeenCalledWith({ companyId: "c-1" });
    expect(chunkService.generateGraph).not.toHaveBeenCalled();
  });
});
