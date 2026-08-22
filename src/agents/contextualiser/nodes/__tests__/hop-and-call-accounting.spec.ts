import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const NODES = join(__dirname, "..");
const ALL = [
  "question.refiner.node.service.ts",
  "rational.node.service.ts",
  "keyconcepts.node.service.ts",
  "atomicfacts.node.service.ts",
  "chunk.node.service.ts",
  "chunk.vector.node.service.ts",
];

describe("hop and call accounting", () => {
  it.each(ALL)("%s never mutates state.hops", (file) => {
    const source = readFileSync(join(NODES, file), "utf8");
    expect(source).not.toMatch(/params\.state\.hops\s*\+=/);
  });

  it.each(ALL)("%s reports llmCalls", (file) => {
    const source = readFileSync(join(NODES, file), "utf8");
    expect(source).toMatch(/llmCalls\s*:/);
  });

  it.each(["keyconcepts.node.service.ts", "atomicfacts.node.service.ts", "chunk.node.service.ts"])(
    "%s no longer carries its own hop brake",
    (file) => {
      const source = readFileSync(join(NODES, file), "utf8");
      expect(source).not.toMatch(/hops\s*>=\s*15/);
    },
  );

  // The per-chunk fan-outs run ungated again: LLM_FANOUT_CONCURRENCY turned one
  // wide wave into ~7 sequential ones at a median of ~25 chunks, and
  // allSettledKeepingSuccesses already provides the failure tolerance the gate
  // was reached for.
  it.each(["chunk.node.service.ts", "chunk.vector.node.service.ts"])(
    "%s no longer gates its fan-out on LLM_FANOUT_CONCURRENCY",
    (file) => {
      const source = readFileSync(join(NODES, file), "utf8");
      expect(source).not.toContain("LLM_FANOUT_CONCURRENCY");
    },
  );

  it.each(["chunk.node.service.ts", "chunk.vector.node.service.ts"])("%s no longer uses runWithConcurrency", (file) => {
    const source = readFileSync(join(NODES, file), "utf8");
    expect(source).not.toContain("runWithConcurrency");
  });
});
