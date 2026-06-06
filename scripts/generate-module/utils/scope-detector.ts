import * as fs from "fs";
import * as path from "path";

/**
 * Detect the host app's "shared" package import scope (e.g. `@dreamer/shared`).
 *
 * The generated module imports `ModuleId` from this package. The scope differs
 * per host app, so it must be resolved from the target repo rather than
 * hardcoded. Resolution order:
 *   1. explicit override (CLI `--shared-scope`)
 *   2. a `@<scope>/shared` key in `tsconfig.base.json` / `tsconfig.json` paths
 *   3. a `@<scope>/shared` entry in the root `package.json` dependencies
 *   4. the provided fallback
 */
export function detectSharedScope(params?: { cwd?: string; override?: string; fallback?: string }): string {
  const cwd = params?.cwd ?? process.cwd();
  const fallback = params?.fallback ?? "@app/shared";

  if (params?.override) return params.override;

  const fromTsconfig = findSharedInTsconfigPaths(cwd);
  if (fromTsconfig) return fromTsconfig;

  const fromPackageJson = findSharedInRootPackageJson(cwd);
  if (fromPackageJson) return fromPackageJson;

  return fallback;
}

function readJsonSafe(filePath: string): any | undefined {
  try {
    if (!fs.existsSync(filePath)) return undefined;
    // tsconfig files are JSONC (comments + trailing commas), so plain JSON.parse
    // throws on them. Strip comments/trailing commas before parsing.
    return JSON.parse(stripJsonc(fs.readFileSync(filePath, "utf-8")));
  } catch {
    return undefined;
  }
}

/**
 * Remove `//` line comments, block comments and trailing commas from a JSONC
 * string while preserving comment-like sequences inside string literals.
 */
function stripJsonc(input: string): string {
  let out = "";
  let inString = false;
  let inLine = false;
  let inBlock = false;

  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    const next = input[i + 1];

    if (inLine) {
      if (c === "\n") {
        inLine = false;
        out += c;
      }
      continue;
    }
    if (inBlock) {
      if (c === "*" && next === "/") {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += c;
      if (c === "\\") {
        out += next ?? "";
        i++;
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === "/" && next === "/") {
      inLine = true;
      i++;
      continue;
    }
    if (c === "/" && next === "*") {
      inBlock = true;
      i++;
      continue;
    }
    out += c;
  }

  // Drop trailing commas before } or ].
  return out.replace(/,(\s*[}\]])/g, "$1");
}

function findSharedInTsconfigPaths(cwd: string): string | undefined {
  for (const file of ["tsconfig.base.json", "tsconfig.json"]) {
    const json = readJsonSafe(path.resolve(cwd, file));
    const paths = json?.compilerOptions?.paths;
    if (!paths) continue;
    // Prefer the bare alias (e.g. "@dreamer/shared") over the glob ("@dreamer/shared/*").
    const key = Object.keys(paths).find((k) => /^@[^/]+\/shared$/.test(k));
    if (key) return key;
  }
  return undefined;
}

function findSharedInRootPackageJson(cwd: string): string | undefined {
  const json = readJsonSafe(path.resolve(cwd, "package.json"));
  if (!json) return undefined;
  const deps = { ...json.dependencies, ...json.devDependencies };
  const name = Object.keys(deps).find((k) => /^@[^/]+\/shared$/.test(k));
  return name;
}
