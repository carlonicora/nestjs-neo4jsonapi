import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { entityTenancyRegistry } from "../../../../common/registries/entity-tenancy.registry";
import { Neo4jService } from "../../services/neo4j.service";
import { AbstractRepository } from "../abstract.repository";

/**
 * The company check on client-supplied relationship ids (assertRelatedInCompany →
 * Neo4jService.validateRelatedNodes), end to end through the generic writers.
 *
 * `validateRelatedNodes` is the real implementation; only `read` is faked by a tiny in-memory
 * graph that evaluates each generated `CALL {}` group: the label, the ids, and the rule read
 * back from the predicate text. A foreign id therefore fails exactly like a missing one.
 */
const MY_COMPANY = "company-mine";
const OTHER_COMPANY = "company-other";
const ME = "user-me";

type Row = { label: string; company: string | null };
const GRAPH: Record<string, Row> = {
  "scoped-mine": { label: "ArcScoped", company: MY_COMPANY },
  "scoped-other": { label: "ArcScoped", company: OTHER_COMPANY },
  "global-1": { label: "ArcGlobal", company: null },
  "shared-platform": { label: "ArcShared", company: null },
  "shared-mine": { label: "ArcShared", company: MY_COMPANY },
  "shared-other": { label: "ArcShared", company: OTHER_COMPANY },
  [ME]: { label: "ArcUser", company: "company-of-my-home" },
  "user-other": { label: "ArcUser", company: OTHER_COMPANY },
};

/** Evaluates the query validateRelatedNodes builds against GRAPH. */
const fakeRead = (query: string, params: Record<string, any>) => {
  let found = 0;
  const blocks = query.split("CALL {").slice(1);
  blocks.forEach((block, index) => {
    const label = /MATCH \(t:(\w+) \{id: relatedId\}\)/.exec(block)![1];
    const allowPlatform = block.includes("NOT EXISTS");
    const companyRule = block.includes("BELONGS_TO]->(:Company {id: $companyId})");
    for (const id of params[`ids${index}`] as string[]) {
      const row = GRAPH[id];
      if (!row || row.label !== label) continue;
      if (!companyRule) found++;
      else if (row.company === params.companyId || (allowPlatform && row.company === null)) found++;
    }
  });
  return Promise.resolve({ records: [{ get: () => found }] });
};

const meta = (labelName: string) => ({ type: labelName.toLowerCase(), endpoint: "x", nodeName: "n", labelName });

const descriptor: any = {
  model: { nodeName: "thing", type: "things", labelName: "ArcThing" },
  isCompanyScoped: true,
  fieldNames: ["name"],
  fields: { name: { type: "string" } },
  fieldDefaults: {},
  relationships: {
    company: { model: meta("Company"), direction: "out", relationship: "BELONGS_TO", cardinality: "one" },
    parent: { model: meta("ArcScoped"), direction: "out", relationship: "CHILD_OF", cardinality: "one" },
    tags: { model: meta("ArcGlobal"), direction: "out", relationship: "TAGGED", cardinality: "many" },
    members: { model: meta("ArcScoped"), direction: "out", relationship: "HAS_MEMBER", cardinality: "many" },
    shared: { model: meta("ArcShared"), direction: "out", relationship: "USES", cardinality: "many" },
    partner: {
      model: meta("ArcScoped"),
      direction: "out",
      relationship: "PARTNERS",
      cardinality: "one",
      crossCompany: true,
    },
    assignee: { model: meta("ArcUser"), direction: "out", relationship: "ASSIGNED", cardinality: "one" },
    author: {
      model: meta("ArcUser"),
      direction: "in",
      relationship: "WROTE",
      cardinality: "one",
      contextKey: "userId",
    },
    locked: {
      model: meta("ArcScoped"),
      direction: "out",
      relationship: "LOCKED_TO",
      cardinality: "one",
      immutable: true,
    },
    hidden: {
      model: meta("ArcScoped"),
      direction: "out",
      relationship: "HIDDEN",
      cardinality: "many",
      readOnly: true,
    },
  },
};

class ThingRepository extends AbstractRepository<any, any> {
  protected readonly descriptor = descriptor;
}

const buildSut = (cls: { companyId?: string; userId?: string } = { companyId: MY_COMPANY, userId: ME }) => {
  const clsService = {
    get: (key: string) => (cls as any)[key],
    has: (key: string) => (cls as any)[key] !== undefined,
  };
  const read = vi.fn(fakeRead);
  const neo4j = Object.create(Neo4jService.prototype);
  Object.assign(neo4j, {
    cls: clsService,
    read,
    initQuery: () => ({
      query: "",
      queryParams: { companyId: cls.companyId ?? null, currentUserId: cls.userId ?? null },
    }),
    writeOne: vi.fn().mockResolvedValue(undefined),
  });
  const repo = new ThingRepository(neo4j, {} as any, clsService as any);
  return { repo, neo4j, read };
};

const refused = async (promise: Promise<unknown>) => {
  await expect(promise).rejects.toThrow(BadRequestException);
};

