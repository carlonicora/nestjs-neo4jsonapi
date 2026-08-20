import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentScope } from "../../../../common/types/agent.scope";
import { GraphCatalogService } from "../graph.catalog.service";
import { ScopePredicateService } from "../scope.predicate.service";

const SCOPE: AgentScope = { id: "root-1", type: "roots", label: "Root" };

/** Minimal catalog entities — only the fields the predicate compiler reads. */
const entity = (params: {
  type: string;
  labelName: string;
  scope?: {
    path: Array<{ cypherLabel: string; cypherDirection: "in" | "out"; targetLabel: string }>;
    rootType: string;
  };
}) =>
  ({
    type: params.type,
    labelName: params.labelName,
    scope: params.scope ? { ...params.scope, rootLabel: "Root" } : undefined,
  }) as any;

const ROOT = entity({ type: "roots", labelName: "Root", scope: { path: [], rootType: "roots" } });
const CHILD = entity({
  type: "children",
  labelName: "Child",
  scope: { path: [{ cypherLabel: "PART_OF", cypherDirection: "out", targetLabel: "Root" }], rootType: "roots" },
});
const GRANDCHILD = entity({
  type: "grandchildren",
  labelName: "GrandChild",
  scope: {
    path: [
      { cypherLabel: "IN", cypherDirection: "out", targetLabel: "Child" },
      { cypherLabel: "PART_OF", cypherDirection: "out", targetLabel: "Root" },
    ],
    rootType: "roots",
  },
});
/** Catalogued, but belongs to a different scope tree entirely. */
const FOREIGN = entity({
  type: "others",
  labelName: "Other",
  scope: { path: [{ cypherLabel: "OWNED_BY", cypherDirection: "out", targetLabel: "Tenant" }], rootType: "tenants" },
});
/** Catalogued with no scope chain at all. */
const UNSCOPED = entity({ type: "loose", labelName: "Loose" });

describe("ScopePredicateService", () => {
  let catalog: { getAllEntities: ReturnType<typeof vi.fn> };
  let service: ScopePredicateService;

  beforeEach(() => {
    catalog = { getAllEntities: vi.fn(() => []) };
    service = new ScopePredicateService(catalog as unknown as GraphCatalogService);
  });

  it("matches the scope root itself on id, not on a relationship hop", () => {
    catalog.getAllEntities.mockReturnValue([ROOT]);

    const result = service.build({ alias: "data", scope: SCOPE });

    expect(result?.cypher).toContain("data:Root AND data.id = $agentScopeId");
    expect(result?.cypher).not.toContain("EXISTS");
    expect(result?.params).toEqual({ agentScopeId: "root-1" });
  });

  it("walks the full hop chain for a nested type", () => {
    catalog.getAllEntities.mockReturnValue([GRANDCHILD]);

    const result = service.build({ alias: "data", scope: SCOPE });

    expect(result?.cypher).toContain(
      "EXISTS { MATCH (data)-[:IN]->(:Child)-[:PART_OF]->(:Root { id: $agentScopeId }) }",
    );
  });

  it("unions one branch per in-scope type", () => {
    catalog.getAllEntities.mockReturnValue([ROOT, CHILD, GRANDCHILD]);

    const result = service.build({ alias: "data", scope: SCOPE });

    expect(result?.cypher.match(/OR/g)).toHaveLength(2);
    expect(result?.cypher).toContain("data:Root");
    expect(result?.cypher).toContain("data:Child");
    expect(result?.cypher).toContain("data:GrandChild");
  });

  // The fail-closed ruling: a type that cannot be proven in scope is out of
  // scope. Contributing no branch means it can never match.
  it("excludes types whose chain leads to a DIFFERENT root type", () => {
    catalog.getAllEntities.mockReturnValue([CHILD, FOREIGN]);

    const result = service.build({ alias: "data", scope: SCOPE });

    expect(result?.cypher).toContain("data:Child");
    expect(result?.cypher).not.toContain("Other");
    expect(result?.cypher).not.toContain("Tenant");
  });

  it("excludes types with no scope chain at all", () => {
    catalog.getAllEntities.mockReturnValue([CHILD, UNSCOPED]);

    const result = service.build({ alias: "data", scope: SCOPE });

    expect(result?.cypher).not.toContain("Loose");
  });

  it("returns null when NOTHING can reach the root, so the caller must retrieve nothing", () => {
    catalog.getAllEntities.mockReturnValue([FOREIGN, UNSCOPED]);

    expect(service.build({ alias: "data", scope: SCOPE })).toBeNull();
  });

  it("binds the scope id as a parameter rather than interpolating it", () => {
    catalog.getAllEntities.mockReturnValue([ROOT, CHILD]);

    const result = service.build({ alias: "data", scope: { ...SCOPE, id: "'; MATCH (n) DETACH DELETE n //" } });

    expect(result?.cypher).not.toContain("DETACH DELETE");
    expect(result?.params.agentScopeId).toBe("'; MATCH (n) DETACH DELETE n //");
  });

  it("honours the requested alias", () => {
    catalog.getAllEntities.mockReturnValue([CHILD]);

    const result = service.build({ alias: "scopedData", scope: SCOPE });

    expect(result?.cypher).toContain("scopedData:Child");
    expect(result?.cypher).toContain("MATCH (scopedData)-[:PART_OF]->");
  });
});
