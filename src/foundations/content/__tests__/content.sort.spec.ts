import { BadRequestException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContentController } from "../controllers/content.controller";
import { ContentRepository } from "../repositories/content.repository";
import { ContentService } from "../services/content.service";

vi.mock("../../../common/registries/registry", () => ({
  modelRegistry: { get: vi.fn(() => ({ nodeName: "content", type: "contents" })) },
}));

/**
 * Column sorting on the library content lists (spec rows A7, A10) and the fix of the
 * `?orderBy=` Cypher injection in ContentRepository.find / findByOwner (spec §8).
 */

const HOSTILE = "name) DETACH DELETE n //";

describe("ContentController sort", () => {
  let service: Record<string, ReturnType<typeof vi.fn>>;
  let relevancy: { findRelevant: ReturnType<typeof vi.fn> };
  let controller: ContentController;
  const reply = { send: vi.fn() } as any;

  beforeEach(() => {
    service = {
      find: vi.fn().mockResolvedValue({}),
      findByIds: vi.fn().mockResolvedValue({}),
      findByOwner: vi.fn().mockResolvedValue({}),
    };
    relevancy = { findRelevant: vi.fn().mockResolvedValue({}) };
    controller = new ContentController(service as any, relevancy as any, {} as any);
  });

  it("findContents forwards sort and still forwards the legacy orderBy (call C10)", async () => {
    await controller.findContents({} as any, reply, {}, undefined, undefined, "name DESC", undefined, "-name");
    expect(service.find).toHaveBeenCalledWith(expect.objectContaining({ sort: "-name", orderBy: "name DESC" }));
  });

  it("findContents forwards sort on the contentIds branch", async () => {
    await controller.findContents({} as any, reply, {}, undefined, undefined, undefined, "a,b", "name");
    expect(service.findByIds).toHaveBeenCalledWith({ contentIds: ["a", "b"], sort: "name" });
  });

  it("findByOwner and findByAuthor forward sort", async () => {
    await controller.findByOwner({} as any, reply, "o", {}, undefined, undefined, undefined, "name");
    await controller.findByAuthor({} as any, reply, "a", {}, undefined, undefined, undefined, "-name");
    expect(service.findByOwner.mock.calls[0][0].sort).toBe("name");
    expect(service.findByOwner.mock.calls[1][0].sort).toBe("-name");
  });

  it("the relevance list forwards sort", async () => {
    await controller.findContentsRelevantForContent({}, "c1", "name");
    expect(relevancy.findRelevant).toHaveBeenCalledWith(expect.objectContaining({ sort: "name" }));
  });
});

describe("ContentService sort", () => {
  let repository: Record<string, ReturnType<typeof vi.fn>>;
  let service: ContentService;

  beforeEach(() => {
    repository = {
      find: vi.fn().mockResolvedValue([]),
      findByIds: vi.fn().mockResolvedValue([]),
      findByOwner: vi.fn().mockResolvedValue([]),
    };
    service = new ContentService({ buildList: vi.fn().mockResolvedValue({ data: [] }) } as any, repository as any);
  });

  it("find turns sort into orderByFields and drops the legacy orderBy", async () => {
    await service.find({ query: {}, sort: "-name", orderBy: "createdAt" });
    expect(repository.find.mock.calls[0][0]).toMatchObject({
      orderByFields: [{ field: "name", direction: "desc" }],
      orderBy: undefined,
    });
  });

  it("find keeps the legacy orderBy when no sort is sent", async () => {
    await service.find({ query: {}, orderBy: "name DESC" });
    expect(repository.find.mock.calls[0][0]).toMatchObject({ orderBy: "name DESC", orderByFields: undefined });
  });

  it("findByIds and findByOwner pass the validated sort", async () => {
    await service.findByIds({ contentIds: ["a"], sort: "name" });
    await service.findByOwner({ ownerId: "o", query: {}, sort: "-updatedAt" });
    expect(repository.findByIds.mock.calls[0][0].orderByFields).toEqual([{ field: "name", direction: "asc" }]);
    expect(repository.findByOwner.mock.calls[0][0].orderByFields).toEqual([{ field: "updatedAt", direction: "desc" }]);
  });

  it("refuses a hostile or unknown sort with a 400 before any query", async () => {
    for (const sort of [HOSTILE, "tldr", "abstract"]) {
      await expect(service.find({ query: {}, sort })).rejects.toThrow(BadRequestException);
      await expect(service.findByIds({ contentIds: ["a"], sort })).rejects.toThrow(BadRequestException);
      await expect(service.findByOwner({ ownerId: "o", query: {}, sort })).rejects.toThrow(BadRequestException);
    }
    for (const fn of Object.values(repository)) expect(fn).not.toHaveBeenCalled();
  });
});

