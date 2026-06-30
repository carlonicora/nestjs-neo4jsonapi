import { describe, it, expect, vi } from "vitest";
import { ChunkerService } from "../chunker.service";

const makeConfig = (strategy: string, targetChars = 1500) =>
  ({
    get: vi.fn(() => (strategy ? { strategy, ocrLanguage: "eng", targetChars } : undefined)),
  }) as any;

const md = { splitMarkdownToChunks: vi.fn() } as any;
const sem = { splitMarkdownToChunks: vi.fn() } as any;
const stub = {} as any;

describe("ChunkerService splitter selection", () => {
  it("uses MarkdownChunkingService when strategy is markdown-structural", () => {
    const s = new ChunkerService(md, sem, stub, stub, stub, stub, stub, stub, stub, makeConfig("markdown-structural"));
    expect((s as any).splitter).toBe(md);
    expect((s as any).targetChars).toBe(1500);
  });
  it("uses SemanticSplitterService when strategy is semantic", () => {
    const s = new ChunkerService(md, sem, stub, stub, stub, stub, stub, stub, stub, makeConfig("semantic"));
    expect((s as any).splitter).toBe(sem);
  });
});
