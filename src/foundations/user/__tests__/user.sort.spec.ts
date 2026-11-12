import { BadRequestException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserController } from "../controllers/user.controller";
import { UserRepository } from "../repositories/user.repository";
import { UserService } from "../services/user.service";

/**
 * Column sorting on the library user lists (spec rows A8, A9, A12, A13, A16):
 * the controllers forward `sort`, the service validates it against the descriptor
 * (`name`, `email` are sortable) and the repository orders through the validated
 * clause, with `user.id ASC` as the last key.
 */

const HOSTILE = "name) DETACH DELETE n //";

function createNeo4j() {
  return {
    initQuery: vi.fn(() => ({ query: "", queryParams: {} as Record<string, any> })),
    readMany: vi.fn().mockResolvedValue([]),
    readOne: vi.fn().mockResolvedValue(null),
  };
}

function createRepository(neo4j = createNeo4j()) {
  const userCypherService = {
    default: vi.fn(() => "MATCH (user:User)"),
    returnStatement: vi.fn(() => "RETURN user"),
  };
  const repository = new UserRepository(neo4j as any, {} as any, { get: vi.fn() } as any, userCypherService as any);
  return { repository, neo4j };
}

function lastQuery(neo4j: ReturnType<typeof createNeo4j>): string {
  return neo4j.readMany.mock.calls[neo4j.readMany.mock.calls.length - 1][0].query as string;
}

describe("UserController sort", () => {
  let users: Record<string, ReturnType<typeof vi.fn>>;
  let controller: UserController;
  const reply = { send: vi.fn() } as any;

  beforeEach(() => {
    users = {
      findMany: vi.fn().mockResolvedValue({}),
      findByContentIds: vi.fn().mockResolvedValue({}),
      findManyByCompany: vi.fn().mockResolvedValue({}),
      findInRole: vi.fn().mockResolvedValue({}),
    };
    const security = { isUserInRoles: vi.fn().mockReturnValue(true) };
    const relevancyService = { findRelevantUsers: vi.fn().mockResolvedValue({}) };
    controller = new UserController(
      users as any,
      security as any,
      {} as any,
      {} as any,
      { set: vi.fn() } as any,
      relevancyService as any,
      {} as any,
    );
    (controller as any).relevancyServiceMock = relevancyService;
  });

  it("forwards sort on the user list", async () => {
    await controller.findBySearch({ user: {} } as any, reply, {}, undefined, undefined, undefined, "-name");
    expect(users.findMany).toHaveBeenCalledWith(expect.objectContaining({ sort: "-name" }));
  });

  it("forwards sort on the contentIds branch", async () => {
    await controller.findBySearch({ user: {} } as any, reply, {}, undefined, undefined, "c1,c2", "email");
    expect(users.findByContentIds).toHaveBeenCalledWith(expect.objectContaining({ sort: "email" }));
  });

  it("forwards sort on the company users list", async () => {
    await controller.findByCompany(
      { user: { companyId: "co" } } as any,
      reply,
      "co",
      {},
      undefined,
      undefined,
      undefined,
      "name",
    );
    expect(users.findManyByCompany).toHaveBeenCalledWith(expect.objectContaining({ sort: "name" }));
  });

  it("forwards sort on the role users list", async () => {
    await controller.findUserByRole({ user: {} } as any, {}, "role-1", undefined, undefined, "-email");
    expect(users.findInRole).toHaveBeenCalledWith(expect.objectContaining({ sort: "-email" }));
  });

  it("forwards sort on the relevant users list", async () => {
    await controller.findContentsRelevantForContent({}, "content-1", "name");
    expect((controller as any).relevancyServiceMock.findRelevantUsers).toHaveBeenCalledWith(
      expect.objectContaining({ sort: "name" }),
    );
  });
});

describe("UserService sort", () => {
  let repository: Record<string, ReturnType<typeof vi.fn>>;
  let service: UserService;

  beforeEach(() => {
    repository = {
      findMany: vi.fn().mockResolvedValue([]),
      findManyByContentIds: vi.fn().mockResolvedValue([]),
      findManyByCompany: vi.fn().mockResolvedValue([]),
      findInRole: vi.fn().mockResolvedValue([]),
    };
    const jsonApiService = { buildList: vi.fn().mockResolvedValue({ data: [] }) };
    service = new UserService(
      jsonApiService as any,
      repository as any,
      {} as any,
      {} as any,
      { get: vi.fn() } as any,
      {} as any,
    );
  });

  it.each([
    ["findMany", "findMany", { query: {}, isAdmin: true }],
    ["findByContentIds", "findManyByContentIds", { query: {}, contentIds: ["c1"] }],
    ["findManyByCompany", "findManyByCompany", { query: {}, companyId: "co" }],
    ["findInRole", "findInRole", { query: {}, roleId: "r", term: undefined, isAdmin: true }],
  ])("%s passes the validated sort to the repository", async (method, repoMethod, params) => {
    await (service as any)[method]({ ...params, sort: "-name,email" });
    expect(repository[repoMethod].mock.calls[0][0].orderByFields).toEqual([
      { field: "name", direction: "desc" },
      { field: "email", direction: "asc" },
    ]);
  });

  it.each(["findMany", "findByContentIds", "findManyByCompany", "findInRole"])(
    "%s refuses a hostile or unsortable sort with a 400 before any query",
    async (method) => {
      for (const sort of [HOSTILE, "password", "phone", "name,name"]) {
        await expect((service as any)[method]({ query: {}, contentIds: [], companyId: "co", sort })).rejects.toThrow(
          BadRequestException,
        );
      }
      for (const fn of Object.values(repository)) expect(fn).not.toHaveBeenCalled();
    },
  );
});

