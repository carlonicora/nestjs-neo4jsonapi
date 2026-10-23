import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mocked } from "vitest";
import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { ClsService } from "nestjs-cls";
import { ModuleACL } from "../../../../common/decorators/module.decorator";
import { SystemRoles } from "../../../../common/constants/system.roles";
import type { Neo4jService } from "../../../../core/neo4j/services/neo4j.service";
import { RbacPermissionRepository } from "../../repositories/rbac-permission.repository";
import { ModulePermissionGate } from "../module-permission.gate";
import { ModulePermissionService } from "../module-permission.service";

const USER_ID = "user-1";
const COMPANY_ID = "company-1";
const SECTION = "section-campaign";
const OTHER_SECTION = "section-other";

@ModuleACL({ module: SECTION })
class SectionedController {
  list() {}
  create() {}
  @ModuleACL({ module: SECTION, action: "read" })
  search() {}
  @ModuleACL({ module: OTHER_SECTION })
  elsewhere() {}
}

class UnsectionedController {
  list() {}
  create() {}
}

function makeContext(params: { controller: any; handler: string; method: string; user?: any }): {
  context: ExecutionContext;
  request: any;
} {
  const request = { method: params.method, user: params.user ?? { userId: USER_ID, roles: [] } };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => params.controller.prototype[params.handler],
    getClass: () => params.controller,
  } as unknown as ExecutionContext;
  return { context, request };
}

function moduleRecord(id: string, perms: Record<string, unknown>) {
  const list = Object.entries(perms).map(([type, value]) => ({ type, value }));
  return {
    get: (key: string) => (key === "module" ? { properties: { id, permissions: JSON.stringify(list) } } : null),
  };
}

describe("ModulePermissionGate", () => {
  let neo4j: Mocked<Pick<Neo4jService, "read">>;
  let cls: Mocked<ClsService>;

  const buildGate = (enforce: boolean | undefined) => {
    const service = new ModulePermissionService(new RbacPermissionRepository(neo4j as unknown as Neo4jService), cls);
    return new ModulePermissionGate(new Reflector(), cls, service, enforce);
  };

  beforeEach(() => {
    neo4j = { read: vi.fn() } as Mocked<Pick<Neo4jService, "read">>;
    neo4j.read.mockResolvedValue({
      records: [
        moduleRecord(SECTION, { read: true, create: false, update: false, delete: false }),
        moduleRecord(OTHER_SECTION, { read: true, create: true, update: true, delete: true }),
      ],
    });
    const store = new Map<string, unknown>([["companyId", COMPANY_ID]]);
    cls = {
      isActive: vi.fn(() => true),
      get: vi.fn((key: string) => store.get(key)),
      set: vi.fn((key: string, value: unknown) => store.set(key, value)),
    } as unknown as Mocked<ClsService>;
  });

  it("enforce off → never queries", async () => {
    for (const enforce of [false, undefined]) {
      const gate = buildGate(enforce);
      const { context, request } = makeContext({ controller: SectionedController, handler: "create", method: "POST" });
      await expect(gate.assert({ request, context })).resolves.toBeUndefined();
    }
    expect(neo4j.read).not.toHaveBeenCalled();
  });

  it("GET with no section → allowed", async () => {
    const gate = buildGate(true);
    const { context, request } = makeContext({ controller: UnsectionedController, handler: "list", method: "GET" });

    await expect(gate.assert({ request, context })).resolves.toBeUndefined();
    expect(neo4j.read).not.toHaveBeenCalled();
  });

  it("write with no section → defensive 403", async () => {
    const gate = buildGate(true);
    const { context, request } = makeContext({ controller: UnsectionedController, handler: "create", method: "POST" });

    await expect(gate.assert({ request, context })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("GET on a section with read true → allowed, resolved in the token company", async () => {
    const gate = buildGate(true);
    const { context, request } = makeContext({ controller: SectionedController, handler: "list", method: "GET" });

    await expect(gate.assert({ request, context })).resolves.toBeUndefined();
    expect(neo4j.read.mock.calls[0][1]).toEqual({ userId: USER_ID, companyId: COMPANY_ID });
  });

  it("POST on a section with create false → ForbiddenException with status 403", async () => {
    const gate = buildGate(true);
    const { context, request } = makeContext({ controller: SectionedController, handler: "create", method: "POST" });

    const error = await gate.assert({ request, context }).catch((e) => e);
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getStatus()).toBe(403);
  });

  it("@ModuleACL action override read on a POST → checked as read", async () => {
    const gate = buildGate(true);
    const { context, request } = makeContext({ controller: SectionedController, handler: "search", method: "POST" });

    await expect(gate.assert({ request, context })).resolves.toBeUndefined();
  });

  it("handler @ModuleACL overrides class section", async () => {
    const gate = buildGate(true);
    const { context, request } = makeContext({
      controller: SectionedController,
      handler: "elsewhere",
      method: "DELETE",
    });

    // OTHER_SECTION grants delete; the class section (SECTION) would refuse it.
    await expect(gate.assert({ request, context })).resolves.toBeUndefined();
  });

  it("Administrator role with no grant → 403 (no bypass)", async () => {
    const gate = buildGate(true);
    const { context, request } = makeContext({
      controller: SectionedController,
      handler: "create",
      method: "POST",
      user: { userId: USER_ID, roles: [SystemRoles.Administrator] },
    });

    await expect(gate.assert({ request, context })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("no authenticated user → nothing evaluated", async () => {
    const gate = buildGate(true);
    const { context, request } = makeContext({ controller: SectionedController, handler: "create", method: "POST" });
    request.user = undefined;

    await expect(gate.assert({ request, context })).resolves.toBeUndefined();
    expect(neo4j.read).not.toHaveBeenCalled();
  });
});
