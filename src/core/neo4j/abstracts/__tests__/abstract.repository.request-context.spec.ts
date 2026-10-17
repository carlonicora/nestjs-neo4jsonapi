import { vi, describe, it, expect } from "vitest";
import { AbstractRepository } from "../abstract.repository";

class TestRepo extends AbstractRepository<any, any> {
  protected readonly descriptor: any;

  constructor(deps: any) {
    super(deps.neo4j, deps.securityService, deps.clsService);
    this.descriptor = deps.descriptor;
  }

  public defaultMatch(options?: { searchField?: string; blockCompanyAndUser?: boolean }): string {
    return this.buildDefaultMatch(options);
  }
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

const globalDescriptor = {
  model: { nodeName: "edpbdocument", type: "edpbdocuments", labelName: "EdpbDocument" },
  defaultOrderBy: "updatedAt DESC",
  fulltextIndexName: "edpbdocument_search_index",
  isCompanyScoped: false,
  fields: {},
  fieldNames: [],
  fieldDefaults: {},
  relationships: {},
};

const scopedDescriptor = {
  ...globalDescriptor,
  model: { nodeName: "note", type: "notes", labelName: "Note" },
  isCompanyScoped: true,
};

const buildSut = (descriptor: any, bindsRequestContext?: boolean) => {
  const cls: Record<string, string> = { companyId: "c-1", userId: "u-1" };
  const captured: any[] = [];
  const clsService = {
    get: (key: string) => cls[key],
    has: (key: string) => cls[key] !== undefined,
  };
  const neo4j: any = {
    initQuery: () => ({
      query: "",
      queryParams: { companyId: cls.companyId, currentUserId: cls.userId },
    }),
    readMany: vi.fn(async (q: any) => {
      captured.push(q);
      return [];
    }),
    writeOne: vi.fn(async (q: any) => {
      captured.push(q);
    }),
    validateExistingNodes: vi.fn(),
  };
  // Absent = a Neo4jService with the default (binds request context)
  if (bindsRequestContext !== undefined) neo4j.bindsRequestContext = bindsRequestContext;
  const securityService = { userHasAccess: () => "" };
  const repo = new TestRepo({ neo4j, securityService, clsService, descriptor });
  (repo as any).buildReturnStatement = () => "RETURN node";
  return { repo, captured, neo4j };
};

describe("AbstractRepository — bindRequestContext: false", () => {
  it("carries neither company nor currentUser for a global entity, even with both in CLS", () => {
    const { repo } = buildSut(globalDescriptor, false);
    const cypher = squash(repo.defaultMatch());
    expect(cypher).toBe("MATCH (edpbdocument:EdpbDocument) WITH edpbdocument");
  });

  it("carries neither alias through the fulltext search branch", async () => {
    const { repo, captured } = buildSut(globalDescriptor, false);
    await repo.find({ term: "privacy" });
    const cypher = squash(captured[0].query);
    expect(cypher).toContain("WITH node AS edpbdocument, score CALL { WITH edpbdocument MATCH");
    expect(cypher).toContain("WITH edpbdocument, score ORDER BY score DESC");
    expect(cypher).not.toMatch(/\bcompany\b/);
    expect(cypher).not.toMatch(/\bcurrentUser\b/);
    expect(captured[0].queryParams.companyId).toBe("c-1");
    expect(captured[0].queryParams.currentUserId).toBe("u-1");
  });

  it("refuses a company-scoped entity in buildDefaultMatch and on every write", async () => {
    const { repo, neo4j } = buildSut(scopedDescriptor, false);
    const message = /notes: .*bindRequestContext: false/;
    expect(() => repo.defaultMatch()).toThrow(message);
    await expect(repo.find({})).rejects.toThrow(message);
    await expect(repo.create({ id: "n-1" })).rejects.toThrow(message);
    await expect(repo.put({ id: "n-1" })).rejects.toThrow(message);
    await expect(repo.patch({ id: "n-1" })).rejects.toThrow(message);
    await expect(repo.delete({ id: "n-1" })).rejects.toThrow(message);
    expect(neo4j.writeOne).not.toHaveBeenCalled();
  });

  it("refuses the add/remove relationship writes of a company-scoped entity", async () => {
    const { repo, neo4j } = buildSut(
      {
        ...scopedDescriptor,
        relationships: {
          tags: { model: { labelName: "Tag" }, direction: "out", relationship: "HAS_TAG", cardinality: "many" },
        },
      },
      false,
    );
    const message = /bindRequestContext: false/;
    await expect(repo.addToRelationship({ id: "n-1", relationship: "tags", items: [{ id: "t-1" }] })).rejects.toThrow(
      message,
    );
    await expect(repo.removeFromRelationship({ id: "n-1", relationship: "tags", itemIds: ["t-1"] })).rejects.toThrow(
      message,
    );
    expect(neo4j.writeOne).not.toHaveBeenCalled();
  });

  it("refuses a tenancy self / via entity", () => {
    expect(() => buildSut({ ...globalDescriptor, tenancy: "self" }, false).repo.defaultMatch()).toThrow(
      /bindRequestContext: false/,
    );
    expect(() =>
      buildSut(
        {
          ...globalDescriptor,
          tenancy: { via: "company" },
          relationships: {
            company: { model: { labelName: "Company" }, direction: "in", relationship: "HAS_X", cardinality: "one" },
          },
        },
        false,
      ).repo.defaultMatch(),
    ).toThrow(/bindRequestContext: false/);
  });

  it("still creates a global entity", async () => {
    const { repo, captured } = buildSut(globalDescriptor, false);
    await repo.create({ id: "d-1" });
    expect(squash(captured[0].query)).not.toContain("BELONGS_TO");
  });
});

describe("AbstractRepository — bindRequestContext default", () => {
  it.each([undefined, true])("keeps today's output (bindsRequestContext %s)", async (binds) => {
    expect(squash(buildSut(globalDescriptor, binds).repo.defaultMatch())).toBe(
      "MATCH (edpbdocument:EdpbDocument) WITH edpbdocument",
    );

    const scoped = squash(buildSut(scopedDescriptor, binds).repo.defaultMatch());
    expect(scoped).toBe(
      "MATCH (note:Note) WHERE $companyId IS NULL OR EXISTS { MATCH (note)-[:BELONGS_TO]-(company) } WITH note, company, currentUser",
    );

    const { repo, captured } = buildSut(globalDescriptor, binds);
    await repo.find({ term: "privacy" });
    const cypher = squash(captured[0].query);
    expect(cypher).toContain(
      "WITH node AS edpbdocument, score, company, currentUser CALL { WITH edpbdocument, company, currentUser",
    );
    expect(cypher).toContain("WITH edpbdocument, company, currentUser, score ORDER BY score DESC");

    const create = buildSut(scopedDescriptor, binds);
    await create.repo.create({ id: "n-1" });
    expect(squash(create.captured[0].query)).toContain("CREATE (note)-[:BELONGS_TO]->(company)");
  });
});