describe("UserRepository sort", () => {
  it("findMany orders by the requested sort, then the id, before {CURSOR}", async () => {
    const { repository, neo4j } = createRepository();
    await repository.findMany({ orderByFields: [{ field: "email", direction: "desc" }] });
    const query = lastQuery(neo4j);
    expect(query).toContain(
      "ORDER BY CASE WHEN user.email IS :: STRING THEN toLower(user.email) ELSE user.email END DESC, user.id ASC",
    );
    expect(query.indexOf("{CURSOR}")).toBeGreaterThan(
      query.indexOf("ORDER BY CASE WHEN user.email IS :: STRING THEN toLower(user.email) ELSE user.email END DESC"),
    );
  });

  it("findMany keeps name ASC as its default", async () => {
    const { repository, neo4j } = createRepository();
    await repository.findMany({});
    expect(lastQuery(neo4j)).toContain("ORDER BY user.name ASC, user.id ASC");
  });

  it("findMany with a search term puts the sort before the score (call C7)", async () => {
    const { repository, neo4j } = createRepository();
    (repository as any).descriptor = { ...(repository as any).descriptor, fulltextIndexName: "user_search" };
    await repository.findMany({ term: "ann", orderByFields: [{ field: "name", direction: "asc" }] });
    expect(lastQuery(neo4j)).toContain(
      "ORDER BY CASE WHEN user.name IS :: STRING THEN toLower(user.name) ELSE user.name END ASC, score DESC, user.id ASC",
    );
  });

  it("findMany with a search term and no sort keeps the score order", async () => {
    const { repository, neo4j } = createRepository();
    (repository as any).descriptor = { ...(repository as any).descriptor, fulltextIndexName: "user_search" };
    await repository.findMany({ term: "ann" });
    expect(lastQuery(neo4j)).toContain("ORDER BY score DESC, user.id ASC");
  });

  it("findManyByContentIds orders by the requested sort", async () => {
    const { repository, neo4j } = createRepository();
    await repository.findManyByContentIds({
      contentIds: ["c1"],
      orderByFields: [{ field: "name", direction: "desc" }],
    });
    const query = lastQuery(neo4j);
    expect(query).toContain(
      "ORDER BY CASE WHEN user.name IS :: STRING THEN toLower(user.name) ELSE user.name END DESC, user.id ASC",
    );
    expect(query.indexOf("{CURSOR}")).toBeGreaterThan(query.indexOf("ORDER BY"));
  });

  it("findManyByCompany orders its rows (it had no ORDER BY)", async () => {
    const { repository, neo4j } = createRepository();
    await repository.findManyByCompany({ companyId: "co", orderByFields: [{ field: "email", direction: "asc" }] });
    expect(lastQuery(neo4j)).toContain(
      "ORDER BY CASE WHEN user.email IS :: STRING THEN toLower(user.email) ELSE user.email END ASC, user.id ASC",
    );
  });

  it("findManyByCompany defaults to name ASC", async () => {
    const { repository, neo4j } = createRepository();
    await repository.findManyByCompany({ companyId: "co" });
    expect(lastQuery(neo4j)).toContain("ORDER BY user.name ASC, user.id ASC");
  });

  it("findInRole orders by the requested sort before {CURSOR}", async () => {
    const { repository, neo4j } = createRepository();
    await repository.findInRole({
      roleId: "r",
      cursor: {} as any,
      orderByFields: [{ field: "email", direction: "desc" }],
    });
    const query = lastQuery(neo4j);
    expect(query).toContain(
      "ORDER BY CASE WHEN user.email IS :: STRING THEN toLower(user.email) ELSE user.email END DESC, user.id ASC",
    );
    expect(query.indexOf("{CURSOR}")).toBeGreaterThan(
      query.indexOf("ORDER BY CASE WHEN user.email IS :: STRING THEN toLower(user.email) ELSE user.email END DESC"),
    );
  });
});
