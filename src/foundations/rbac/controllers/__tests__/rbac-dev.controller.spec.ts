import { BadRequestException } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { RoleId } from "../../../../common/constants/system.roles";
import { AdminJwtAuthGuard } from "../../../../common/guards/jwt.auth.admin.guard";
import { JwtAuthGuard } from "../../../../common/guards/jwt.auth.guard";
import { RbacDevController, resolveMatrixOutputPath } from "../rbac-dev.controller";

describe("RbacDevController", () => {
  it.each(["getMatrix", "putMatrix"] as const)("%s is platform-Administrator only", (method) => {
    const handler = RbacDevController.prototype[method];
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([AdminJwtAuthGuard, JwtAuthGuard]);
    expect(Reflect.getMetadata("roles", handler)).toEqual([RoleId.Administrator]);
  });
});

describe("resolveMatrixOutputPath", () => {
  const root = path.resolve("/repo");

  it("resolves a relative .ts path inside the repository", () => {
    expect(resolveMatrixOutputPath({ outputPath: "apps/api/src/rbac/permissions.ts", root })).toBe(
      path.join(root, "apps/api/src/rbac/permissions.ts"),
    );
  });

  it("accepts an absolute path that lies inside the repository", () => {
    const inside = path.join(root, "apps/api/src/rbac/permissions.ts");
    expect(resolveMatrixOutputPath({ outputPath: inside, root })).toBe(inside);
  });

  it.each([
    ["an absolute path outside the repository", "/etc/cron.d/x.ts"],
    ["a traversal out of the repository", "../outside/x.ts"],
    ["a nested traversal", "apps/../../outside/x.ts"],
    ["the repository root itself", "."],
    ["a non-TypeScript file", "apps/api/.env"],
    ["a script", "apps/api/dist/main.js"],
    ["an empty path", ""],
    ["a missing path", undefined],
  ])("refuses %s", (_label, outputPath) => {
    expect(() => resolveMatrixOutputPath({ outputPath, root })).toThrow(BadRequestException);
  });
});
