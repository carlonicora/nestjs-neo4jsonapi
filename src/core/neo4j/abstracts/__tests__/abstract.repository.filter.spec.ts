import { vi } from "vitest";
import { AbstractRepository } from "../abstract.repository";
import { FilterCriterion, SortCriterion } from "../../types/filter.criterion";

class TestRepo extends AbstractRepository<any, any> {
  public capturedQuery: { query: string; queryParams: Record<string, unknown> } | null = null;
  protected readonly descriptor: any;

  constructor(deps: any) {
    super(deps.neo4j, deps.securityService, deps.clsService);
    this.descriptor = deps.descriptor;
  }
}

describe("AbstractRepository.find with structured filters and multi-key sort", () => {
  const buildSut = () => {
    const capturedRef: any = { query: null };
    const neo4j = {
      initQuery: () => ({ query: "", queryParams: {} }),
      readMany: vi.fn(async (q: any) => {
        capturedRef.query = q;
        return [];
      }),
    };
    const securityService = { userHasAccess: () => "" };
    const descriptor = {
      model: { nodeName: "account", type: "accounts", labelName: "Account" },
      defaultOrderBy: "updatedAt DESC",
      fulltextIndexName: undefined,
      isCompanyScoped: true,
    };
    const repo = new TestRepo({ neo4j, securityService, descriptor });
    (repo as any).buildDefaultMatch = () => "MATCH (account:Account)";
    (repo as any).buildReturnStatement = () => "RETURN account";
    return { repo, capturedRef, neo4j };
  };

  it("appends filter WHERE fragments with bound params", async () => {
    const { repo, capturedRef } = buildSut();
    const filters: FilterCriterion[] = [
      { field: "status", op: "eq", value: "open" },
      { field: "name", op: "like", value: "acme" },
    ];
    await repo.find({ filters });
    expect(capturedRef.query.query).toContain(
      "WHERE account.status = $filter_0 AND toLower(account.name) CONTAINS toLower($filter_1)",
    );
    expect(capturedRef.query.queryParams).toMatchObject({ filter_0: "open", filter_1: "acme" });
  });

  it("emits WHERE (not AND) when filters follow a WITH from userHasAccess", async () => {
    const { repo, capturedRef } = buildSut();
    // Swap the no-op securityService stub with one that emits a realistic WITH
    (repo as any).securityService = { userHasAccess: () => "WITH account" };
    await repo.find({ filters: [{ field: "status", op: "eq", value: "open" }] });
    // The filter must be prefixed with WHERE (there is no upstream WHERE at this point)
    expect(capturedRef.query.query).toMatch(/WITH account\s+WHERE account\.status = \$filter_0/);
  });

  it("applies multi-key orderByFields overriding legacy orderBy", async () => {
    const { repo, capturedRef } = buildSut();
    const sort: SortCriterion[] = [
      { field: "status", direction: "asc" },
      { field: "createdAt", direction: "desc" },
    ];
    await repo.find({ orderByFields: sort });
    expect(capturedRef.query.query).toContain("ORDER BY account.status ASC, account.createdAt DESC");
  });

  it("falls back to legacy orderBy string when orderByFields is absent (backwards compat)", async () => {
    const { repo, capturedRef } = buildSut();
    await repo.find({ orderBy: "updatedAt DESC" });
    expect(capturedRef.query.query).toContain("ORDER BY account.updatedAt DESC");
  });
});

describe("AbstractRepository.findByRelated with filters and sort", () => {
  it("accepts filters and orderByFields and forwards them into the query", async () => {
    const capturedRef: any = { query: null };
    const neo4j = {
      initQuery: () => ({ query: "", queryParams: {} }),
      readMany: vi.fn(async (q: any) => {
        capturedRef.query = q;
        return [];
      }),
    };
    const securityService = { userHasAccess: () => "" };
    const descriptor = {
      model: { nodeName: "order", type: "orders", labelName: "Order" },
      relationships: {
        account: {
          model: { nodeName: "account", labelName: "Account", type: "accounts" },
          direction: "in",
          relationship: "PLACED",
          cardinality: "one",
        },
      },
      defaultOrderBy: "updatedAt DESC",
      isCompanyScoped: true,
    };
    class TraversalTestRepo extends AbstractRepository<any, any> {
      protected readonly descriptor: any;
      constructor(deps: any) {
        super(deps.neo4j, deps.securityService, {} as any);
        this.descriptor = deps.descriptor;
      }
    }
    const repo: any = new TraversalTestRepo({ neo4j, securityService, descriptor });
    repo.buildDefaultMatch = () => "MATCH (order:Order)";
    repo.buildReturnStatement = () => "RETURN order";

    await repo.findByRelated({
      relationship: "account",
      id: "abc-123",
      query: {},
      filters: [{ field: "status", op: "eq", value: "open" }],
      orderByFields: [{ field: "createdAt", direction: "desc" }],
    });

    expect(capturedRef.query.query).toContain("WHERE order.status = $filter_0");
    expect(capturedRef.query.query).toContain("ORDER BY order.createdAt DESC");
    expect(capturedRef.query.queryParams).toMatchObject({ filter_0: "open" });
  });
});
