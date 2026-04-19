import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClsService } from "nestjs-cls";
import { AssistantMessageRepository } from "../assistant-message.repository";

describe("AssistantMessageRepository.getNextPosition", () => {
  let repo: AssistantMessageRepository;
  let neo4j: any;

  beforeEach(() => {
    neo4j = {
      initQuery: vi.fn(() => ({ query: "", queryParams: {} })),
      readOne: vi.fn(),
      read: vi.fn(),
      writeOne: vi.fn(),
    };
    const cls = { get: vi.fn(() => "u-1") } as unknown as ClsService;
    const security = {} as any;
    repo = new AssistantMessageRepository(neo4j, security, cls);
  });

  it("returns 0 for an empty thread", async () => {
    neo4j.read.mockResolvedValue({
      records: [{ get: (k: string) => (k === "next" ? 0 : undefined) }],
    });
    const next = await repo.getNextPosition({ assistantId: "a-1" });
    expect(next).toBe(0);
  });

  it("returns the value returned by the query for a populated thread", async () => {
    neo4j.read.mockResolvedValue({
      records: [{ get: (k: string) => (k === "next" ? 7 : undefined) }],
    });
    const next = await repo.getNextPosition({ assistantId: "a-1" });
    expect(next).toBe(7);
  });

  it("unwraps Neo4j Integer-like values via toNumber()", async () => {
    const int = { toNumber: () => 42 };
    neo4j.read.mockResolvedValue({
      records: [{ get: (k: string) => (k === "next" ? int : undefined) }],
    });
    const next = await repo.getNextPosition({ assistantId: "a-1" });
    expect(next).toBe(42);
  });

  it("defaults to 0 when no records are returned", async () => {
    neo4j.read.mockResolvedValue({ records: [] });
    const next = await repo.getNextPosition({ assistantId: "a-1" });
    expect(next).toBe(0);
  });
});
