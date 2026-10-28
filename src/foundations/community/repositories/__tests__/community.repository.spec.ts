import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mocked } from "vitest";
import { ClsService } from "nestjs-cls";
import { modelRegistry } from "../../../../common/registries/registry";
import { AgentScopeFilterService } from "../../../../common/repositories/agent-scope.filter";
import { EmbedderService } from "../../../../core/llm/services/embedder.service";
import { ModelService } from "../../../../core/llm/services/model.service";
import { Neo4jService } from "../../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../../core/security/services/security.service";
import { KeyConceptModel } from "../../../keyconcept/entities/key.concept.model";
import { CommunityDescriptor } from "../../entities/community.entity";
import { CommunityLayerService } from "../../services/community-layer.service";
import { COMMUNITY_EXACT_SCAN_MAX_SCOPED_NODES, CommunityRepository } from "../community.repository";

const SCOPE_ROOT_MODEL = {
  type: "scope-root-specs",
  endpoint: "scope-root-specs",
  nodeName: "scopeRootSpec",
  labelName: "ScopeRootSpec",
  entity: undefined,
  mapper: undefined,
} as any;

const CONTENT_MODEL = {
  type: "content-specs",
  endpoint: "content-specs",
  nodeName: "contentSpec",
  labelName: "ContentSpec",
  entity: undefined,
  mapper: undefined,
} as any;

const LAYER = { type: "scope-root-specs", labelName: "ScopeRootSpec", nodeName: "scopeRootSpec" };

