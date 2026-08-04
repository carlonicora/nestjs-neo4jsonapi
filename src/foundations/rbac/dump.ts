import * as fs from "fs";
import * as path from "path";
import type { Driver } from "neo4j-driver";
import type { Action, PermToken, RbacMatrix } from "./dsl/types";
import { serializeMatrixToTs } from "./serializer/matrix-to-ts";

/**
 * Options for {@link dumpRbacMatrix}.
 */
export interface DumpRbacMatrixOptions {
  /**
   * A connected `neo4j-driver` Driver. The function opens a single session
   * and closes it on exit, but does NOT close the driver — the caller owns
   * the driver lifecycle.
   */
  driver: Driver;

  /**
   * Optional database name. If omitted, the driver's default database is
   * used. Pass this when your deployment uses a non-default database
   * (e.g. `process.env.NEO4J_DATABASE`).
   */
  database?: string;

  /**
   * UUID → PascalCase name map for roles. The serializer emits
   * `RoleId.<Name>` references using these names; without them, the
   * generated file contains raw UUIDs.
   *
   * Typical construction from a `RoleId` enum:
   * ```ts
   * Object.fromEntries(Object.entries(RoleId).map(([k, v]) => [v, k]))
   * ```
   */
  roleNames: Record<string, string>;

  /**
   * UUID → PascalCase name map for modules. Same shape and purpose as
   * `roleNames`, applied to `ModuleId.<Name>` references in the output.
   */
  moduleNames: Record<string, string>;

  /**
   * UUID of the Administrator role. The dump writes
   * `[RoleId.Administrator]: perm.full` for every declared module so the
   * file matches the convention enforced by `RbacReconcilerService`
   * (which deliberately skips Administrator edges — Admin is hardwired in
   * code, not represented as `HAS_PERMISSIONS` edges in the DB).
   */
  administratorRoleId: string;

  /**
   * Output path for the emitted TypeScript file. Absolute, or relative to
   * `process.cwd()`. Parent directories are created if missing.
   *
   * Convention: place the file under your API app's `src/rbac/` directory
   * (e.g. `"src/rbac/permissions.ts"` when running from the api package
   * cwd, or `"apps/api/src/rbac/permissions.ts"` from the monorepo root).
   */
  outputPath: string;

  /**
   * Import lines emitted verbatim, in order, at the head of the generated
   * file. Supply these when your app's `RoleId` / `ModuleId` / module-paths
   * map do not live where the package default expects them — otherwise the
   * dump is not re-runnable, because a re-run would overwrite a hand-fixed
   * header with imports that do not resolve in your app.
   *
   * Omit to keep the default header
   * ({@link DEFAULT_IMPORT_LINES} in `serializer/matrix-to-ts`), which is the
   * neural-erp convention and stays byte-identical.
   *
   * ```ts
   * importLines: [
   *   `import { RoleId } from "../config/enums/role.id";`,
   *   `import { ModuleId } from "@your-org/shared";`,
   *   `import { perm, defineRbac } from "@carlonicora/nestjs-neo4jsonapi";`,
   *   `import { MODULE_USER_PATHS } from "../features/rbac/module-relationships.map";`,
   * ]
   * ```
   */
  importLines?: string[];
}

/**
 * Result of {@link dumpRbacMatrix}.
 */
export interface DumpRbacMatrixResult {
  /** Number of bytes written to the output file. */
  bytesWritten: number;
  /** Resolved absolute path that was written. */
  path: string;
}

