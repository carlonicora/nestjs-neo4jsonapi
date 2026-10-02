import { readdirSync, readFileSync, statSync } from "fs";
import { dirname, join, relative, resolve } from "path";
import { describe, expect, it } from "vitest";

/**
 * relevancy, user and content import each other (RelevancyRepository needs
 * UserDescriptor, UserController needs RelevancyService and contentMeta,
 * ContentModule and UserModule import RelevancyModule). Importing one of them
 * through a barrel (`../../user`, `../relevancy`, `../../content`) pulls the
 * whole sibling folder in mid-evaluation, so loading e.g.
 * `relevancy.repository.ts` as the entry point threw
 * "Cannot access 'RelevancyRepository' before initialization" under a plain
 * CommonJS/ESM loader. Vitest's module runner does not surface the TDZ, so the
 * rule is pinned statically: no file in these folders may import one of these
 * three barrels.
 */
const foundationsRoot = resolve(__dirname, "../..");
const cycleGroup = ["relevancy", "user", "content"];
const barrels = new Set(cycleGroup.map((folder) => join(foundationsRoot, folder)));

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") && !path.endsWith(".spec.ts") ? [path] : [];
  });

describe("relevancy / user / content import graph", () => {
  const files = cycleGroup.flatMap((folder) => sourceFiles(join(foundationsRoot, folder)));

  it("scans the three folders", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((file) => [relative(foundationsRoot, file), file]))(
    "%s does not import the relevancy, user or content barrel",
    (_name, file) => {
      const specifiers = [...readFileSync(file, "utf8").matchAll(/from\s+"(\.[^"]*)"/g)].map((match) => match[1]);
      const barrelImports = specifiers.filter((specifier) => {
        const target = resolve(dirname(file), specifier).replace(/\/index$/, "");
        return barrels.has(target);
      });

      expect(barrelImports).toEqual([]);
    },
  );
});
