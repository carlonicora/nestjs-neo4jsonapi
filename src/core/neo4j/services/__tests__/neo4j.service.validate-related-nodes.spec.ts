import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { entityTenancyRegistry } from "../../../../common/registries/entity-tenancy.registry";
import { Neo4jService } from "../neo4j.service";

/**
 * validateRelatedNodes: one read query, grouped by label + rule, each group an
 * `UNWIND ... MATCH ... WHERE <rule> RETURN count(DISTINCT t)` subquery. The summed count must
 * equal the number of distinct ids; anything else is the same 400 as a missing node.
 *
 * The service is built without its constructor (no driver): only `cls` and `read` are used.
 */
const COMPANY = "company-a";

const makeService = (params: { clsCompanyId?: string; found?: number }) => {
  const service = Object.create(Neo4jService.prototype) as Neo4jService;
  (service as any).cls = {
    has: (key: string) => key === "companyId" && !!params.clsCompanyId,
    get: (key: string) => (key === "companyId" ? params.clsCompanyId : undefined),
  };
  const read = vi.fn().mockResolvedValue({ records: [{ get: () => params.found ?? 0 }] });
  (service as any).read = read;
  return { service, read };
};

const lastQuery = (read: ReturnType<typeof vi.fn>): { query: string; params: Record<string, any> } => {
  const [query, params] = read.mock.calls[read.mock.calls.length - 1];
  return { query, params };
};

