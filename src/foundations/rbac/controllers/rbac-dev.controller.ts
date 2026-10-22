import { BadRequestException, Body, Controller, Get, Inject, Optional, Put, UseGuards } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";
import { RoleId } from "../../../common/constants/system.roles";
import { Roles } from "../../../common/decorators/roles.decorator";
import { AdminJwtAuthGuard } from "../../../common/guards/jwt.auth.admin.guard";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { RBAC_MATRIX_TOKEN } from "../rbac.tokens";
import { MODULE_USER_PATHS_TOKEN } from "../rbac.constants";
import type { PermToken, RbacMatrix } from "../dsl/types";
import { serializeMatrixToTs } from "../serializer/matrix-to-ts";

/**
 * Walk up from `startDir` looking for `pnpm-workspace.yaml`. Returns that
 * directory, or `startDir` as a fallback. Used to resolve relative
 * `outputPath` arguments from the frontend consistently regardless of where
 * the API process was started from (its `cwd` is `apps/api` in dev).
 */
function findMonorepoRoot(startDir: string): string {
  let current = startDir;
  while (true) {
    if (fs.existsSync(path.join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return startDir;
    current = parent;
  }
}

/**
 * Where the matrix file may be written: a `.ts` file inside the monorepo root,
 * never outside it. The path comes from the request body, so without this a
 * caller could overwrite any file the API process can write.
 */
export function resolveMatrixOutputPath(params: { outputPath: unknown; root: string }): string {
  if (typeof params.outputPath !== "string" || params.outputPath.trim() === "")
    throw new BadRequestException("outputPath is required");

  const root = path.resolve(params.root);
  const resolved = path.resolve(root, params.outputPath);
  const relative = path.relative(root, resolved);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative))
    throw new BadRequestException("outputPath must be inside the repository");
  if (path.extname(resolved) !== ".ts") throw new BadRequestException("outputPath must be a .ts file");

  return resolved;
}

/**
 * perm.* tokens are callable hybrids (function + attached `action`/`scope` own
 * properties). JSON.stringify drops functions, producing `null` inside arrays.
 * Normalise to plain `{ action, scope }` objects before envelope wrapping.
 */
function normaliseMatrix(matrix: RbacMatrix): RbacMatrix {
  const out: RbacMatrix = {};
  for (const [moduleId, block] of Object.entries(matrix)) {
    if (!block) continue;
    const newBlock: Record<string, PermToken[]> = { default: [] };
    for (const [key, tokens] of Object.entries(block)) {
      newBlock[key] = (tokens as PermToken[]).map((t) => ({ action: t.action, scope: t.scope }));
    }
    out[moduleId] = newBlock as RbacMatrix[string];
  }
  return out;
}

/**
 * JSON:API type emitted / expected by the dev RBAC matrix endpoints.
 * Kebab-case to match the rest of the codebase (e.g. "permission-mappings").
 */
const RBAC_MATRIX_TYPE = "rbac-matrix";
const RBAC_MATRIX_ID = "singleton";

interface RbacMatrixPutBody {
  data: {
    type: string;
    id?: string;
    attributes: {
      matrix: RbacMatrix;
      roleNames: Record<string, string>;
      moduleNames: Record<string, string>;
      outputPath: string; // absolute or relative to repo root
    };
  };
}

/**
 * Dev-only endpoints for editing the rbac matrix.
 *
 * Registered ONLY when `devMode` is enabled on RbacModule.register (see
 * `apps/api/src/features/features.modules.ts`).
 *
 * Both endpoints speak JSON:API (single-resource envelopes) so the frontend
 * can consume them via the standard `callApi()` pipeline instead of a
 * bespoke raw-fetch escape hatch.
 */
@Controller("_dev/rbac")
export class RbacDevController {
  constructor(
    @Optional() @Inject(RBAC_MATRIX_TOKEN) private readonly matrix: RbacMatrix | null,
    @Optional()
    @Inject(MODULE_USER_PATHS_TOKEN)
    private readonly moduleUserPaths: Record<string, readonly string[]> | null,
  ) {}

  @UseGuards(AdminJwtAuthGuard, JwtAuthGuard)
  @Get("matrix")
  @Roles(RoleId.Administrator)
  getMatrix() {
    return {
      data: {
        type: RBAC_MATRIX_TYPE,
        id: RBAC_MATRIX_ID,
        attributes: {
          matrix: this.matrix ? normaliseMatrix(this.matrix) : {},
          modulePaths: this.moduleUserPaths ?? {},
        },
      },
    };
  }

  @UseGuards(AdminJwtAuthGuard, JwtAuthGuard)
  @Put("matrix")
  @Roles(RoleId.Administrator)
  async putMatrix(@Body() body: RbacMatrixPutBody) {
    const attributes = body?.data?.attributes;
    if (!attributes) {
      throw new Error("Invalid JSON:API body: missing data.attributes");
    }

    const { matrix, roleNames, moduleNames, outputPath } = attributes;

    const source = await serializeMatrixToTs(matrix, {
      roleNames,
      moduleNames,
    });

    const outPath = resolveMatrixOutputPath({ outputPath, root: findMonorepoRoot(process.cwd()) });

    fs.writeFileSync(outPath, source);

    return {
      data: {
        type: RBAC_MATRIX_TYPE,
        id: RBAC_MATRIX_ID,
        attributes: {
          bytesWritten: Buffer.byteLength(source),
          path: outPath,
        },
      },
    };
  }
}
