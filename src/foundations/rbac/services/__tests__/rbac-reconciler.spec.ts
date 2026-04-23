import { vi, describe, it, expect } from "vitest";
import { RbacReconcilerService } from "../rbac-reconciler.service";
import { perm } from "../../dsl/perm";
import type { RbacMatrix } from "../../dsl/types";
import { SystemRoles } from "../../../../common/constants/system.roles";

describe("RbacReconcilerService", () => {
  const ADMIN_ID: string = SystemRoles.Administrator;
  const WM_ID = "role-uuid-wm";
  const MOD_PART = "module-uuid-part";
  const MOD_WH = "module-uuid-wh";

  const matrix: RbacMatrix = {
    [MOD_PART]: {
      default: [perm.read],
      [ADMIN_ID]: perm.full, // will be SKIPPED (Administrator excluded from edges)
      [WM_ID]: [perm.create, perm.update("warehouse.managedBy")],
    },
    [MOD_WH]: {
      default: [],
      [ADMIN_ID]: perm.full,
      [WM_ID]: [perm.read],
    },
  };

  const createMockLogger = () => ({
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    logWithContext: vi.fn(),
    errorWithContext: vi.fn(),
    setRequestContext: vi.fn(),
    getRequestContext: vi.fn(),
    clearRequestContext: vi.fn(),
    createChildLogger: vi.fn(),
    logHttpRequest: vi.fn(),
    logHttpError: vi.fn(),
    logBusinessEvent: vi.fn(),
    logSecurityEvent: vi.fn(),
  });

  function makeNeo4j(initial: {
    moduleDefaults?: Record<string, string>;
    edges?: Array<{ roleId: string; moduleId: string; permissions: string }>;
    existingRoleIds?: string[];
    existingModuleIds?: string[];
  }) {
    const db = {
      moduleDefaults: { ...(initial.moduleDefaults ?? {}) } as Record<string, string>,
      edges: [...(initial.edges ?? [])],
      roles: new Set(initial.existingRoleIds ?? [ADMIN_ID, WM_ID]),
      modules: new Set(initial.existingModuleIds ?? [MOD_PART, MOD_WH]),
    };

    const service = {
      read: vi.fn().mockImplementation(async (query: string, params?: any) => {
        // Preflight existence-check queries: MATCH (n:Role)/(n:Module) WHERE n.id IN $ids
        if (query.includes("WHERE n.id IN $ids")) {
          const ids: string[] = params?.ids ?? [];
          const pool = query.includes("(n:Role)") ? db.roles : db.modules;
          return {
            records: ids
              .filter((id) => pool.has(id))
              .map((id) => ({
                get: (key: string) => (key === "id" ? id : null),
              })),
          };
        }

        // Read all module defaults
        if (query.includes("RETURN m.id AS id, m.permissions AS permissions")) {
          return {
            records: Array.from(db.modules).map((id) => ({
              get: (key: string) => (key === "id" ? id : (db.moduleDefaults[id] ?? null)),
            })),
          };
        }

        // Read all edges
        if (query.includes("HAS_PERMISSIONS")) {
          return {
            records: db.edges.map((e) => ({
              get: (key: string) =>
                (
                  ({
                    roleId: e.roleId,
                    moduleId: e.moduleId,
                    permissions: e.permissions,
                  }) as Record<string, string>
                )[key],
            })),
          };
        }

        return { records: [] };
      }),
      executeInTransaction: vi.fn().mockImplementation(async (queries: Array<{ query: string; params: any }>) => {
        for (const { query, params } of queries) {
          if (query.includes("SET m.permissions")) {
            db.moduleDefaults[params.moduleId] = params.permissions;
          } else if (query.includes("MERGE (role)-[permissions:HAS_PERMISSIONS]")) {
            const existing = db.edges.find((e) => e.roleId === params.roleId && e.moduleId === params.moduleId);
            if (existing) existing.permissions = params.permissions;
            else
              db.edges.push({
                roleId: params.roleId,
                moduleId: params.moduleId,
                permissions: params.permissions,
              });
          } else if (query.includes("DELETE p")) {
            db.edges = db.edges.filter((e) => !(e.roleId === params.roleId && e.moduleId === params.moduleId));
          }
        }
        return [];
      }),
    };

    return { db, service };
  }

  it("applies full matrix to empty DB, skipping Administrator edges", async () => {
    const { db, service } = makeNeo4j({});
    const logger = createMockLogger();
    const reconciler = new RbacReconcilerService(service as any, matrix, logger as any);

    await reconciler.onApplicationBootstrap();

    // Administrator edges NOT written
    expect(db.edges.find((e) => e.roleId === ADMIN_ID)).toBeUndefined();

    // Warehouse-Manager edges written for both modules
    expect(db.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ roleId: WM_ID, moduleId: MOD_PART }),
        expect.objectContaining({ roleId: WM_ID, moduleId: MOD_WH }),
      ]),
    );

    // Module defaults set
    expect(db.moduleDefaults[MOD_PART]).toBeDefined();
    const partDefaults = JSON.parse(db.moduleDefaults[MOD_PART]);
    expect(partDefaults[0]).toEqual({ type: "read", value: true });
  });

  it("deletes edges for declared modules that are no longer in the matrix", async () => {
    const { db, service } = makeNeo4j({
      edges: [
        {
          roleId: WM_ID,
          moduleId: MOD_PART,
          permissions: "{old}",
        },
        {
          roleId: "role-uuid-old",
          moduleId: MOD_PART,
          permissions: "{old}",
        }, // should be deleted
      ],
      existingRoleIds: [ADMIN_ID, WM_ID, "role-uuid-old"],
    });
    const logger = createMockLogger();
    const reconciler = new RbacReconcilerService(service as any, matrix, logger as any);

    await reconciler.onApplicationBootstrap();

    expect(db.edges.find((e) => e.roleId === "role-uuid-old")).toBeUndefined();
    expect(db.edges.find((e) => e.roleId === WM_ID && e.moduleId === MOD_PART)).toBeDefined();
  });

  it("is a no-op when DB matches matrix", async () => {
    const wmPartEdge = {
      roleId: WM_ID,
      moduleId: MOD_PART,
      permissions: JSON.stringify([
        { type: "read", value: true },
        { type: "create", value: true },
        { type: "update", value: "warehouse.managedBy" },
        { type: "delete", value: false },
      ]),
    };
    const wmWhEdge = {
      roleId: WM_ID,
      moduleId: MOD_WH,
      permissions: JSON.stringify([
        { type: "read", value: true },
        { type: "create", value: false },
        { type: "update", value: false },
        { type: "delete", value: false },
      ]),
    };
    const { service } = makeNeo4j({
      edges: [wmPartEdge, wmWhEdge],
      moduleDefaults: {
        [MOD_PART]: JSON.stringify([
          { type: "read", value: true },
          { type: "create", value: false },
          { type: "update", value: false },
          { type: "delete", value: false },
        ]),
        [MOD_WH]: JSON.stringify([
          { type: "read", value: false },
          { type: "create", value: false },
          { type: "update", value: false },
          { type: "delete", value: false },
        ]),
      },
    });
    const logger = createMockLogger();
    const reconciler = new RbacReconcilerService(service as any, matrix, logger as any);

    await reconciler.onApplicationBootstrap();

    expect(service.executeInTransaction).not.toHaveBeenCalled();
  });

  it("aborts with clear error when a referenced role or module does not exist in DB", async () => {
    const { service } = makeNeo4j({
      existingRoleIds: [ADMIN_ID], // Warehouse-Manager missing
    });
    const logger = createMockLogger();
    const reconciler = new RbacReconcilerService(service as any, matrix, logger as any);

    await expect(reconciler.onApplicationBootstrap()).rejects.toThrow(/Role.*missing/);
  });

  it("skips reconcile when no matrix is configured", async () => {
    const { service } = makeNeo4j({});
    const logger = createMockLogger();
    const reconciler = new RbacReconcilerService(service as any, null, logger as any);

    await reconciler.onApplicationBootstrap();

    expect(service.read).not.toHaveBeenCalled();
    expect(service.executeInTransaction).not.toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining("no matrix configured"));
  });
});
