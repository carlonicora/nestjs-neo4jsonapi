import { Test, TestingModule } from "@nestjs/testing";
import { ClsService } from "nestjs-cls";
import { afterEach, beforeEach, describe, expect, it, Mocked, vi } from "vitest";
import { Neo4jService } from "../../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../../core/security/services/security.service";
import { SkillRepository } from "../skill.repository";

describe("SkillRepository", () => {
  let repository: SkillRepository;
  let neo4jService: Mocked<Neo4jService>;
  let clsService: Mocked<ClsService>;

  const TEST_IDS = {
    skillId: "skill000-0001-4000-a000-000000000001",
    companyId: "company0-0001-4000-a000-000000000001",
    userId: "user0000-0001-4000-a000-000000000001",
  };

  const flat = (text: string) => text.replace(/\s+/g, " ");
  const lastQuery = (mock: any) => {
    const call = mock.mock.calls[mock.mock.calls.length - 1][0];
    return { text: flat(call.query), params: call.queryParams, raw: call };
  };

  beforeEach(async () => {
    const mockNeo4jService = {
      initQuery: vi.fn().mockImplementation((params?: any) => ({
        query: "",
        queryParams: { companyId: TEST_IDS.companyId, currentUserId: TEST_IDS.userId },
        cursor: params?.cursor,
        serialiser: params?.serialiser,
        fetchAll: params?.fetchAll,
      })),
      read: vi.fn(),
      readOne: vi.fn(),
      readMany: vi.fn().mockResolvedValue([]),
      readScalars: vi.fn().mockResolvedValue([]),
      writeOne: vi.fn(),
      validateRelatedNodes: vi.fn().mockResolvedValue(undefined),
    };

    const mockSecurityService = {
      userHasAccess: vi.fn().mockImplementation(({ validator }) => validator?.() ?? ""),
    };

    const mockClsService = { get: vi.fn(), set: vi.fn(), has: vi.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SkillRepository,
        { provide: Neo4jService, useValue: mockNeo4jService },
        { provide: SecurityService, useValue: mockSecurityService },
        { provide: ClsService, useValue: mockClsService },
      ],
    }).compile();

    repository = module.get(SkillRepository);
    neo4jService = module.get(Neo4jService) as Mocked<Neo4jService>;
    clsService = module.get(ClsService) as Mocked<ClsService>;

    clsService.get.mockImplementation((key: string) => {
      if (key === "userId") return TEST_IDS.userId;
      if (key === "companyId") return TEST_IDS.companyId;
      return undefined;
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("buildDefaultMatch", () => {
    it("reads active globals or the company's own skills, all values as parameters", () => {
      const text = flat((repository as any).buildDefaultMatch());
      expect(text).toContain("skill.isGlobal = true");
      expect(text).toContain("skill.isActive = true");
      expect(text).toMatch(/EXISTS \{ \(skill\)-\[:BELONGS_TO\]->\(:Company \{ id: \$companyId \}\) \}/);
      expect(text).not.toContain(TEST_IDS.companyId);
    });

    it("binds $searchValue for a search field", () => {
      const text = flat((repository as any).buildDefaultMatch({ searchField: "id" }));
      expect(text).toContain("MATCH (skill:Skill {id: $searchValue})");
    });
  });

  describe("buildReturnStatement", () => {
    it("keeps the relationship columns and adds the four per-caller columns", () => {
      const text = flat((repository as any).buildReturnStatement());
      expect(text).toContain("skill_company");
      expect(text).toContain("skill_original");
      for (const column of ["skillOrigin", "skillIsEnabled", "skillIsHidden", "skillCanRestore"]) {
        expect(text).toContain(`AS ${column}`);
      }
      expect(text).toContain("DISABLED_SKILL");
      expect(text).toContain("$companyId");
    });
  });

  describe("findScopedById", () => {
    it("reads through the scoped match and never checks for forbidden", async () => {
      neo4jService.readOne.mockResolvedValue(null);
      const result = await repository.findScopedById({ id: TEST_IDS.skillId });
      expect(result).toBeNull();
      expect(neo4jService.readOne).toHaveBeenCalledTimes(1);
      const { text, params } = lastQuery(neo4jService.readOne);
      expect(params.searchValue).toBe(TEST_IDS.skillId);
      expect(text).toContain("skill.isGlobal = true");
      expect(text).toContain("$companyId");
    });
  });

  describe("findForCompany", () => {
    it("hides a global the company has copied, pages with the cursor and orders company rows first", async () => {
      await repository.findForCompany({ cursor: { cursor: "0", limit: 25 } as any });
      const { text, raw } = lastQuery(neo4jService.readMany);
      expect(text).toMatch(/NOT EXISTS \{ MATCH \(copyOf:Skill\)-\[:OVERRIDES\]->\(skill\)/);
      expect(text).toContain("{CURSOR}");
      expect(text).toContain("ORDER BY skill.name ASC, skill.isGlobal ASC, skill.id ASC");
      expect(text.indexOf("ORDER BY")).toBeLessThan(text.indexOf("{CURSOR}"));
      expect(text).toContain("AS skillOrigin");
      expect(text).toContain("AS skillIsEnabled");
      expect(text).toContain("AS skillIsHidden");
      expect(text).toContain("AS skillCanRestore");
      expect(raw.cursor).toEqual({ cursor: "0", limit: 25 });
    });

    it("searches through the fulltext index with the same filter and the term as a parameter", async () => {
      await repository.findForCompany({ cursor: { cursor: "0", limit: 25 } as any, term: "quote" });
      const { text, params } = lastQuery(neo4jService.readMany);
      expect(text).toContain("db.index.fulltext.queryNodes");
      expect(text).toContain("$term");
      expect(text).not.toContain('quote"');
      expect(params.term).toBeDefined();
      expect(text).toContain("OVERRIDES");
      expect(text).toContain("{CURSOR}");
    });
  });

  describe("findActiveForCompany", () => {
    it("keeps own and copies that are on, and globals that are on, not switched off, not copied, not hidden", async () => {
      await repository.findActiveForCompany();
      const { text, raw } = lastQuery(neo4jService.readMany);
      expect(raw.fetchAll).toBe(true);
      expect(neo4jService.initQuery).toHaveBeenCalledWith(expect.objectContaining({ fetchAll: true }));
      expect(text).toMatch(
        /EXISTS \{ \(skill\)-\[:BELONGS_TO\]->\(:Company \{ id: \$companyId \}\) \} AND skill\.isActive = true/,
      );
      expect(text).toMatch(/NOT EXISTS \{ \(:Company \{ id: \$companyId \}\)-\[:DISABLED_SKILL\]->\(skill\) \}/);
      expect(text).toMatch(/NOT EXISTS \{ MATCH \(copyOf:Skill\)-\[:OVERRIDES\]->\(skill\)/);
      expect(text).toMatch(
        /NOT EXISTS \{ MATCH \(sameName:Skill\)-\[:BELONGS_TO\]->\(:Company \{ id: \$companyId \}\) WHERE sameName\.name = skill\.name/,
      );
      expect(text).not.toContain("IN $names");
    });
  });

  describe("findActiveByNames", () => {
    it("adds the names to the active predicate", async () => {
      await repository.findActiveByNames({ names: ["quote", "brief"] });
      const { text, params, raw } = lastQuery(neo4jService.readMany);
      expect(raw.fetchAll).toBe(true);
      expect(text).toContain("skill.name IN $names");
      expect(text).toContain("DISABLED_SKILL");
      expect(params.names).toEqual(["quote", "brief"]);
    });
  });

  describe("findGlobal / findGlobalById", () => {
    it("lists global skills only and never mentions the company", async () => {
      await repository.findGlobal({ cursor: { cursor: "0", limit: 25 } as any });
      const { text } = lastQuery(neo4jService.readMany);
      expect(text).toContain("skill.isGlobal = true");
      expect(text).toContain("{CURSOR}");
      expect(text).not.toContain("$companyId");
    });

    it("searches global skills only", async () => {
      await repository.findGlobal({ cursor: { cursor: "0", limit: 25 } as any, term: "quote" });
      const { text } = lastQuery(neo4jService.readMany);
      expect(text).toContain("db.index.fulltext.queryNodes");
      expect(text).toContain("skill.isGlobal = true");
      expect(text).not.toContain("$companyId");
    });

    it("reads one global skill by id and never mentions the company", async () => {
      neo4jService.readOne.mockResolvedValue(null);
      await repository.findGlobalById({ id: TEST_IDS.skillId });
      const { text, params } = lastQuery(neo4jService.readOne);
      expect(text).toContain("skill.isGlobal = true");
      expect(params.searchValue).toBe(TEST_IDS.skillId);
      expect(text).not.toContain("$companyId");
    });
  });

  describe("setDisabledForCompany", () => {
    it("checks the target before merging the edge", async () => {
      await repository.setDisabledForCompany({ id: TEST_IDS.skillId, disabled: true });
      expect(neo4jService.validateRelatedNodes).toHaveBeenCalledWith({
        nodes: [{ id: TEST_IDS.skillId, label: "Skill" }],
      });
      expect(neo4jService.validateRelatedNodes.mock.invocationCallOrder[0]).toBeLessThan(
        neo4jService.writeOne.mock.invocationCallOrder[0],
      );
      const { text, params } = lastQuery(neo4jService.writeOne);
      expect(text).toContain("MERGE");
      expect(text).toContain("DISABLED_SKILL");
      expect(text).not.toContain("DELETE");
      expect(params.id).toBe(TEST_IDS.skillId);
    });

    it("writes the edge from the company alias initQuery binds, with a serialiser and no WITH between", async () => {
      await repository.setDisabledForCompany({ id: TEST_IDS.skillId, disabled: true });
      expect(neo4jService.initQuery).toHaveBeenCalledWith(expect.objectContaining({ serialiser: expect.anything() }));
      const { text, params } = lastQuery(neo4jService.writeOne);
      expect(text).toContain("MERGE (company)-[:DISABLED_SKILL]->(skill)");
      expect(text).not.toContain("WITH");
      expect(text).not.toContain("$companyId");
      expect(params.id).toBe(TEST_IDS.skillId);
    });

    it("refuses without a company in context instead of merging an unbound company", async () => {
      clsService.get.mockImplementation((key: string) => (key === "userId" ? TEST_IDS.userId : undefined));
      await expect(repository.setDisabledForCompany({ id: TEST_IDS.skillId, disabled: true })).rejects.toThrow();
      expect(neo4jService.writeOne).not.toHaveBeenCalled();
    });

    it("deletes the edge to switch the global back on", async () => {
      await repository.setDisabledForCompany({ id: TEST_IDS.skillId, disabled: false });
      expect(neo4jService.validateRelatedNodes).toHaveBeenCalled();
      const { text } = lastQuery(neo4jService.writeOne);
      expect(text).toContain("DELETE");
      expect(text).not.toContain("MERGE");
    });
  });

  describe("countOwn", () => {
    it("counts the company's skills through readScalars seeded by initQuery", async () => {
      neo4jService.readScalars.mockResolvedValue([3] as any);
      const total = await repository.countOwn();
      expect(total).toBe(3);
      expect(neo4jService.initQuery).toHaveBeenCalled();
      const call = neo4jService.readScalars.mock.calls[0][0];
      expect(call.queryParams.companyId).toBe(TEST_IDS.companyId);
      expect(flat(call.query)).toContain("count(skill)");
      expect(call.map({ total: 7 })).toBe(7);
    });
  });

  describe("isCopiedByCompany", () => {
    it("checks the OVERRIDES edge from one of the company's skills, never the name", async () => {
      neo4jService.readScalars.mockResolvedValue([true] as any);
      const copied = await repository.isCopiedByCompany({ id: TEST_IDS.skillId });
      expect(copied).toBe(true);
      const call = neo4jService.readScalars.mock.calls[0][0];
      expect(call.queryParams).toMatchObject({ companyId: TEST_IDS.companyId, searchValue: TEST_IDS.skillId });
      expect(flat(call.query)).toContain("[:OVERRIDES]->(skill)");
      expect(flat(call.query)).not.toContain(".name =");
      expect(call.query).not.toContain(TEST_IDS.skillId);
      expect(call.map({ copied: true })).toBe(true);
      expect(call.map({ copied: false })).toBe(false);
    });

    it("answers false when the skill is not visible", async () => {
      neo4jService.readScalars.mockResolvedValue([] as any);
      expect(await repository.isCopiedByCompany({ id: TEST_IDS.skillId })).toBe(false);
    });
  });

  describe("findNameClash", () => {
    const callMap = () => neo4jService.readScalars.mock.calls[0][0];

    it("goes through readScalars with the name and excluded id as parameters", async () => {
      await repository.findNameClash({ name: "quote", excludeId: TEST_IDS.skillId });
      const call = callMap();
      expect(call.queryParams).toMatchObject({ name: "quote", excludeId: TEST_IDS.skillId });
      const text = flat(call.query);
      expect(text).toContain("skill.name = $name");
      expect(text).toContain("$excludeId");
      expect(text).toContain("OVERRIDES");
    });

    it("answers own when one of the company's skills has the name", async () => {
      neo4jService.readScalars.mockResolvedValue(["global", "own"] as any);
      expect(await repository.findNameClash({ name: "quote" })).toBe("own");
    });

    it("answers global when only an active, uncopied global has the name", async () => {
      neo4jService.readScalars.mockResolvedValue(["global"] as any);
      expect(await repository.findNameClash({ name: "quote" })).toBe("global");
    });

    it("answers null when nothing blocks the name", async () => {
      neo4jService.readScalars.mockResolvedValue([null] as any);
      expect(await repository.findNameClash({ name: "quote" })).toBeNull();
    });

    it("maps a row to its clash kind", async () => {
      await repository.findNameClash({ name: "quote" });
      expect(callMap().map({ clash: "own" })).toBe("own");
      expect(callMap().map({ clash: null })).toBeNull();
    });
  });

  describe("findGlobalNameClash", () => {
    it("checks global skills only", async () => {
      neo4jService.readScalars.mockResolvedValue([1] as any);
      expect(await repository.findGlobalNameClash({ name: "quote" })).toBe(true);
      const call = neo4jService.readScalars.mock.calls[0][0];
      expect(flat(call.query)).toContain("skill.isGlobal = true");
      expect(flat(call.query)).not.toContain("$companyId");
    });

    it("answers false when no global has the name", async () => {
      neo4jService.readScalars.mockResolvedValue([0] as any);
      expect(await repository.findGlobalNameClash({ name: "quote", excludeId: TEST_IDS.skillId })).toBe(false);
    });
  });
});
