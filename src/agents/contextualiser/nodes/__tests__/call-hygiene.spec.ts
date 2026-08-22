import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const NODES = join(__dirname, "..");

describe("contextualiser call hygiene", () => {
  it.each([
    ["rational.node.service.ts", "rational_plan"],
    ["question.refiner.node.service.ts", "question_refiner"],
    ["atomicfacts.node.service.ts", "atomic_facts"],
    ["keyconcepts.node.service.ts", "key_concepts"],
  ])("%s names itself in call metadata", (file, nodeName) => {
    const source = readFileSync(join(NODES, file), "utf8");
    expect(source).toMatch(/agentName:\s*"contextualiser"/);
    expect(source).toMatch(new RegExp(`nodeName:\\s*"${nodeName}"`));
  });
});
