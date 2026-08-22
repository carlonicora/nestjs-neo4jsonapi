import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const NODES = join(__dirname, "..");

describe("contextualiser nodes return deltas, not accumulated state", () => {
  it.each([
    "keyconcepts.node.service.ts",
    "question.refiner.node.service.ts",
    "rational.node.service.ts",
    "atomicfacts.node.service.ts",
    "chunk.node.service.ts",
    "chunk.vector.node.service.ts",
  ])("%s never returns params.state", (file) => {
    const source = readFileSync(join(NODES, file), "utf8");
    expect(source).not.toMatch(/return\s+params\.state\s*;/);
  });
});
