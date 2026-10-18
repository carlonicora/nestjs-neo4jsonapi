import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Spec lists for the vitest projects, computed when the config loads by
// scanning spec sources for a pattern. Never keep these lists by hand.
//
// isolatedSpecs() walks `roots` under `cwd` (skipping node_modules, dist* and
// .next*), keeps the files whose cwd-relative path matches `suffix` and whose
// source matches `pattern`, and returns them cwd-relative, posix and sorted.
//
// The default pattern, ISOLATION_PATTERN, finds the specs that must not share
// a module registry or a global object with other files: a spec that swaps or
// resets the registry (vi.mock / vi.doMock / vi.resetModules), patches a global
// (vi.stubGlobal) or registers into a global registry (modelRegistry.register,
// ModuleRegistry.register, setBootstrapper) leaks into every other file that
// shares its worker. Those specs run in the `isolated` project
// (isolate:true) instead.
//
// LOCATION_STUB_PATTERN finds the specs that replace `window.location`. A config
// passes it as `pattern` to run those specs in a forks pool (see below).
//
// This file is byte-identical in every app of every nja project. Change it in
// one place and copy it everywhere.
// ---------------------------------------------------------------------------
export const ISOLATION_PATTERN =
  /\bvi\.(mock|doMock|stubGlobal|resetModules)\(|\b(modelRegistry|ModuleRegistry)\.register\(|\bsetBootstrapper\(/;

// The vmThreads/vmForks pools host jsdom inside a node:vm context, where
// `window.location` is non-configurable: `Object.defineProperty(window,
// "location", ...)` throws "Cannot redefine property: location". Specs that
// stub location that way must run in the forks or threads pool.
export const LOCATION_STUB_PATTERN = /\bdefineProperty\(\s*(window|globalThis|global)\s*,\s*["']location["']/;

const SKIPPED_DIRECTORY = /^(node_modules|dist.*|\.next.*)$/;

export function isolatedSpecs(params: { cwd: string; roots: string[]; suffix: RegExp; pattern?: RegExp }): string[] {
  const pattern = params.pattern ?? ISOLATION_PATTERN;
  const found = new Set<string>();

  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORY.test(entry.name)) walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const relative = path.relative(params.cwd, absolute).split(path.sep).join("/");
      if (!params.suffix.test(relative)) continue;
      if (pattern.test(readFileSync(absolute, "utf8"))) found.add(relative);
    }
  };

  for (const root of params.roots) {
    const absoluteRoot = path.resolve(params.cwd, root);
    if (existsSync(absoluteRoot)) walk(absoluteRoot);
  }

  return [...found].sort();
}