/**
 * Read the current RBAC state from Neo4j and emit a declarative-matrix
 * `permissions.ts` source file for the consuming app to commit.
 *
 * **Developer-only.** This is meant to run as a one-shot CLI step when
 * bootstrapping a new project (or re-dumping after manual DB edits during
 * development). Do not expose this from a runtime endpoint — production
 * servers should never write source files.
 *
 * By default the emitted file imports `RoleId` / `ModuleId` from
 * `@neural-erp/shared`, and `perm` / `defineRbac` from
 * `@carlonicora/nestjs-neo4jsonapi`. Apps whose enums live elsewhere MUST
 * pass {@link DumpRbacMatrixOptions.importLines} reproducing their own
 * header, otherwise re-running the dump overwrites a hand-fixed header with
 * imports that do not resolve — i.e. the dump is a one-shot instead of a
 * repeatable command.
 *
 * **Import this function from the `/foundations/rbac` subpath, NOT from the
 * package root barrel.** Loading the root barrel pulls in the whole package
 * graph, which corrupts the TypeScript parser bundled with `prettier` (the
 * serialiser formats its output with it) and makes the dump fail — a
 * session-verified defect from the Wave 1 foundation migration. Note the
 * `exports` map currently exposes subpaths via the `./foundations/*`
 * wildcard (`./dist/foundations/*.js`), so the form that resolves today is
 * `@carlonicora/nestjs-neo4jsonapi/foundations/rbac/index`; the bare
 * `.../foundations/rbac` needs an explicit `"./foundations/rbac"` export
 * entry.
 *
 * @example
 * ```ts
 * // apps/api/scripts/rbac-dump.ts
 * import * as dotenv from "dotenv";
 * import * as path from "path";
 * dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
 *
 * import neo4j from "neo4j-driver";
 * import { RoleId, ModuleId } from "@neural-erp/shared";
 * // Subpath import — the package ROOT barrel breaks prettier's bundled
 * // TypeScript parser (see the note above).
 * import { dumpRbacMatrix } from "@carlonicora/nestjs-neo4jsonapi/foundations/rbac/index";
 *
 * async function main() {
 *   const driver = neo4j.driver(
 *     process.env.NEO4J_URI!,
 *     neo4j.auth.basic(process.env.NEO4J_USER!, process.env.NEO4J_PASSWORD!),
 *   );
 *   try {
 *     const result = await dumpRbacMatrix({
 *       driver,
 *       database: process.env.NEO4J_DATABASE,
 *       roleNames: Object.fromEntries(
 *         Object.entries(RoleId).map(([k, v]) => [v, k]),
 *       ),
 *       moduleNames: Object.fromEntries(
 *         Object.entries(ModuleId).map(([k, v]) => [v, k]),
 *       ),
 *       administratorRoleId: RoleId.Administrator,
 *       outputPath: path.resolve(__dirname, "../src/rbac/permissions.ts"),
 *       // Reproduce YOUR app's header verbatim so the dump is re-runnable.
 *       importLines: [
 *         `import { RoleId, ModuleId } from "@neural-erp/shared";`,
 *         `import { perm, defineRbac } from "@carlonicora/nestjs-neo4jsonapi";`,
 *         `import { MODULE_USER_PATHS } from "../features/rbac/module-relationships.map";`,
 *       ],
 *     });
 *     console.log(`Wrote ${result.bytesWritten} bytes to ${result.path}`);
 *   } finally {
 *     await driver.close();
 *   }
 * }
 *
 * main().catch((err) => {
 *   console.error(err);
 *   process.exit(1);
 * });
 * ```
 */
export async function dumpRbacMatrix(opts: DumpRbacMatrixOptions): Promise<DumpRbacMatrixResult> {
  const session = opts.driver.session(opts.database ? { database: opts.database } : undefined);
  try {
    const modulesResult = await session.run(`MATCH (m:Module) RETURN m.id AS id, m.permissions AS permissions`);
    const edgesResult = await session.run(
      `MATCH (r:Role)-[p:HAS_PERMISSIONS]->(m:Module) RETURN r.id AS roleId, m.id AS moduleId, p.permissions AS permissions`,
    );

    const matrix: RbacMatrix = {};

    for (const rec of modulesResult.records) {
      const moduleId = rec.get("id");
      const permissions: string | null = rec.get("permissions");
      if (!moduleId) continue;
      matrix[moduleId] = { default: deserialize(permissions), ...(matrix[moduleId] ?? {}) };
    }

    for (const rec of edgesResult.records) {
      const roleId = rec.get("roleId");
      const moduleId = rec.get("moduleId");
      const permissions: string | null = rec.get("permissions");
      if (!matrix[moduleId]) matrix[moduleId] = { default: [] };
      matrix[moduleId]![roleId] = deltaFromDefault(deserialize(permissions), matrix[moduleId]!.default);
    }

    // Administrator gets perm.full on every declared module — matches the
    // reconciler's "Administrator edges are never managed" convention.
    for (const moduleId of Object.keys(matrix)) {
      matrix[moduleId]![opts.administratorRoleId] = [
        { action: "read", scope: true },
        { action: "create", scope: true },
        { action: "update", scope: true },
        { action: "delete", scope: true },
      ];
    }

    const source = await serializeMatrixToTs(matrix, {
      roleNames: opts.roleNames,
      moduleNames: opts.moduleNames,
      ...(opts.importLines ? { importLines: opts.importLines } : {}),
    });

    const outPath = path.isAbsolute(opts.outputPath) ? opts.outputPath : path.resolve(process.cwd(), opts.outputPath);

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, source);

    return { bytesWritten: Buffer.byteLength(source), path: outPath };
  } finally {
    await session.close();
  }
}

function deserialize(raw: string | null): PermToken[] {
  if (!raw) return [];
  const arr = JSON.parse(raw) as Array<{ type: string; value: boolean | string }>;
  return arr
    .filter((e) => e.value !== false)
    .map((e) => ({
      action: e.type as Action,
      scope: e.value === true ? true : (e.value as string),
    }));
}

function deltaFromDefault(effective: PermToken[], defaults: PermToken[]): PermToken[] {
  // Naive shallow comparison — sufficient because tokens are flat
  // {action, scope} records.
  return effective.filter((e) => !defaults.some((d) => d.action === e.action && d.scope === e.scope));
}
