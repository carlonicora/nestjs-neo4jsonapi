import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { detectSharedScope } from "../utils/scope-detector";

describe("detectSharedScope", () => {
  it("prefers an explicit override", () => {
    expect(detectSharedScope({ override: "@override/shared", cwd: os.tmpdir() })).toBe("@override/shared");
  });

  it("falls back when nothing is found", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "scope-empty-"));
    try {
      expect(detectSharedScope({ cwd: empty, fallback: "@fallback/shared" })).toBe("@fallback/shared");
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it("reads the bare @scope/shared alias from a JSONC tsconfig.base.json (comments + trailing commas)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scope-tsconfig-"));
    try {
      // Deliberately JSONC: line comment + trailing comma, which plain JSON.parse rejects.
      fs.writeFileSync(
        path.join(dir, "tsconfig.base.json"),
        `{
  "compilerOptions": {
    // path aliases
    "paths": {
      "@dreamer/shared": ["x"],
      "@dreamer/shared/*": ["x/*"],
    },
  },
}`,
      );
      expect(detectSharedScope({ cwd: dir })).toBe("@dreamer/shared");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to a @scope/shared dependency in root package.json", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scope-pkg-"));
    try {
      fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ dependencies: { "@acme/shared": "workspace:*" } }));
      expect(detectSharedScope({ cwd: dir })).toBe("@acme/shared");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
