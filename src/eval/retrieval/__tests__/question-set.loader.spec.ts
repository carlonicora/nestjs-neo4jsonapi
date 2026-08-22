import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { QuestionSetLoader } from "../question-set.loader";

const write = (body: string): string => {
  const file = join(mkdtempSync(join(tmpdir(), "qs-")), "questions.yaml");
  writeFileSync(file, body, "utf8");
  return file;
};

describe("QuestionSetLoader", () => {
  const loader = new QuestionSetLoader();

  it("loads a valid set", () => {
    const file = write(`
version: 1
product: a360ai
questions:
  - id: loc-01
    corpus: a360ai/P10
    question: Quali sono i termini di diffida ad adempiere?
    mustRetrieve:
      - "quindici (15) giorni"
    rubric: Must state the fifteen-day cure period.
`);
    const set = loader.load({ path: file });
    expect(set.product).toBe("a360ai");
    expect(set.questions).toHaveLength(1);
    expect(set.questions[0].mustRetrieve).toEqual(["quindici (15) giorni"]);
  });

  it("throws with the offending field when a question is malformed", () => {
    const file = write(`
version: 1
product: a360ai
questions:
  - id: loc-01
    corpus: a360ai/P10
    question: Missing its rubric
    mustRetrieve: []
`);
    expect(() => loader.load({ path: file })).toThrow(/rubric/);
  });

  it("throws when the file has no questions", () => {
    const file = write("version: 1\nproduct: a360ai\nquestions: []\n");
    expect(() => loader.load({ path: file })).toThrow();
  });
});
