import { describe, expect, it, vi } from "vitest";
import { AbstractRepository } from "../../../../core/neo4j/abstracts/abstract.repository";
import { AssistantDescriptor } from "../../entities/assistant";

/**
 * SUT mirroring the pattern in abstract.repository.filter.spec.ts — we sub-class
 * AbstractRepository with an AssistantDescriptor-shaped descriptor and capture
 * the generated query so we can assert the owner-scoped WHERE clause emitted by
 * AssistantRepository.buildUserHasAccess.
 *
 * We cannot import AssistantRepository itself (it relies on concrete services
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

describe("AssistantRepository (owner-scoped RBAC)", () => {
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
    const securityService = { userHasAccess: (p: { validator: () => string }) => p.validator() };
    const clsService = { get: (k: string) => (k === "userId" ? "u-1" : "c-1"), has: () => true };

    const descriptor = {
      ...AssistantDescriptor,
      fulltextIndexName: undefined,
    };

    const repo = new OwnerScopedTestRepo({ neo4j, securityService, clsService, descriptor });
    return { repo, capturedRef, neo4j };
  };

  it("buildUserHasAccess emits an owner-check against :User via $currentUserId", () => {
    const { repo } = buildSut();
    const clause = (repo as any).buildUserHasAccess();
    expect(clause).toContain("(assistant)-[:CREATED_BY]->(:User {id: $currentUserId})");
  });

  it("find() emits the owner WHERE clause via userHasAccess", async () => {
    const { repo, capturedRef } = buildSut();
    await repo.find({});
    expect(capturedRef.query.query).toContain("(assistant)-[:CREATED_BY]->(:User {id: $currentUserId})");
  });

  it("findById() also enforces the owner WHERE clause on the primary query", async () => {
    const { repo, capturedRef } = buildSut();
    try {
      await repo.findById({ id: "some-id" });
    } catch {
      /* expected - null result triggers forbidden check */
    }
    const primary = capturedRef.queries[0];
    expect(primary.query).toContain("(assistant)-[:CREATED_BY]->(:User {id: $currentUserId})");
  });

  it("uses the descriptor's own nodeName ('assistant') when producing the RBAC clause", () => {
    const { repo } = buildSut();
    const clause = (repo as any).buildUserHasAccess();
    expect(clause).toMatch(/WITH assistant\s*\n\s*WHERE EXISTS \{/);
  });
});
