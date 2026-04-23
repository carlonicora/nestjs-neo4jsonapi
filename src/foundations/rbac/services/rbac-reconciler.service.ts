import { Inject, Injectable, Optional, OnApplicationBootstrap } from "@nestjs/common";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { SystemRoles } from "../../../common/constants/system.roles";
import { RBAC_MATRIX_TOKEN } from "../rbac.tokens";
import type { RbacMatrix } from "../dsl/types";
import { iterateDeclaredEdges, iterateDeclaredModules, resolveDefault, resolveForRole } from "../dsl/resolver";

const ADMINISTRATOR_ID: string = SystemRoles.Administrator;

type ReconcileOperation =
  | { kind: "setDefault"; params: { moduleId: string; permissions: string } }
  | { kind: "upsertEdge"; params: { roleId: string; moduleId: string; permissions: string } }
  | { kind: "deleteEdge"; params: { roleId: string; moduleId: string } };

interface ActualState {
  moduleDefaults: Record<string, string | null>;
  edges: Array<{ roleId: string; moduleId: string; permissions: string }>;
}

/**
 * Applies the declared `RbacMatrix` to Neo4j at application bootstrap.
 *
 * Behaviour (per spec §6.3):
 *  - Administrator role is never written as an HAS_PERMISSIONS edge — the
 *    security layer short-circuits for it.
 *  - Module defaults are stored on `Module.permissions`.
 *  - Role-specific permissions are stored on `(Role)-[:HAS_PERMISSIONS]->(Module)`.
 *  - Deletions are scoped to modules declared in the matrix: edges for
 *    undeclared modules are left untouched.
 *  - Preflight aborts with a clear error if any referenced role or module is
 *    missing from the DB (seed migrations must run first).
 */
@Injectable()
export class RbacReconcilerService implements OnApplicationBootstrap {
  constructor(
    private readonly neo4j: Neo4jService,
    @Optional() @Inject(RBAC_MATRIX_TOKEN) private readonly matrix: RbacMatrix | null,
    private readonly logger: AppLoggingService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.matrix) {
      this.logger.log("RBAC reconciler: no matrix configured, skipping");
      return;
    }

    await this.preflight();

    const actual = await this.readActualState();
    const diff = this.computeDiff(actual);

    if (diff.operations.length === 0) {
      this.logger.log("RBAC reconcile: no changes");
      return;
    }

