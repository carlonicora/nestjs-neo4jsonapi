import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const NODES = join(__dirname, "..");

describe("contextualiser fan-outs are failure-tolerant", () => {
  // Only `atomic_facts` still fans out. Block 3c deleted the per-chunk LLM call
  // in BOTH chunk nodes, so there is no longer a fan-out there to be tolerant
  // of — asserting those files still mention `allSettledKeepingSuccesses` would
  // test a mechanism that no longer exists.
  it.each(["atomicfacts.node.service.ts"])("%s uses no bare Promise.all over an LLM fan-out", (file) => {
    const source = readFileSync(join(NODES, file), "utf8");
    expect(source).not.toMatch(/Promise\.all\(\s*[\w.]+\.map\(/);
    expect(source).toContain("allSettledKeepingSuccesses");
  });

  // The guard that still matters for the chunk nodes: they must make NO
  // provider call at all. A reintroduced fan-out would be a regression of 3c.
  it.each(["chunk.node.service.ts", "chunk.vector.node.service.ts"])("%s makes no LLM call at all", (file) => {
    const source = readFileSync(join(NODES, file), "utf8");
    expect(source).not.toMatch(/llmService\.call/);
    expect(source).not.toMatch(/Promise\.all\(\s*[\w.]+\.map\(/);
  });
});