describe("Neo4jService.validateRelatedNodes", () => {
  afterEach(() => {
    entityTenancyRegistry.unregister("VrnScoped");
    entityTenancyRegistry.unregister("VrnSelf");
    entityTenancyRegistry.unregister("VrnVia");
    entityTenancyRegistry.unregister("VrnViaCompany");
    entityTenancyRegistry.unregister("VrnGlobal");
    entityTenancyRegistry.unregister("VrnShared");
  });

  beforeEach(() => {
    entityTenancyRegistry.register({ labelName: "VrnScoped", isCompanyScoped: true });
    entityTenancyRegistry.register({ labelName: "VrnSelf", isCompanyScoped: false, tenancy: "self" });
    entityTenancyRegistry.register({
      labelName: "VrnVia",
      isCompanyScoped: false,
      tenancy: { via: "parent" },
      via: { relationship: "PART_OF", direction: "out", label: "VrnScoped" },
    });
    entityTenancyRegistry.register({
      labelName: "VrnViaCompany",
      isCompanyScoped: false,
      tenancy: { via: "company" },
      linkScope: "own-or-platform",
      via: { relationship: "BELONGS_TO", direction: "out", label: "Company" },
    });
    entityTenancyRegistry.register({ labelName: "VrnGlobal", isCompanyScoped: false, tenancy: "global" });
    entityTenancyRegistry.register({ labelName: "VrnShared", isCompanyScoped: true, linkScope: "own-or-platform" });
  });

  it("does nothing for an empty list", async () => {
    const { service, read } = makeService({ clsCompanyId: COMPANY });
    await service.validateRelatedNodes({ nodes: [] });
    expect(read).not.toHaveBeenCalled();
  });

  it("company-scoped target: any BELONGS_TO edge must point at the caller's company (multi-company users pass)", async () => {
    const { service, read } = makeService({ clsCompanyId: COMPANY, found: 1 });
    await service.validateRelatedNodes({ nodes: [{ id: "u1", label: "VrnScoped" }] });

    const { query, params } = lastQuery(read);
    // EXISTS over the edge pattern: true when ANY of the node's BELONGS_TO edges reaches the company
    expect(query).toContain("WHERE EXISTS { MATCH (t)-[:BELONGS_TO]->(:Company {id: $companyId}) }");
    expect(params).toEqual({ companyId: COMPANY, ids0: ["u1"] });
  });

  it("refuses a foreign / missing id with the 'do not exist' 400", async () => {
    const { service } = makeService({ clsCompanyId: COMPANY, found: 0 });
    const call = service.validateRelatedNodes({ nodes: [{ id: "foreign", label: "VrnScoped" }] });
    await expect(call).rejects.toThrow(BadRequestException);
    await expect(
      makeService({ clsCompanyId: COMPANY, found: 0 }).service.validateRelatedNodes({
        nodes: [{ id: "foreign", label: "VrnScoped" }],
      }),
    ).rejects.toThrow("One or more related nodes do not exist.");
  });

  it("tenancy self: the target is the company itself", async () => {
    const { service, read } = makeService({ clsCompanyId: COMPANY, found: 1 });
    await service.validateRelatedNodes({ nodes: [{ id: COMPANY, label: "VrnSelf" }] });
    expect(lastQuery(read).query).toContain("WHERE t.id = $companyId");
  });

  it("tenancy via: the parent through the hop belongs to the company (one hop)", async () => {
    const { service, read } = makeService({ clsCompanyId: COMPANY, found: 1 });
    await service.validateRelatedNodes({ nodes: [{ id: "v1", label: "VrnVia" }] });
    expect(lastQuery(read).query).toContain(
      "WHERE EXISTS { MATCH (t)-[:PART_OF]->(:VrnScoped)-[:BELONGS_TO]->(:Company {id: $companyId}) }",
    );
  });

  it("tenancy via Company + own-or-platform: no company edge, or the caller's company", async () => {
    const { service, read } = makeService({ clsCompanyId: COMPANY, found: 1 });
    await service.validateRelatedNodes({ nodes: [{ id: "cal", label: "VrnViaCompany" }] });
    expect(lastQuery(read).query).toContain(
      "WHERE (NOT EXISTS { MATCH (t)-[:BELONGS_TO]->(:Company) } OR EXISTS { MATCH (t)-[:BELONGS_TO]->(:Company {id: $companyId}) })",
    );
  });

  it("company-scoped + own-or-platform: platform row or own row, never another company's", async () => {
    const { service, read } = makeService({ clsCompanyId: COMPANY, found: 1 });
    await service.validateRelatedNodes({ nodes: [{ id: "s1", label: "VrnShared" }] });
    expect(lastQuery(read).query).toContain(
      "WHERE (NOT EXISTS { MATCH (t)-[:BELONGS_TO]->(:Company) } OR EXISTS { MATCH (t)-[:BELONGS_TO]->(:Company {id: $companyId}) })",
    );
  });

  it("tenancy global and unknown labels: existence only", async () => {
    const { service, read } = makeService({ clsCompanyId: COMPANY, found: 2 });
    await service.validateRelatedNodes({
      nodes: [
        { id: "g1", label: "VrnGlobal" },
        { id: "p1", label: "StripePrice" },
      ],
    });
    const { query } = lastQuery(read);
    expect(query).not.toContain("WHERE");
    expect(query).toContain("MATCH (t:VrnGlobal {id: relatedId})");
    expect(query).toContain("MATCH (t:StripePrice {id: relatedId})");
  });

  it("an explicit rule wins over the registry (crossCompany / caller id use { kind: 'exists' })", async () => {
    const { service, read } = makeService({ clsCompanyId: COMPANY, found: 1 });
    await service.validateRelatedNodes({ nodes: [{ id: "u1", label: "VrnScoped", rule: { kind: "exists" } }] });
    expect(lastQuery(read).query).not.toContain("WHERE");
  });

  it("no company in CLS (system jobs): every rule is existence-only", async () => {
    const { service, read } = makeService({ found: 2 });
    await service.validateRelatedNodes({
      nodes: [
        { id: "u1", label: "VrnScoped" },
        { id: "x", label: "VrnSelf" },
      ],
    });
    const { query, params } = lastQuery(read);
    expect(query).not.toContain("WHERE");
    expect(params.companyId).toBeNull();
  });

  it("an explicit companyId overrides CLS", async () => {
    const { service, read } = makeService({ clsCompanyId: COMPANY, found: 1 });
    await service.validateRelatedNodes({ companyId: "other", nodes: [{ id: "u1", label: "VrnScoped" }] });
    expect(lastQuery(read).params.companyId).toBe("other");
  });

  it("runs ONE read query: one UNWIND + count subquery per label/rule group, summed", async () => {
    const { service, read } = makeService({ clsCompanyId: COMPANY, found: 4 });
    await service.validateRelatedNodes({
      nodes: [
        { id: "a", label: "VrnScoped" },
        { id: "b", label: "VrnScoped" },
        { id: "a", label: "VrnScoped" }, // duplicate id: counted once
        { id: COMPANY, label: "VrnSelf" },
        { id: "g", label: "VrnGlobal" },
      ],
    });

    expect(read).toHaveBeenCalledTimes(1);
    const { query, params } = lastQuery(read);
    expect(query.match(/CALL \{/g)).toHaveLength(3);
    expect(query.match(/UNWIND \$ids\d AS relatedId/g)).toHaveLength(3);
    expect(query).toContain("RETURN count(DISTINCT t) AS found0");
    expect(query).toContain("RETURN found0 + found1 + found2 AS found");
    expect(params.ids0).toEqual(["a", "b"]);
  });

  it("fails when only part of a group is found", async () => {
    const { service } = makeService({ clsCompanyId: COMPANY, found: 1 });
    await expect(
      service.validateRelatedNodes({
        nodes: [
          { id: "a", label: "VrnScoped" },
          { id: "foreign", label: "VrnScoped" },
        ],
      }),
    ).rejects.toThrow("One or more related nodes do not exist.");
  });

  it("accepts a Neo4j Integer count", async () => {
    const service = Object.create(Neo4jService.prototype) as Neo4jService;
    (service as any).cls = { has: () => false, get: () => undefined };
    (service as any).read = vi.fn().mockResolvedValue({ records: [{ get: () => ({ toNumber: () => 1 }) }] });
    await expect(service.validateRelatedNodes({ nodes: [{ id: "a", label: "VrnGlobal" }] })).resolves.toBeUndefined();
  });

  it("refuses a label that is not a plain Cypher identifier", async () => {
    const { service, read } = makeService({ clsCompanyId: COMPANY, found: 1 });
    await expect(service.validateRelatedNodes({ nodes: [{ id: "a", label: "X) DETACH DELETE (n" }] })).rejects.toThrow(
      BadRequestException,
    );
    expect(read).not.toHaveBeenCalled();
  });
});
