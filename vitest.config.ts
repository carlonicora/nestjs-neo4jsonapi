import path from "path";
import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";
import { isolatedSpecs } from "./vitest.isolation";

// ---------------------------------------------------------------------------
// Speed: the suite runs isolate:false so each worker imports the NestJS DI
// graph and the package barrels ONCE and reuses them across files, instead of
// paying a cold per-file import (import was 87% of suite time with per-file
// isolation).
//
// Safety: with a shared module registry, any spec that calls `vi.mock()`
// replaces that module for every OTHER file in the worker, and a later file
// importing the real module silently gets the mock. So every spec that swaps
// the registry or a global runs in a separate `isolated` project
// (isolate:true, fresh registry per file). The rule and the scan live in
// vitest.isolation.ts; the list is computed when this config loads.
// The shuffle guard (sequence.shuffle) makes a missed leak fail loudly.
// ---------------------------------------------------------------------------
const ISOLATED_SPECS = isolatedSpecs({ cwd: __dirname, roots: ["src", "tools", "scripts"], suffix: /\.spec\.tsx?$/ });

// Settings shared by both projects (swc plugin + resolve alias are inherited
// from the root config via `extends: true`).
const sharedTest = {
  globals: true,
  environment: "node" as const,
  pool: "threads" as const,
  // Reset env/global stubs between tests so nothing bleeds across files in a
  // shared (isolate:false) worker.
  unstubEnvs: true,
  unstubGlobals: true,
  // Randomise file order so any future cross-file leak fails loudly instead of
  // hiding behind a lucky ordering. Tests inside a file keep their written
  // order: the assistant and assistant-message integration specs build one
  // in-memory store across ordered steps, and chunk.service.spec.ts registers
  // into modelRegistry in one test, so shuffling tests within a file breaks
  // them even when run alone. isolate:false does not change in-file order.
  sequence: { shuffle: { files: true, tests: false } },
};

export default defineConfig({
  // Vite now transforms TypeScript with Oxc, which does NOT implement
  // `emitDecoratorMetadata` — and it ran AFTER unplugin-swc, overwriting SWC's
  // `design:paramtypes` with a same-length array of `undefined`s. Anything
  // reading constructor types through `Reflect.getMetadata` (Nest's own DI, and
  // `conditional-service.decorator`'s `resolveInjectionTokens`) then saw
  // undefined tokens. `esbuild: false`, which unplugin-swc sets for us, no
  // longer covers this — Vite warns as much on startup — so Oxc has to be
  // turned off explicitly for SWC to remain the only TypeScript transform.
  oxc: false,
  plugins: [
    swc.vite({
      jsc: {
        parser: {
          syntax: "typescript",
          decorators: true,
        },
        transform: {
          legacyDecorator: true,
          decoratorMetadata: true,
        },
      },
    }),
  ],
  test: {
    silent: true,
    // default output unchanged; the slow-test list is appended (report only).
    reporters: ["default", "./vitest.slow-tests.reporter.ts"],
    onConsoleLog: () => false,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.spec.ts", "src/**/*.interface.ts", "src/**/*.dto.ts", "src/**/index.ts"],
    },
    testTimeout: 10000,
    projects: [
      {
        extends: true,
        test: {
          ...sharedTest,
          name: "fast",
          isolate: false,
          include: ["src/**/*.spec.ts", "tools/**/*.spec.ts", "scripts/**/*.spec.ts"],
          exclude: ["node_modules", "dist", ...ISOLATED_SPECS],
        },
      },
      {
        extends: true,
        test: {
          ...sharedTest,
          name: "isolated",
          isolate: true,
          include: ISOLATED_SPECS,
          exclude: ["node_modules", "dist"],
        },
      },
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