describe("AbstractRepository — related ids must belong to the caller's company", () => {
  beforeAll(() => {
    entityTenancyRegistry.register({ labelName: "ArcScoped", isCompanyScoped: true });
    entityTenancyRegistry.register({ labelName: "ArcUser", isCompanyScoped: true });
    entityTenancyRegistry.register({ labelName: "ArcGlobal", isCompanyScoped: false, tenancy: "global" });
    entityTenancyRegistry.register({ labelName: "ArcShared", isCompanyScoped: true, linkScope: "own-or-platform" });
  });
  afterAll(() => {
    for (const label of ["ArcScoped", "ArcUser", "ArcGlobal", "ArcShared"]) entityTenancyRegistry.unregister(label);
  });

  describe.each(["create", "put", "patch"] as const)("%s", (mode) => {
    it("refuses a foreign id with the 'do not exist' 400 and writes nothing", async () => {
      const { repo, neo4j } = buildSut();
      const call = repo[mode]({ id: "t1", name: "x", parent: "scoped-other" });
      await expect(call).rejects.toThrow("One or more related nodes do not exist.");
      expect(neo4j.writeOne).not.toHaveBeenCalled();
    });

    it("refuses a missing id with the same 400", async () => {
      const { repo, neo4j } = buildSut();
      await refused(repo[mode]({ id: "t1", name: "x", parent: "does-not-exist" }));
      expect(neo4j.writeOne).not.toHaveBeenCalled();
    });

    it("accepts own, global and platform targets", async () => {
      const { repo, neo4j } = buildSut();
      await repo[mode]({
        id: "t1",
        name: "x",
        parent: "scoped-mine",
        tags: ["global-1"],
        shared: ["shared-platform", "shared-mine"],
      });
      expect(neo4j.writeOne).toHaveBeenCalledTimes(1);
    });

    it("own-or-platform refuses another company's row", async () => {
      const { repo } = buildSut();
      await refused(repo[mode]({ id: "t1", name: "x", shared: ["shared-platform", "shared-other"] }));
    });

    it("crossCompany relationship: existence only", async () => {
      const { repo, neo4j } = buildSut();
      await repo[mode]({ id: "t1", name: "x", partner: "scoped-other" });
      expect(neo4j.writeOne).toHaveBeenCalledTimes(1);
      await refused(repo[mode]({ id: "t1", name: "x", partner: "does-not-exist" }));
    });

    it("the caller's own user id is always allowed (existence only)", async () => {
      const { repo, neo4j } = buildSut();
      await repo[mode]({ id: "t1", name: "x", assignee: ME });
      expect(neo4j.writeOne).toHaveBeenCalledTimes(1);
      await refused(repo[mode]({ id: "t1", name: "x", assignee: "user-other" }));
    });

    it("server-filled contextKey values are existence-only", async () => {
      const { repo, neo4j } = buildSut();
      await repo[mode]({ id: "t1", name: "x", author: "user-other" });
      expect(neo4j.writeOne).toHaveBeenCalledTimes(1);
    });

    it("never checks readOnly relationships or the managed company edge", async () => {
      const { repo, read } = buildSut();
      await repo[mode]({ id: "t1", name: "x", hidden: ["scoped-other"], company: OTHER_COMPANY });
      expect(read).not.toHaveBeenCalled();
    });

    it("no CLS company (system job): existence only", async () => {
      const { repo, neo4j } = buildSut({});
      await repo[mode]({ id: "t1", name: "x", parent: "scoped-other" });
      expect(neo4j.writeOne).toHaveBeenCalledTimes(1);
      await refused(repo[mode]({ id: "t1", name: "x", parent: "does-not-exist" }));
    });
  });

  it("create checks an immutable relationship, put skips it (mirrors the writer)", async () => {
    const created = buildSut();
    await refused(created.repo.create({ id: "t1", name: "x", locked: "scoped-other" }));

    const put = buildSut();
    await put.repo.put({ id: "t1", name: "x", locked: "scoped-other" });
    expect(put.read).not.toHaveBeenCalled();
    expect(put.neo4j.writeOne).toHaveBeenCalledTimes(1);
  });

  it("runs the check as one read query", async () => {
    const { repo, read } = buildSut();
    await repo.create({ id: "t1", name: "x", parent: "scoped-mine", tags: ["global-1"], shared: ["shared-mine"] });
    expect(read).toHaveBeenCalledTimes(1);
  });

  describe("addToRelationship", () => {
    it("refuses a foreign id with the 400 before writing", async () => {
      const { repo, neo4j } = buildSut();
      await expect(
        repo.addToRelationship({ id: "t1", relationship: "members", items: [{ id: "scoped-other" }] }),
      ).rejects.toThrow("One or more related nodes do not exist.");
      expect(neo4j.writeOne).not.toHaveBeenCalled();
    });

    it("links an own target", async () => {
      const { repo, neo4j } = buildSut();
      await repo.addToRelationship({ id: "t1", relationship: "members", items: [{ id: "scoped-mine" }] });
      expect(neo4j.writeOne).toHaveBeenCalledTimes(1);
    });

    it("can now link a global target: the target MATCH carries no company filter", async () => {
      const { repo, neo4j } = buildSut();
      await repo.addToRelationship({ id: "t1", relationship: "tags", items: [{ id: "global-1" }] });

      const query = neo4j.writeOne.mock.calls[0][0].query as string;
      expect(query).toContain("MATCH (related:ArcGlobal {id: item.id})\n");
      expect(query).not.toMatch(/MATCH \(related:ArcGlobal \{id: item\.id\}\)-\[:BELONGS_TO\]/);
      // the PARENT is still matched inside the caller's company
      expect(query).toContain("MATCH (parent:ArcThing {id: $parentId})-[:BELONGS_TO]->(company)");
    });

    it("links a platform row of an own-or-platform entity, refuses another company's", async () => {
      const { repo, neo4j } = buildSut();
      await repo.addToRelationship({ id: "t1", relationship: "shared", items: [{ id: "shared-platform" }] });
      expect(neo4j.writeOne).toHaveBeenCalledTimes(1);
      await refused(repo.addToRelationship({ id: "t1", relationship: "shared", items: [{ id: "shared-other" }] }));
    });
  });
});