    await this.apply(diff.operations);
    this.logger.log(
      `RBAC reconcile: ${diff.defaultsChanged} defaults changed, ${diff.edgesUpserted} edges upserted, ${diff.edgesRemoved} edges removed`,
    );
  }

  private async preflight(): Promise<void> {
    const moduleIds = new Set<string>();
    const roleIds = new Set<string>();

    for (const moduleId of iterateDeclaredModules(this.matrix!)) {
      moduleIds.add(moduleId);
    }
    for (const { roleId } of iterateDeclaredEdges(this.matrix!)) {
      if (roleId === ADMINISTRATOR_ID) continue;
      roleIds.add(roleId);
    }

    const missingRoles = await this.findMissing("Role", Array.from(roleIds));
    const missingModules = await this.findMissing("Module", Array.from(moduleIds));

    if (missingRoles.length > 0 || missingModules.length > 0) {
      throw new Error(
        `RBAC reconcile aborted - referenced entities not found in DB. ` +
          `Roles missing: ${missingRoles.join(", ") || "none"}. ` +
          `Modules missing: ${missingModules.join(", ") || "none"}. ` +
          `Apply seed migrations before declaring these in the matrix.`,
      );
    }
  }

  private async findMissing(label: "Role" | "Module", ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const result = await this.neo4j.read(`MATCH (n:${label}) WHERE n.id IN $ids RETURN n.id AS id`, { ids });
    const found = new Set<string>(result.records.map((r: any) => r.get("id") as string));
    return ids.filter((id) => !found.has(id));
  }

  private async readActualState(): Promise<ActualState> {
    const modulesResult = await this.neo4j.read(`MATCH (m:Module) RETURN m.id AS id, m.permissions AS permissions`, {});
    const edgesResult = await this.neo4j.read(
      `MATCH (r:Role)-[p:HAS_PERMISSIONS]->(m:Module) RETURN r.id AS roleId, m.id AS moduleId, p.permissions AS permissions`,
      {},
    );

    const moduleDefaults: Record<string, string | null> = {};
    for (const rec of modulesResult.records) {
      moduleDefaults[rec.get("id") as string] = rec.get("permissions") as string | null;
    }
    const edges: Array<{ roleId: string; moduleId: string; permissions: string }> = [];
    for (const rec of edgesResult.records) {
      edges.push({
        roleId: rec.get("roleId") as string,
        moduleId: rec.get("moduleId") as string,
        permissions: rec.get("permissions") as string,
      });
    }
    return { moduleDefaults, edges };
  }

  private computeDiff(actual: ActualState): {
    operations: ReconcileOperation[];
    defaultsChanged: number;
    edgesUpserted: number;
    edgesRemoved: number;
  } {
    const operations: ReconcileOperation[] = [];
    let defaultsChanged = 0;
    let edgesUpserted = 0;
    let edgesRemoved = 0;

    const declaredModules = new Set<string>(Array.from(iterateDeclaredModules(this.matrix!)));
    const sortedModules = Array.from(declaredModules).sort();

    // Defaults
    for (const moduleId of sortedModules) {
      const expected = resolveDefault(this.matrix!, moduleId);
      if (expected === undefined) continue;
      if (actual.moduleDefaults[moduleId] !== expected) {
        operations.push({ kind: "setDefault", params: { moduleId, permissions: expected } });
        defaultsChanged++;
      }
    }

    // Edges — expected (Administrator excluded)
    const expectedEdgeKeys = new Set<string>();
    const sortedEdges = Array.from(iterateDeclaredEdges(this.matrix!))
      .filter((e) => e.roleId !== ADMINISTRATOR_ID)
      .sort((a, b) => (a.moduleId + a.roleId).localeCompare(b.moduleId + b.roleId));

    const actualByKey = new Map<string, string>();
    for (const edge of actual.edges) {
      actualByKey.set(`${edge.roleId}|${edge.moduleId}`, edge.permissions);
    }

    for (const { roleId, moduleId } of sortedEdges) {
      const expected = resolveForRole(this.matrix!, roleId, moduleId);
      if (expected === undefined) continue;
      const key = `${roleId}|${moduleId}`;
      expectedEdgeKeys.add(key);
      if (actualByKey.get(key) !== expected) {
        operations.push({
          kind: "upsertEdge",
          params: { roleId, moduleId, permissions: expected },
        });
        edgesUpserted++;
      }
    }

    // Edges — to delete (scoped to declared modules only; Administrator never managed)
    for (const edge of actual.edges) {
      if (!declaredModules.has(edge.moduleId)) continue;
      if (edge.roleId === ADMINISTRATOR_ID) continue;
      const key = `${edge.roleId}|${edge.moduleId}`;
      if (!expectedEdgeKeys.has(key)) {
        operations.push({
          kind: "deleteEdge",
          params: { roleId: edge.roleId, moduleId: edge.moduleId },
        });
        edgesRemoved++;
      }
    }

    return { operations, defaultsChanged, edgesUpserted, edgesRemoved };
  }

  private async apply(operations: ReconcileOperation[]): Promise<void> {
    const queries = operations.map((op) => {
      if (op.kind === "setDefault") {
        return {
          query: `MATCH (m:Module {id: $moduleId}) SET m.permissions = $permissions`,
          params: op.params,
        };
      }
      if (op.kind === "upsertEdge") {
        return {
          query:
            `MATCH (role:Role {id: $roleId}) ` +
            `MATCH (module:Module {id: $moduleId}) ` +
            `MERGE (role)-[permissions:HAS_PERMISSIONS]->(module) ` +
            `ON CREATE SET permissions.permissions = $permissions ` +
            `ON MATCH SET permissions.permissions = $permissions`,
          params: op.params,
        };
      }
      // deleteEdge
      return {
        query: `MATCH (role:Role {id: $roleId})-[p:HAS_PERMISSIONS]->(module:Module {id: $moduleId}) DELETE p`,
        params: op.params,
      };
    });

    await this.neo4j.executeInTransaction(queries);
  }
}
