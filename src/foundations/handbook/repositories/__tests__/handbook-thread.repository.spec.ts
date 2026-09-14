import { HttpException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HandbookThreadRepository } from "../handbook-thread.repository";

const OWNER_CLAUSE = "(handbookThread)-[:CREATED_BY]->(:User {id: $currentUserId})";

/**
 * The repository needs only Neo4jService, SecurityService and ClsService, so
 * the real class is exercised here rather than a stand-in subclass: the point
 * of these tests is that THIS class emits the owner predicate.
 *
 * `readOne` is scripted per call so the two-step behaviour of
 * `_validateForbidden` can be reproduced — the owner-scoped read returns
 * nothing, the unscoped existence read finds the node, and the repository must
 * conclude "someone else's" rather than "not there".
 */
function buildSut(params: { readOneResults?: unknown[] } = {}) {
  const queries: { query: string; queryParams: Record<string, unknown> }[] = [];
  const writes: { query: string; queryParams: Record<string, unknown> }[] = [];
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
    read: vi.fn(async () => ({ records: [] })),
    writeOne: vi.fn(async (q: any) => {
      writes.push(q);
    }),
  };
  const securityService = { userHasAccess: (p: { validator: () => string }) => p.validator() };
  const clsService = { get: (key: string) => (key === "userId" ? "user-1" : undefined), has: () => true };

  const repository = new HandbookThreadRepository(neo4j as any, securityService as any, clsService as any);

  return { repository, queries, writes, neo4j };
}

describe("HandbookThreadRepository", () => {
  let sut: ReturnType<typeof buildSut>;

  beforeEach(() => {
    sut = buildSut();
  });

  // HandbookThread is isCompanyScoped: false, so buildDefaultMatch() emits no
  // company filter whatsoever. This clause is the only thing separating one
  // administrator's threads from another's.
  it("makes the CREATED_BY owner edge the access check", () => {
    const clause = (sut.repository as any).buildUserHasAccess();

    expect(clause).toContain(OWNER_CLAUSE);
    expect(clause).toMatch(/WITH handbookThread\s*\n\s*WHERE EXISTS \{/);
  });

  it("applies the owner clause when listing threads", async () => {
    await sut.repository.find({});

    expect(sut.queries[0].query).toContain(OWNER_CLAUSE);
  });

  it("applies the owner clause when reading one thread", async () => {
    await sut.repository.findById({ id: "thread-1" });

    expect(sut.queries[0].query).toContain(OWNER_CLAUSE);
  });

  it("never emits a company filter — there is no company to filter on", async () => {
    await sut.repository.find({});

    expect(sut.queries[0].query).not.toContain("BELONGS_TO");
  });

  // The scenario that matters: administrator B asks for administrator A's
  // thread. The owner-scoped read finds nothing; the node nonetheless exists;
  // the repository must refuse rather than hand it over.
  it("hides a thread created by another user", async () => {
    const other = buildSut({ readOneResults: [null, { id: "thread-1", title: "A's thread" }] });

    const error = await other.repository.findById({ id: "thread-1" }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(403);
  });

  it("reports a thread that exists nowhere as absent rather than forbidden", async () => {
    const missing = buildSut({ readOneResults: [null, null] });

    await expect(missing.repository.findById({ id: "nope" })).resolves.toBeNull();
  });

  // Messages are reachable ONLY through their thread. Deleting the thread alone
  // would orphan them permanently.
  it("deletes the thread's messages with it", async () => {
    await sut.repository.delete({ id: "thread-1" });

    const [write] = sut.writes;
    expect(write.queryParams).toEqual({ id: "thread-1" });
    expect(write.query).toContain("MATCH (handbookThread:HandbookThread {id: $id})");
    expect(write.query).toContain("OPTIONAL MATCH (handbookThread)-[:HAS_MESSAGE]->");
    expect(write.query).toContain("HandbookThreadMessage");
    expect(write.query).toMatch(/DETACH DELETE handbookThread, handbookThreadMessage/);
  });

  it("bumps updatedAt on touch so an active thread rises up the list", async () => {
    await sut.repository.touch({ id: "thread-1" });

    const [write] = sut.writes;
    expect(write.queryParams).toEqual({ id: "thread-1" });
    expect(write.query).toContain("SET handbookThread.updatedAt = datetime()");
  });
});
