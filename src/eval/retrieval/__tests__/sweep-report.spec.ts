import { describe, it, expect } from "vitest";
import { renderSweepReport } from "../sweep-report";
import { EndToEndSweepResult, SweepSummary } from "../retrieval-eval.types";

const summary: SweepSummary<EndToEndSweepResult> = {
  product: "a360ai",
  mode: "end-to-end",
  model: "gpt-5.6-luna",
  startedAt: "2026-08-21T10:00:00.000Z",
  results: [
    {
      questionId: "loc-01",
      evidenceRetrieved: 2,
      missingSnippets: [],
      evidenceCited: 2,
      uncitedSnippets: [],
      chunksRead: 8,
      retrievalMs: 0,
      answerMs: 9000,
      inputTokens: 21500,
      outputTokens: 3100,
      verdict: { passed: true, explanation: "States the cure period." },
      tokenAccounting: {
        ledgerInput: 21500,
        observedInput: 21500,
        ledgerOutput: 3100,
        observedOutput: 3100,
        agrees: true,
        checked: true,
      },
      evidenceRead: 2,
      chunksKept: 3,
      chunksKeptCore: 1,
      readObserved: true,
    },
    {
      questionId: "lav-02",
      evidenceRetrieved: 1,
      missingSnippets: ["art. 7 L. 300/1970"],
      evidenceCited: 0,
      uncitedSnippets: ["art. 7 L. 300/1970"],
      chunksRead: 8,
      retrievalMs: 0,
      answerMs: 11000,
      inputTokens: 24000,
      outputTokens: 2800,
      verdict: {
        passed: false,
        failureMode: "evidence-not-retrieved",
        explanation: "Never surfaced art. 7.",
      },
      tokenAccounting: {
        ledgerInput: 24000,
        observedInput: 24000,
        ledgerOutput: 2800,
        observedOutput: 2800,
        agrees: true,
        checked: true,
      },
      evidenceRead: 0,
      chunksKept: 2,
      chunksKeptCore: 0,
      readObserved: true,
    },
  ],
};

describe("renderSweepReport", () => {
  it("leads with the pass rate and lists failures with their mode", () => {
    const report = renderSweepReport(summary);
    expect(report).toContain("1/2");
    expect(report).toContain("gpt-5.6-luna");
    expect(report).toContain("lav-02");
    expect(report).toContain("evidence-not-retrieved");
  });

  it("flags a token-accounting mismatch prominently", () => {
    const broken: SweepSummary<EndToEndSweepResult> = {
      ...summary,
      results: [
        {
          ...summary.results[0],
          tokenAccounting: {
            ledgerInput: 113532,
            observedInput: 60914,
            ledgerOutput: 24268,
            observedOutput: 13459,
            agrees: false,
            checked: true,
          },
        },
      ],
    };
    expect(renderSweepReport(broken)).toContain("TOKEN ACCOUNTING MISMATCH");
  });
});
