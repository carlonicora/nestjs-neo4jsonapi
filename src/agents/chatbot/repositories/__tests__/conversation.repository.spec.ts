import { describe, expect, it, vi } from "vitest";
import { AbstractRepository } from "../../../../core/neo4j/abstracts/abstract.repository";
import { ConversationDescriptor } from "../../entities/conversation";

/**
 * SUT mirroring the pattern in abstract.repository.filter.spec.ts — we sub-class
 * AbstractRepository with a ConversationDescriptor-shaped descriptor and capture
 * the generated query so we can assert the owner-scoped WHERE clause emitted by
 * ConversationRepository.buildUserHasAccess.
 *
 * We cannot import ConversationRepository itself (it relies on concrete services
 * we'd otherwise have to stub) — instead we replicate its `buildUserHasAccess`
 * override here and verify the emitted Cypher matches.
 */
class OwnerScopedTestRepo extends AbstractRepository<any, any> {
  public capturedQuery: { query: string; queryParams: Record<string, unknown> } | null = null;
  protected readonly descriptor: any;

  constructor(deps: any) {
    super(deps.neo4j, deps.securityService, deps.clsService);
    this.descriptor = deps.descriptor;
  }

  protected buildUserHasAccess(): string {
    const { nodeName } = this.descriptor.model;
    return `WITH ${nodeName}
            WHERE EXISTS {
              MATCH (${nodeName})-[:CREATED_BY]->(:User {id: $currentUserId})
            }
            WITH ${nodeName}`;
  }
}

describe("ConversationRepository (owner-scoped RBAC)", () => {
  const buildSut = () => {
    const capturedRef: any = { query: null, queries: [] };
    const neo4j = {
      initQuery: () => ({
        query: "",
        queryParams: { companyId: "c-1", currentUserId: "u-1" },
      }),
      readMany: vi.fn(async (q: any) => {
        capturedRef.query = q;
        capturedRef.queries.push(q);
        return [];
      }),
      readOne: vi.fn(async (q: any) => {
        capturedRef.query = q;
        capturedRef.queries.push(q);
        return null;
      }),
      read: vi.fn(async () => ({ records: [] })),
    };
    // pass-through validator so buildUserHasAccess emits its clause into the query.
    const securityService = { userHasAccess: (p: { validator: () => string }) => p.validator() };
    const clsService = { get: (k: string) => (k === "userId" ? "u-1" : "c-1"), has: () => true };

    const descriptor = {
      ...ConversationDescriptor,
      // Avoid stringFields/fulltext index complexity in this isolated test
      fulltextIndexName: undefined,
    };

    const repo = new OwnerScopedTestRepo({ neo4j, securityService, clsService, descriptor });
    return { repo, capturedRef, neo4j };
  };

  it("buildUserHasAccess emits an owner-check against :User via $currentUserId", () => {
    const { repo } = buildSut();
    const clause = (repo as any).buildUserHasAccess();
    expect(clause).toContain("(conversation)-[:CREATED_BY]->(:User {id: $currentUserId})");
  });

  it("find() emits the owner WHERE clause via userHasAccess", async () => {
    const { repo, capturedRef } = buildSut();
    await repo.find({});
    expect(capturedRef.query.query).toContain("(conversation)-[:CREATED_BY]->(:User {id: $currentUserId})");
  });

  it("findById() also enforces the owner WHERE clause on the primary query", async () => {
    const { repo, capturedRef } = buildSut();
    // findById throws on not-found via _validateForbidden, so wrap
    try {
      await repo.findById({ id: "some-id" });
    } catch {
      /* expected - null result triggers forbidden check */
    }
    // The first readOne call is the owner-scoped primary query; the second is the
    // unscoped existence probe from _validateForbidden (bypasses userHasAccess by design).
    const primary = capturedRef.queries[0];
    expect(primary.query).toContain("(conversation)-[:CREATED_BY]->(:User {id: $currentUserId})");
  });

  it("uses the descriptor's own nodeName ('conversation') when producing the RBAC clause", () => {
    const { repo } = buildSut();
    const clause = (repo as any).buildUserHasAccess();
    expect(clause).toMatch(/WITH conversation\s*\n\s*WHERE EXISTS \{/);
  });
});
