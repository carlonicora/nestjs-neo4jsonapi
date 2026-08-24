import path from "path";
import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

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
    globals: true,
    environment: "node",
    include: ["src/**/*.spec.ts", "tools/**/*.spec.ts", "scripts/**/*.spec.ts"],
    silent: true,
    reporters: ["default"],
    onConsoleLog: () => false,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.spec.ts", "src/**/*.interface.ts", "src/**/*.dto.ts", "src/**/index.ts"],
    },
    testTimeout: 10000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