describe("CommunityRepository", () => {
  let companyId: string | null;
  let neo4j: Record<string, any>;
  let cls: Record<string, any>;
  let agentScope: Record<string, any>;
  let layer: Mocked<CommunityLayerService>;
  let repository: CommunityRepository;

  /** Every query text the repository sent, in order. */
  const sentQueries = (): string[] => {
    const texts: { order: number; text: string }[] = [];
    for (const method of ["writeOne", "readOne", "readMany"]) {
      neo4j[method].mock.calls.forEach((call: any[], i: number) =>
        texts.push({ order: neo4j[method].mock.invocationCallOrder[i], text: call[0].query }),
      );
    }
    neo4j.read.mock.calls.forEach((call: any[], i: number) =>
      texts.push({ order: neo4j.read.mock.invocationCallOrder[i], text: call[0] }),
    );
    return texts.sort((a, b) => a.order - b.order).map((t) => t.text);
  };

  beforeAll(() => {
    modelRegistry.register(SCOPE_ROOT_MODEL);
    modelRegistry.register(CONTENT_MODEL);
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    companyId = "company-1";
    neo4j = {
      bindsRequestContext: true,
      initQuery: vi.fn(() => ({ query: "PREAMBLE", queryParams: { companyId } })),
      writeOne: vi.fn().mockResolvedValue(null),
      readOne: vi.fn().mockResolvedValue(null),
      readMany: vi.fn().mockResolvedValue([]),
      read: vi.fn().mockResolvedValue({ records: [] }),
      validateRelatedNodes: vi.fn().mockResolvedValue(undefined),
    };
    cls = {
      get: vi.fn((key: string) => (key === "companyId" ? companyId : undefined)),
      has: vi.fn((key: string) => key === "companyId" && !!companyId),
    };
    agentScope = { current: vi.fn(() => undefined) };
    layer = {
      current: vi.fn(() => undefined),
      ready: vi.fn(async () => layer.current()),
    } as unknown as Mocked<CommunityLayerService>;

    repository = new CommunityRepository(
      neo4j as unknown as Neo4jService,
      {} as SecurityService,
      cls as unknown as ClsService,
      { vectoriseText: vi.fn() } as unknown as EmbedderService,
      { getEmbedderDimensions: vi.fn(() => 1536) } as unknown as ModelService,
      agentScope as unknown as AgentScopeFilterService,
      layer,
    );
  });

  it("starts every Community query from the initQuery preamble and the default match", async () => {
    await repository.findCommunityById("c1");
    await repository.findByLevel({ level: 0 });
    await repository.markAsStale(["c1"]);
    await repository.updateSummary({ communityId: "c1", name: "n", summary: "s", embedding: [1], rating: 1 });
    await repository.deleteCommunity("c1");
    await repository.clearStaleness({ communityIds: ["c1"] });

    const queries = sentQueries();
    expect(queries).toHaveLength(6);
    for (const query of queries) {
      expect(query.startsWith("PREAMBLE")).toBe(true);
      expect(query).toContain("MATCH (community:Community");
      expect(query).toContain("$companyId IS NULL");
    }
  });

  it("never joins the company by hand", async () => {
    layer.current.mockReturnValue(LAYER);
    neo4j.read.mockResolvedValue({ records: [{ get: () => 1 }] });

    await repository.createCommunity({ name: "n", level: 0, memberCount: 1, scopeRoot: { id: "r1", label: "X" } });
    await repository.updateCommunityMembers({ communityId: "c1", keyConceptIds: ["k1"] });
    await repository.setParentCommunity({ childCommunityId: "c1", parentCommunityId: "c2" });
    await repository.markAsStale(["c1"]);
    await repository.markPendingCredits("c1");
    await repository.countPendingCredits();
    await repository.countStaleCommunities();
    await repository.findAllStaleCommunities();
    await repository.findScopeRootForCommunity({ communityId: "c1" });
    await repository.deleteCommunitiesForScope({ scope: { id: "r1", type: LAYER.type, label: LAYER.labelName } });
    await repository.updateSummary({ communityId: "c1", name: "n", summary: "s", embedding: [1], rating: 1 });
    await repository.findByVector({ embedding: [1], topK: 3 });
    await repository.findByLevel({ level: 0 });
    await repository.findMemberKeyConcepts("c1");
    await repository.findMemberRelationships("c1");
    await repository.getHierarchy("c1");
    await repository.getChildren("c1");
    await repository.deleteCommunity("c1");
    await repository.deleteAllCommunities();
    await repository.findCommunitiesByKeyConcept("k1");
    await repository.countByLevel();
    await repository.findCommunityById("c1");
    await repository.findCommunitiesByRelatedKeyConcepts("k1", { id: "r1", label: "X" });
    await repository.addMemberToCommunity("c1", "k1");
    await repository.findOrphanKeyConceptsForContent("content-1", "ContentSpec");
    await repository.clearStaleness({ communityIds: ["c1"] });

    for (const query of sentQueries()) {
      for (const line of query.split("\n")) {
        if (line.includes("-[:BELONGS_TO]->(company)")) expect(line.trim().startsWith("CREATE")).toBe(true);
        expect(line).not.toMatch(/MATCH \(community[^)]*\)-\[:BELONGS_TO\]->\(company\)/);
      }
    }
  });

  it("returns [] from findByVector and findOrphanKeyConceptsForContent with no company", async () => {
    companyId = null;

    expect(await repository.findByVector({ embedding: [1], topK: 3 })).toEqual([]);
    expect(await repository.findOrphanKeyConceptsForContent("content-1", "ContentSpec")).toEqual([]);
    expect(sentQueries()).toEqual([]);
  });

  it("uses the layer label, not the caller's, in findCommunitiesByRelatedKeyConcepts", async () => {
    layer.current.mockReturnValue(LAYER);

    await repository.findCommunitiesByRelatedKeyConcepts("k1", { id: "r1", label: "Injected" });

    const [query] = sentQueries();
    expect(query).toContain("[:SCOPED_TO]->(:ScopeRootSpec { id: $scopeRootId })");
    expect(query).not.toContain("Injected");
  });

  it("throws on createCommunity with no company in context", async () => {
    companyId = null;

    await expect(repository.createCommunity({ name: "n", level: 0, memberCount: 1 })).rejects.toThrow(
      "CommunityRepository.createCommunity: no company in context",
    );
    expect(neo4j.writeOne).not.toHaveBeenCalled();
  });

  it("returns null from findScopeRootForCommunity with no company", async () => {
    layer.current.mockReturnValue(LAYER);
    companyId = null;

    expect(await repository.findScopeRootForCommunity({ communityId: "c1" })).toBeNull();
    expect(neo4j.readOne).not.toHaveBeenCalled();
  });

  it("returns null from findScopeRootForCommunity on the company layer", async () => {
    expect(await repository.findScopeRootForCommunity({ communityId: "c1", rootLabels: ["ScopeRootSpec"] })).toBeNull();
    expect(neo4j.readOne).not.toHaveBeenCalled();
  });

  it("scopes the scope root to the company in findScopeRootForCommunity", async () => {
    layer.current.mockReturnValue(LAYER);
    neo4j.readOne.mockResolvedValue({ id: "r1" });

    const root = await repository.findScopeRootForCommunity({ communityId: "c1" });

    expect(root).toEqual({ id: "r1", type: LAYER.type, label: LAYER.labelName });
    expect(neo4j.initQuery).toHaveBeenCalledWith({ serialiser: SCOPE_ROOT_MODEL });
    const { query, queryParams } = neo4j.readOne.mock.calls[0][0];
    expect(queryParams.searchValue).toBe("c1");
    expect(query).toContain("MATCH (community:Community {id: $searchValue})");
    expect(query).toContain("MATCH (community)-[:SCOPED_TO]->(scopeRootSpec:ScopeRootSpec)");
    expect(query).toContain("EXISTS { MATCH (scopeRootSpec)-[:BELONGS_TO]-(company) }");
    expect(query).toContain("RETURN scopeRootSpec");
  });

  it("validates the scope root before writing SCOPED_TO", async () => {
    layer.current.mockReturnValue(LAYER);

    await repository.createCommunity({ name: "n", level: 0, memberCount: 1, scopeRoot: { id: "r1", label: "X" } });

    expect(neo4j.validateRelatedNodes).toHaveBeenCalledWith({ nodes: [{ id: "r1", label: "ScopeRootSpec" }] });
    expect(neo4j.validateRelatedNodes.mock.invocationCallOrder[0]).toBeLessThan(
      neo4j.writeOne.mock.invocationCallOrder[0],
    );
    const { query } = neo4j.writeOne.mock.calls[0][0];
    expect(query).toContain("MATCH (scopeRoot:ScopeRootSpec { id: $scopeRootId })");
    expect(query).toContain("CREATE (community)-[:SCOPED_TO]->(scopeRoot)");
    expect(query).not.toContain(":X");
  });

  it("throws on createCommunity with a scope root and no layer", async () => {
    await expect(
      repository.createCommunity({ name: "n", level: 0, memberCount: 1, scopeRoot: { id: "r1", label: "X" } }),
    ).rejects.toThrow();
    expect(neo4j.writeOne).not.toHaveBeenCalled();
  });

  it("does nothing in deleteCommunitiesForScope when the scope type is not the layer", async () => {
    layer.current.mockReturnValue(LAYER);

    await repository.deleteCommunitiesForScope({ scope: { id: "r1", type: "other-roots", label: "OtherRoot" } });

    expect(neo4j.writeOne).not.toHaveBeenCalled();
  });

  it("deletes the layer root's groups in deleteCommunitiesForScope", async () => {
    layer.current.mockReturnValue(LAYER);

    await repository.deleteCommunitiesForScope({ scope: { id: "r1", type: LAYER.type, label: "Ignored" } });

    const { query, queryParams } = neo4j.writeOne.mock.calls[0][0];
    expect(queryParams.scopeRootId).toBe("r1");
    expect(query).toContain("[:SCOPED_TO]->(:ScopeRootSpec { id: $scopeRootId })");
    expect(query).toContain("DETACH DELETE community");
    expect(query).not.toContain("Ignored");
  });

  it("returns [] from findByVector when the chat scope type differs from the layer", async () => {
    layer.current.mockReturnValue(LAYER);
    agentScope.current.mockReturnValue({ id: "p1", type: "proceedings", label: "Proceeding" });

    expect(await repository.findByVector({ embedding: [1], topK: 3 })).toEqual([]);
    expect(neo4j.read).not.toHaveBeenCalled();
    expect(neo4j.readMany).not.toHaveBeenCalled();
  });

  it("returns [] from findByVector on the company layer in a scoped chat", async () => {
    agentScope.current.mockReturnValue({ id: "p1", type: "proceedings", label: "Proceeding" });

    expect(await repository.findByVector({ embedding: [1], topK: 3 })).toEqual([]);
    expect(neo4j.read).not.toHaveBeenCalled();
    expect(neo4j.readMany).not.toHaveBeenCalled();
  });

  it("keeps the exact scan up to 5000 groups and the vector index above it", async () => {
    layer.current.mockReturnValue(LAYER);
    agentScope.current.mockReturnValue({ id: "r1", type: LAYER.type, label: LAYER.labelName });
    expect(COMMUNITY_EXACT_SCAN_MAX_SCOPED_NODES).toBe(5000);

    neo4j.read.mockResolvedValueOnce({ records: [{ get: () => 5000 }] });
    await repository.findByVector({ embedding: [1], topK: 3, level: 1 });
    const exact = neo4j.readMany.mock.calls[0][0];
    expect(exact.query).not.toContain("db.index.vector.queryNodes");
    expect(exact.query).toContain("vector.similarity.cosine(community.embedding, $embedding)");
    expect(exact.query).toContain("$companyId IS NULL");
    expect(exact.query).toContain("[:SCOPED_TO]->(:ScopeRootSpec { id: $agentScopeId })");
    expect(exact.queryParams).toMatchObject({ agentScopeId: "r1", level: 1, topK: 3 });

    const count = neo4j.read.mock.calls[0];
    expect(count[0]).toContain("$companyId IS NULL");
    expect(count[0]).toContain("RETURN count(community) AS scopedCount");

    neo4j.read.mockResolvedValueOnce({ records: [{ get: () => 5001 }] });
    await repository.findByVector({ embedding: [1], topK: 3 });
    const indexed = neo4j.readMany.mock.calls[1][0].query as string;
    expect(indexed).toContain("CALL db.index.vector.queryNodes('communities', $topK * 2, $embedding)");
    expect(indexed.indexOf("WHERE EXISTS { MATCH (community)-[:BELONGS_TO]-(company) }")).toBeGreaterThan(
      indexed.indexOf("CALL db.index.vector.queryNodes"),
    );
    expect(indexed).toContain("[:SCOPED_TO]->(:ScopeRootSpec { id: $agentScopeId })");
  });

  it("returns [] from findByVector when the company has no embedded groups", async () => {
    neo4j.read.mockResolvedValueOnce({ records: [{ get: () => 0 }] });

    expect(await repository.findByVector({ embedding: [1], topK: 3 })).toEqual([]);
    expect(neo4j.readMany).not.toHaveBeenCalled();
  });

  it("returns [] from findOrphanKeyConceptsForContent for an unregistered label", async () => {
    expect(await repository.findOrphanKeyConceptsForContent("content-1", "Evil) DETACH DELETE (n")).toEqual([]);
    expect(sentQueries()).toEqual([]);
  });

  it("scopes findOrphanKeyConceptsForContent to this company's content and groups", async () => {
    neo4j.readMany.mockResolvedValue([{ id: "k1" }, { id: "k2" }]);

    const ids = await repository.findOrphanKeyConceptsForContent("content-1", "contentspec");

    expect(ids).toEqual(["k1", "k2"]);
    expect(neo4j.initQuery).toHaveBeenCalledWith({ serialiser: KeyConceptModel });
    const { query, queryParams } = neo4j.readMany.mock.calls[0][0];
    expect(queryParams.contentId).toBe("content-1");
    expect(query).toContain("MATCH (content:ContentSpec {id: $contentId})");
    expect(query).toContain("EXISTS { MATCH (content)-[:BELONGS_TO]-(company) }");
    expect(query).toContain(
      "NOT EXISTS { MATCH (keyconcept)<-[:HAS_MEMBER]-(community:Community) WHERE EXISTS { MATCH (community)-[:BELONGS_TO]-(company) } }",
    );
    expect(query).toContain("RETURN DISTINCT keyconcept");
  });

  it("throws on every write with no company in context", async () => {
    companyId = null;

    await expect(repository.deleteAllCommunities()).rejects.toThrow(
      "CommunityRepository.deleteAllCommunities: no company in context",
    );
    await expect(repository.markAsStale(["c1"])).rejects.toThrow(
      "CommunityRepository.markAsStale: no company in context",
    );
    await expect(
      repository.updateSummary({ communityId: "c1", name: "n", summary: "s", embedding: [1], rating: 1 }),
    ).rejects.toThrow("CommunityRepository.updateSummary: no company in context");
    await expect(repository.clearPendingCredits()).rejects.toThrow("no company in context");
    expect(neo4j.writeOne).not.toHaveBeenCalled();
  });

  it("does nothing in deleteCommunitiesForScope with no company in context", async () => {
    companyId = null;
    layer.current.mockReturnValue(LAYER);

    await repository.deleteCommunitiesForScope({ scope: { id: "r1", type: LAYER.type, label: LAYER.labelName } });

    expect(neo4j.writeOne).not.toHaveBeenCalled();
  });

  it("scopes parent and child groups to the company", async () => {
    await repository.setParentCommunity({ childCommunityId: "c1", parentCommunityId: "c2" });
    await repository.getHierarchy("c1");
    await repository.getChildren("c1");

    expect(neo4j.writeOne.mock.calls[0][0].query).toContain("EXISTS { MATCH (parent)-[:BELONGS_TO]-(company) }");
    expect(neo4j.readMany.mock.calls[0][0].query).toContain(
      "all(node IN nodes(path) WHERE EXISTS { MATCH (node)-[:BELONGS_TO]-(company) })",
    );
    expect(neo4j.readMany.mock.calls[1][0].query).toContain("EXISTS { MATCH (child)-[:BELONGS_TO]-(company) }");
  });

  it("reads the layer's root ids through the layer label, scoped to the company", async () => {
    layer.current.mockReturnValue(LAYER);
    neo4j.readMany.mockResolvedValue([{ id: "r1" }, { id: "r2" }]);

    expect(await repository.findLayerRootIds()).toEqual(["r1", "r2"]);

    const query = neo4j.readMany.mock.calls[0][0];
    expect(query.query.startsWith("PREAMBLE")).toBe(true);
    expect(query.query).toContain("MATCH (scopeRootSpec:ScopeRootSpec)");
    expect(query.query).toContain("EXISTS { MATCH (scopeRootSpec)-[:BELONGS_TO]-(company) }");
    expect(neo4j.initQuery).toHaveBeenCalledWith({ serialiser: SCOPE_ROOT_MODEL });
  });

  it("returns no layer roots on the company layer or with no company", async () => {
    expect(await repository.findLayerRootIds()).toEqual([]);
    layer.current.mockReturnValue(LAYER);
    companyId = null;
    expect(await repository.findLayerRootIds()).toEqual([]);
    expect(neo4j.readMany).not.toHaveBeenCalled();
  });

  it("keeps the deprecated findById(id) string form", async () => {
    neo4j.readOne.mockResolvedValue({ id: "c1" });

    expect(await repository.findById("c1")).toEqual({ id: "c1" });
    expect(neo4j.readOne.mock.calls[0][0].queryParams.searchValue).toBe("c1");
  });

  it("validates related nodes before writing HAS_MEMBER and PARENT_OF", async () => {
    await repository.updateCommunityMembers({ communityId: "c1", keyConceptIds: ["k1", "k2"] });
    expect(neo4j.validateRelatedNodes).toHaveBeenCalledWith({
      nodes: [
        { id: "k1", label: "KeyConcept" },
        { id: "k2", label: "KeyConcept" },
      ],
    });
    const memberWrite = neo4j.writeOne.mock.calls.findIndex((c: any[]) =>
      c[0].query.includes("MERGE (community)-[:HAS_MEMBER]"),
    );
    expect(neo4j.validateRelatedNodes.mock.invocationCallOrder[0]).toBeLessThan(
      neo4j.writeOne.mock.invocationCallOrder[memberWrite],
    );

    neo4j.validateRelatedNodes.mockClear();
    neo4j.writeOne.mockClear();
    await repository.addMemberToCommunity("c1", "k3");
    expect(neo4j.validateRelatedNodes).toHaveBeenCalledWith({ nodes: [{ id: "k3", label: "KeyConcept" }] });
    expect(neo4j.validateRelatedNodes.mock.invocationCallOrder[0]).toBeLessThan(
      neo4j.writeOne.mock.invocationCallOrder[0],
    );

    neo4j.validateRelatedNodes.mockClear();
    neo4j.writeOne.mockClear();
    await repository.setParentCommunity({ childCommunityId: "c1", parentCommunityId: "c2" });
    expect(neo4j.validateRelatedNodes).toHaveBeenCalledWith({ nodes: [{ id: "c2", label: "Community" }] });
    const { query, queryParams } = neo4j.writeOne.mock.calls[0][0];
    expect(queryParams).toMatchObject({ searchValue: "c1", parentCommunityId: "c2" });
    expect(query).toContain("MERGE (parent)-[:PARENT_OF]->(community)");
  });

  it("refuses an invalid related node without writing", async () => {
    neo4j.validateRelatedNodes.mockRejectedValue(new Error("400"));

    await expect(repository.addMemberToCommunity("c1", "k-other")).rejects.toThrow("400");
    expect(neo4j.writeOne).not.toHaveBeenCalled();
  });

  it("maps findAllStaleCommunities to community and company ids with no company in context", async () => {
    companyId = null;
    neo4j.readMany.mockResolvedValue([
      { id: "c1", company: { id: "co1" } },
      { id: "c2", company: { id: "co2" } },
    ]);

    const stale = await repository.findAllStaleCommunities();

    expect(stale).toEqual([
      { communityId: "c1", companyId: "co1" },
      { communityId: "c2", companyId: "co2" },
    ]);
    const { query } = neo4j.readMany.mock.calls[0][0];
    expect(query).toContain("$companyId IS NULL");
    expect(query).toContain("MATCH (community)-[:BELONGS_TO]->(community_company:Company)");
    expect(query).toContain("RETURN community, community_company");
    expect(query).toContain("ORDER BY community.staleSince ASC");
  });

  it("clears staleness for the given ids", async () => {
    await repository.clearStaleness({ communityIds: ["c1", "c2"] });

    const { query, queryParams } = neo4j.writeOne.mock.calls[0][0];
    expect(queryParams.communityIds).toEqual(["c1", "c2"]);
    expect(query).toContain("WHERE community.id IN $communityIds");
    expect(query).toContain("community.isStale = false");
    expect(query).toContain("community.staleSince = null");
    expect(query).toContain("community.updatedAt = datetime()");
  });

  it("does nothing in clearStaleness for no ids", async () => {
    await repository.clearStaleness({ communityIds: [] });
    expect(neo4j.writeOne).not.toHaveBeenCalled();
  });

  it("maps findCommunitiesByRelatedKeyConcepts computed totals", async () => {
    neo4j.readMany.mockResolvedValue([
      { id: "c1", memberCount: 4, relationshipCount: 2, totalWeight: 1.5 },
      { id: "c2", memberCount: undefined, relationshipCount: undefined, totalWeight: undefined },
    ]);

    const rows = await repository.findCommunitiesByRelatedKeyConcepts("k1");

    expect(rows).toEqual([
      { communityId: "c1", memberCount: 4, relationshipCount: 2, totalWeight: 1.5 },
      { communityId: "c2", memberCount: 0, relationshipCount: 0, totalWeight: 0 },
    ]);
    const { query } = neo4j.readMany.mock.calls[0][0];
    expect(query).toContain("RETURN community, relationshipCount, totalWeight");
    expect(query).not.toContain("SCOPED_TO");
  });

  it("reads the computed totals from the record in the descriptor", () => {
    const record = {
      has: (key: string) => key === "relationshipCount" || key === "totalWeight",
      get: (key: string) => (key === "relationshipCount" ? { toNumber: () => 3 } : 2.5),
    };
    const mapped = CommunityDescriptor.model.mapper({
      data: { id: "c1", name: "n", memberCount: 2 },
      record,
      entityFactory: undefined as any,
    });

    expect(mapped.relationshipCount).toBe(3);
    expect(mapped.totalWeight).toBe(2.5);
    expect(CommunityDescriptor.isCompanyScoped).toBe(true);
    expect(CommunityDescriptor.indexes).toEqual([]);
  });

  it("maps findMemberKeyConcepts through KeyConceptModel", async () => {
    neo4j.readMany.mockResolvedValue([{ id: "k1", value: "v", description: null }]);

    expect(await repository.findMemberKeyConcepts("c1")).toEqual([{ id: "k1", value: "v", description: undefined }]);
    expect(neo4j.initQuery).toHaveBeenCalledWith({ serialiser: KeyConceptModel });
    expect(neo4j.readMany.mock.calls[0][0].query).toContain("RETURN keyconcept");
  });

  it("creates the constraint then the communities vector index", async () => {
    await repository.onModuleInit();

    const queries = neo4j.writeOne.mock.calls.map((c: any[]) => c[0].query as string);
    expect(queries[0]).toContain(
      "CREATE CONSTRAINT community_id IF NOT EXISTS FOR (community:Community) REQUIRE community.id IS UNIQUE",
    );
    expect(queries[1]).toContain("CREATE VECTOR INDEX communities IF NOT EXISTS");
    expect(queries[1]).toContain("`vector.dimensions`: 1536");
    expect(queries).toHaveLength(2);
  });
});
