import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mocked } from "vitest";
import type { ClsService } from "nestjs-cls";
import type { Neo4jService } from "../../../../core/neo4j/services/neo4j.service";
import { RbacPermissionRepository } from "../../repositories/rbac-permission.repository";
import { ModulePermissionService } from "../module-permission.service";

const USER_ID = "user-1";
const COMPANY_ID = "company-1";
const MODULE_ID = "module-1";

function moduleRecord(id: string, perms: Array<{ type: string; value: unknown }>) {
  return {
    get: (key: string) => (key === "module" ? { properties: { id, permissions: JSON.stringify(perms) } } : null),
  };
}

function makeCls(active = true) {
  const store = new Map<string, unknown>();
  return {
    isActive: vi.fn(() => active),
    get: vi.fn((key: string) => store.get(key)),
    set: vi.fn((key: string, value: unknown) => {
      store.set(key, value);
    }),
  } as unknown as Mocked<ClsService>;
}

describe("ModulePermissionService", () => {
  let neo4j: Mocked<Pick<Neo4jService, "read">>;
  let cls: Mocked<ClsService>;
  let service: ModulePermissionService;

  beforeEach(() => {
    neo4j = { read: vi.fn() } as Mocked<Pick<Neo4jService, "read">>;
    neo4j.read.mockResolvedValue({
      records: [
        moduleRecord(MODULE_ID, [
          { type: "read", value: true },
          { type: "create", value: false },
          { type: "update", value: "id" },
          { type: "delete", value: null },
        ]),
      ],
    });
    cls = makeCls();
    service = new ModulePermissionService(new RbacPermissionRepository(neo4j as unknown as Neo4jService), cls);
  });

  it("resolves the token company only", async () => {
    await service.resolve({ userId: USER_ID, companyId: COMPANY_ID });

    expect(neo4j.read).toHaveBeenCalledTimes(1);
    const [query, params] = neo4j.read.mock.calls[0];
    expect(params).toEqual({ userId: USER_ID, companyId: COMPANY_ID });
    expect(query).toContain("MATCH (company:Company {id: $companyId})");
    expect(query).toContain("[:IN_COMPANY]->(company)");
    expect(query).not.toContain("BELONGS_TO");
  });

  it("uses the platform path when companyId is undefined", async () => {
    await service.resolve({ userId: USER_ID, companyId: undefined });

    const [query, params] = neo4j.read.mock.calls[0];
    expect(query).toContain("NOT (am_ms)-[:IN_COMPANY]");
    expect(query).not.toContain("BELONGS_TO");
    expect(params).toEqual({ searchValue: USER_ID });
  });

  it("a string value allows", async () => {
    await expect(
      service.allows({ userId: USER_ID, companyId: COMPANY_ID, moduleId: MODULE_ID, action: "update" }),
    ).resolves.toBe(true);
    await expect(
      service.allows({ userId: USER_ID, companyId: COMPANY_ID, moduleId: MODULE_ID, action: "read" }),
    ).resolves.toBe(true);
  });

  it("false and absent refuse", async () => {
    await expect(
      service.allows({ userId: USER_ID, companyId: COMPANY_ID, moduleId: MODULE_ID, action: "create" }),
    ).resolves.toBe(false);
    await expect(
      service.allows({ userId: USER_ID, companyId: COMPANY_ID, moduleId: MODULE_ID, action: "delete" }),
    ).resolves.toBe(false);
    await expect(
      service.allows({ userId: USER_ID, companyId: COMPANY_ID, moduleId: "unknown-module", action: "read" }),
    ).resolves.toBe(false);
  });

  it("resolves once per request", async () => {
    await service.allows({ userId: USER_ID, companyId: COMPANY_ID, moduleId: MODULE_ID, action: "read" });
    await service.allows({ userId: USER_ID, companyId: COMPANY_ID, moduleId: MODULE_ID, action: "update" });

    expect(neo4j.read).toHaveBeenCalledTimes(1);
    expect(cls.set).toHaveBeenCalledWith("effectivePermissions", expect.anything());
  });

  it("re-resolves when the cached entry belongs to another company", async () => {
    await service.resolve({ userId: USER_ID, companyId: COMPANY_ID });
    await service.resolve({ userId: USER_ID, companyId: "company-2" });

    expect(neo4j.read).toHaveBeenCalledTimes(2);
  });

  it("works without an active CLS context (no caching)", async () => {
    cls = makeCls(false);
    service = new ModulePermissionService(new RbacPermissionRepository(neo4j as unknown as Neo4jService), cls);

    await service.resolve({ userId: USER_ID, companyId: COMPANY_ID });
    await service.resolve({ userId: USER_ID, companyId: COMPANY_ID });

    expect(neo4j.read).toHaveBeenCalledTimes(2);
    expect(cls.set).not.toHaveBeenCalled();
  });
});
