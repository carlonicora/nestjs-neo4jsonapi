import { HttpException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HandbookThreadMessageRepository } from "../handbook-thread-message.repository";

const INHERITED_OWNER_CLAUSE =
  "(handbookThreadMessage)<-[:HAS_MESSAGE]-(:HandbookThread)-[:CREATED_BY]->(:User {id: $currentUserId})";

function buildSut(params: { readOneResults?: unknown[]; readRecords?: any[] } = {}) {
  const queries: { query: string; queryParams: Record<string, unknown> }[] = [];
  const rawReads: { query: string; params: Record<string, unknown> }[] = [];
  const readOneResults = [...(params.readOneResults ?? [null])];

  const neo4j = {
    initQuery: () => ({ query: "", queryParams: { companyId: null, currentUserId: "user-1" } }),
    readMany: vi.fn(async (q: any) => {
      queries.push(q);
      return [];
    }),
    readOne: vi.fn(async (q: any) => {
      queries.push(q);
      return readOneResults.length ? readOneResults.shift() : null;
    }),
    read: vi.fn(async (query: string, queryParams: Record<string, unknown>) => {
      rawReads.push({ query, params: queryParams });
      return { records: params.readRecords ?? [] };
    }),
    writeOne: vi.fn(async () => undefined),
  };
  const securityService = { userHasAccess: (p: { validator: () => string }) => p.validator() };
  const clsService = { get: (key: string) => (key === "userId" ? "user-1" : undefined), has: () => true };

  const repository = new HandbookThreadMessageRepository(neo4j as any, securityService as any, clsService as any);

  return { repository, queries, rawReads };
}

describe("HandbookThreadMessageRepository", () => {
  let sut: ReturnType<typeof buildSut>;

  beforeEach(() => {
    sut = buildSut();
  });

  // A message carries no owner of its own; it inherits the thread's.
  it("inherits access from the parent thread's owner edge", () => {
    const clause = (sut.repository as any).buildUserHasAccess();

    expect(clause).toContain(INHERITED_OWNER_CLAUSE);
  });

  it("applies the inherited owner clause when listing messages", async () => {
    await sut.repository.find({});

    expect(sut.queries[0].query).toContain(INHERITED_OWNER_CLAUSE);
  });

  it("applies the inherited owner clause when reading one message", async () => {
    await sut.repository.findById({ id: "message-1" });

    expect(sut.queries[0].query).toContain(INHERITED_OWNER_CLAUSE);
  });

  it("hides a message belonging to another user's thread", async () => {
    const other = buildSut({ readOneResults: [null, { id: "message-1", content: "A's question" }] });

    const error = await other.repository.findById({ id: "message-1" }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(403);
  });

  it("starts an empty thread at position 0", async () => {
    const empty = buildSut({ readRecords: [] });

    await expect(empty.repository.getNextPosition({ threadId: "thread-1" })).resolves.toBe(0);
  });

  it("appends after the highest existing position", async () => {
    const populated = buildSut({ readRecords: [{ get: () => ({ toNumber: () => 4 }) }] });

    await expect(populated.repository.getNextPosition({ threadId: "thread-1" })).resolves.toBe(4);
    expect(populated.rawReads[0].params).toEqual({ threadId: "thread-1" });
    expect(populated.rawReads[0].query).toContain("coalesce(max(handbookThreadMessage.position), -1) + 1");
  });

  it("reads a plain numeric position as well as a Neo4j integer", async () => {
    const plain = buildSut({ readRecords: [{ get: () => 7 }] });

    await expect(plain.repository.getNextPosition({ threadId: "thread-1" })).resolves.toBe(7);
  });
});
