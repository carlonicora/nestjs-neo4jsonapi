import { describe, expect, it, vi } from "vitest";
import type { Mocked } from "vitest";
import { Neo4jService } from "../../../../core/neo4j/services/neo4j.service";
import { AppLoggingService } from "../../../../core/logging/services/logging.service";
import { RbacReconcilerService } from "../rbac-reconciler.service";
import { perm } from "../../dsl/perm";
import type { RbacMatrix } from "../../dsl/types";
import { SystemRoles } from "../../../../common/constants/system.roles";

const ADMIN_ID: string = SystemRoles.Administrator;
const EDITOR_ID = "role-uuid-editor";
const MOD_A = "module-uuid-a";

const matrix: RbacMatrix = {
  [MOD_A]: {
    default: [perm.read],
    [ADMIN_ID]: perm.full,
    [EDITOR_ID]: [perm.create],
  },
};

type MockNeo4j = Mocked<Pick<Neo4jService, "read" | "executeInTransaction">>;
type MockLogger = Mocked<Pick<AppLoggingService, "log" | "error" | "warn" | "debug">>;

const createMockLogger = (): MockLogger => ({ log: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() });

// The reconciler only calls the picked methods; the doubles stand in for the full services.
const asNeo4j = (mock: MockNeo4j): Neo4jService => mock as unknown as Neo4jService;
const asLogger = (mock: MockLogger): AppLoggingService => mock as unknown as AppLoggingService;

/** In-memory Neo4j double, same query matching as rbac-reconciler.spec.ts. */
function makeNeo4j(initialEdges: Array<{ roleId: string; moduleId: string; permissions: string }> = []): {
  db: {
    moduleDefaults: Record<string, string>;
    edges: Array<{ roleId: string; moduleId: string; permissions: string }>;
    roles: Set<string>;
    modules: Set<string>;
  };
  service: MockNeo4j;
} {
  const db = {
    moduleDefaults: {} as Record<string, string>,
    edges: [...initialEdges],
    roles: new Set([ADMIN_ID, EDITOR_ID]),
    modules: new Set([MOD_A]),
  };

  const service = {
    read: vi.fn().mockImplementation(async (query: string, params?: any) => {
      if (query.includes("WHERE n.id IN $ids")) {
        const ids: string[] = params?.ids ?? [];
        const pool = query.includes("(n:Role)") ? db.roles : db.modules;
        return {
          records: ids.filter((id) => pool.has(id)).map((id) => ({ get: (key: string) => (key === "id" ? id : null) })),
        };
      }
      if (query.includes("RETURN m.id AS id, m.permissions AS permissions")) {
        return {
          records: Array.from(db.modules).map((id) => ({
            get: (key: string) => (key === "id" ? id : (db.moduleDefaults[id] ?? null)),
          })),
        };
      }
      if (query.includes("HAS_PERMISSIONS")) {
        return {
          records: db.edges.map((e) => ({ get: (key: string) => (e as Record<string, string>)[key] })),
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
          else db.edges.push({ roleId: params.roleId, moduleId: params.moduleId, permissions: params.permissions });
        } else if (query.includes("DELETE p")) {
          db.edges = db.edges.filter((e) => !(e.roleId === params.roleId && e.moduleId === params.moduleId));
        }
      }
      return [];
    }),
  };

  return { db, service };
}

describe("RbacReconcilerService — Administrator edges and permissions.enforce", () => {
  it("enforce on → Administrator edges upserted from the matrix", async () => {
    const { db, service } = makeNeo4j();
    const reconciler = new RbacReconcilerService(asNeo4j(service), matrix, asLogger(createMockLogger()), true);

    await reconciler.onApplicationBootstrap();

    const adminEdge = db.edges.find((e) => e.roleId === ADMIN_ID && e.moduleId === MOD_A);
    expect(adminEdge).toBeDefined();
    const perms = JSON.parse(adminEdge!.permissions) as Array<{ type: string; value: unknown }>;
    for (const type of ["read", "create", "update", "delete"]) {
      expect(perms.find((p) => p.type === type)?.value).toBe(true);
    }
    expect(db.edges.find((e) => e.roleId === EDITOR_ID)).toBeDefined();
  });

  it("enforce on → a stale Administrator edge on a declared module is replaced", async () => {
    const { db, service } = makeNeo4j([{ roleId: ADMIN_ID, moduleId: MOD_A, permissions: "{old}" }]);
    const reconciler = new RbacReconcilerService(asNeo4j(service), matrix, asLogger(createMockLogger()), true);

    await reconciler.onApplicationBootstrap();

    const adminEdge = db.edges.find((e) => e.roleId === ADMIN_ID && e.moduleId === MOD_A);
    expect(adminEdge?.permissions).not.toBe("{old}");
  });

  it("enforce off → Administrator still skipped", async () => {
    for (const enforce of [false, undefined]) {
      const { db, service } = makeNeo4j([{ roleId: ADMIN_ID, moduleId: MOD_A, permissions: "{manual}" }]);
      const reconciler = new RbacReconcilerService(asNeo4j(service), matrix, asLogger(createMockLogger()), enforce);

      await reconciler.onApplicationBootstrap();

      // Neither rewritten nor deleted: existing behaviour.
      expect(db.edges.find((e) => e.roleId === ADMIN_ID)?.permissions).toBe("{manual}");
      expect(db.edges.find((e) => e.roleId === EDITOR_ID)).toBeDefined();
    }
  });
});
