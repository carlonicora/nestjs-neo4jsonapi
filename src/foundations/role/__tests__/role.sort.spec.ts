import { BadRequestException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RoleController } from "../controllers/role.controller";
import { RoleUserController } from "../controllers/role.user.controller";
import { RoleRepository } from "../repositories/role.repository";
import { RoleService } from "../services/role.service";

/**
 * Column sorting on the library role lists (spec rows A25, A26): name, description.
 * RoleRepository has no descriptor-driven base class, so the service validates against an allow-list.
 */

describe("Role controllers sort", () => {
  it("RoleController.find forwards sort", async () => {
    const service = { find: vi.fn().mockResolvedValue({}) };
    const controller = new RoleController(service as any, {} as any, {} as any);
    await controller.find({}, undefined, "-name");
    expect(service.find).toHaveBeenCalledWith(expect.objectContaining({ sort: "-name" }));
  });

  it("RoleUserController.findBySearch forwards sort", async () => {
    const service = { findForUser: vi.fn().mockResolvedValue({}), findNotInUser: vi.fn() };
    const controller = new RoleUserController(service as any, {} as any);
    await controller.findBySearch({}, {}, "user-1", undefined, undefined, "description");
    expect(service.findForUser).toHaveBeenCalledWith(expect.objectContaining({ sort: "description" }));
  });
});

describe("RoleService sort", () => {
  let repository: { find: ReturnType<typeof vi.fn>; findForUser: ReturnType<typeof vi.fn> };
  let service: RoleService;

  beforeEach(() => {
    repository = { find: vi.fn().mockResolvedValue([]), findForUser: vi.fn().mockResolvedValue([]) };
    service = new RoleService({ buildList: vi.fn().mockResolvedValue({ data: [] }) } as any, repository as any);
  });

  it("find passes the validated sort to the repository", async () => {
    await service.find({ query: {}, sort: "-description,name" });
    expect(repository.find.mock.calls[0][0].orderByFields).toEqual([
      { field: "description", direction: "desc" },
      { field: "name", direction: "asc" },
    ]);
  });

  it("findForUser passes the validated sort to the repository", async () => {
    await service.findForUser({ userId: "u", term: undefined as any, query: {}, sort: "name" });
    expect(repository.findForUser.mock.calls[0][0].orderByFields).toEqual([{ field: "name", direction: "asc" }]);
  });

  it("refuses a hostile or unknown sort with a 400 before any query", async () => {
    for (const sort of ["name) DETACH DELETE n //", "isSelectable", "id"]) {
      await expect(service.find({ query: {}, sort })).rejects.toThrow(BadRequestException);
      await expect(service.findForUser({ userId: "u", term: undefined as any, query: {}, sort })).rejects.toThrow(
        BadRequestException,
      );
    }
    expect(repository.find).not.toHaveBeenCalled();
    expect(repository.findForUser).not.toHaveBeenCalled();
  });
});

describe("RoleRepository sort", () => {
  function setup() {
    const neo4j = {
      initQuery: vi.fn(() => ({ query: "", queryParams: {} as Record<string, any> })),
      readMany: vi.fn().mockResolvedValue([]),
    };
    return {
      repository: new RoleRepository(neo4j as any),
      query: () => neo4j.readMany.mock.calls[0][0].query as string,
    };
  }

  it("find orders by the requested sort, then the id, before {CURSOR}", async () => {
    const { repository, query } = setup();
    await repository.find({ cursor: {} as any, orderByFields: [{ field: "description", direction: "desc" }] });
    expect(query()).toContain(
      "ORDER BY CASE WHEN role.description IS :: STRING THEN toLower(role.description) ELSE role.description END DESC, role.id ASC",
    );
    expect(query().indexOf("{CURSOR}")).toBeGreaterThan(query().indexOf("ORDER BY"));
  });

  it("find keeps name ASC as its default", async () => {
    const { repository, query } = setup();
    await repository.find({ cursor: {} as any });
    expect(query()).toContain("ORDER BY role.name ASC, role.id ASC");
  });

  it("findForUser orders by the requested sort before {CURSOR}", async () => {
    const { repository, query } = setup();
    await repository.findForUser({
      userId: "u",
      cursor: {} as any,
      orderByFields: [{ field: "name", direction: "desc" }],
    });
    expect(query()).toContain(
      "ORDER BY CASE WHEN role.name IS :: STRING THEN toLower(role.name) ELSE role.name END DESC, role.id ASC",
    );
    expect(query().indexOf("{CURSOR}")).toBeGreaterThan(query().indexOf("ORDER BY"));
  });
});