describe("ContentRepository order", () => {
  function setup() {
    const neo4j = {
      initQuery: vi.fn(() => ({ query: "", queryParams: {} as Record<string, any> })),
      readMany: vi.fn().mockResolvedValue([]),
    };
    const cypher = {
      default: vi.fn(() => "MATCH (content:Article)"),
      userHasAccess: vi.fn(() => "WITH content"),
      returnStatement: vi.fn(() => "RETURN content"),
      tldrFilter: vi.fn(() => ""),
      ownerMatch: vi.fn(() => "MATCH (content)<-[:PUBLISHED]-(:User {id: $ownerId})"),
    };
    const security = { userHasAccess: vi.fn(({ validator }: any) => validator()) };
    const config = { get: vi.fn(() => ({ types: ["Article"] })) };
    const repository = new ContentRepository(neo4j as any, cypher as any, security as any, config as any);
    return { repository, neo4j, query: () => neo4j.readMany.mock.calls[0][0].query as string };
  }

  describe.each(["find", "findByOwner"] as const)("%s (spec §8 site)", (method) => {
    const call = (repository: ContentRepository, params: Record<string, any>) =>
      (repository as any)[method]({ ownerId: "o", cursor: {}, ...params });

    it("never puts a hostile legacy orderBy in the Cypher: 400 before any query", async () => {
      const { repository, neo4j } = setup();
      for (const orderBy of [HOSTILE, "name; MATCH (n) DETACH DELETE n", "name DESC, x"]) {
        await expect(call(repository, { orderBy })).rejects.toThrow(BadRequestException);
      }
      expect(neo4j.readMany).not.toHaveBeenCalled();
    });

    it("orders by the validated sort, then the id, before {CURSOR}", async () => {
      const { repository, query } = setup();
      await call(repository, { orderByFields: [{ field: "name", direction: "asc" }], orderBy: "createdAt" });
      expect(query()).toContain(
        "ORDER BY CASE WHEN content.name IS :: STRING THEN toLower(content.name) ELSE content.name END ASC, content.id ASC",
      );
      expect(query().indexOf("{CURSOR}")).toBeGreaterThan(query().indexOf("ORDER BY"));
    });

    it("keeps a valid legacy orderBy working (library backward compatibility)", async () => {
      const { repository, query } = setup();
      await call(repository, { orderBy: "name DESC" });
      expect(query()).toContain("ORDER BY content.name DESC, content.id ASC");
    });

    it("keeps updatedAt DESC as its default", async () => {
      const { repository, query } = setup();
      await call(repository, {});
      expect(query()).toContain("ORDER BY content.updatedAt DESC, content.id ASC");
    });
  });

  it("findByIds orders by the requested sort, else by updatedAt DESC, always ending with id", async () => {
    const sorted = setup();
    await sorted.repository.findByIds({ contentIds: ["a"], orderByFields: [{ field: "name", direction: "desc" }] });
    expect(sorted.query()).toContain(
      "ORDER BY CASE WHEN content.name IS :: STRING THEN toLower(content.name) ELSE content.name END DESC, content.id ASC",
    );

    const unsorted = setup();
    await unsorted.repository.findByIds({ contentIds: ["a"] });
    expect(unsorted.query()).toContain("ORDER BY content.updatedAt DESC, content.id ASC");
  });
});
