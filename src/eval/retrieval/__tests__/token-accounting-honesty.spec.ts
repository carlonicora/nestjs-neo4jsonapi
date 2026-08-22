import { describe, expect, it, vi } from "vitest";
import { EndToEndSweepService } from "../end-to-end-sweep.service";
import { EvidenceMatcher } from "../evidence.matcher";
import { EndToEndSweepResult, EvalQuestionSet, SweepSummary } from "../retrieval-eval.types";
import { renderSweepReport } from "../sweep-report";
import { TokenAccountingChecker } from "../token-accounting.check";

const set: EvalQuestionSet = {
  version: 1,
  product: "a360ai",
  questions: [
    { id: "q1", corpus: "a360ai/P10", question: "q", mustRetrieve: ["x"], rubric: "r" },
    { id: "q2", corpus: "a360ai/P10", question: "q", mustRetrieve: ["x"], rubric: "r" },
  ],
};

/**
 * The service reads the model name from config; the plan's snippet predates the
 * 5th constructor parameter, so every construction here passes it.
 */
const configService = { get: vi.fn().mockReturnValue({ ai: { model: "gpt-5.6-luna" } }) };

describe("token accounting on a failed question", () => {
  it("never reports agreement for a check that did not run", async () => {
    const responder = { run: vi.fn().mockRejectedValue(new Error("boom")) };
    const accounting = { check: vi.fn(), observe: vi.fn(), reset: vi.fn() };
    const service = new EndToEndSweepService(
      responder as any,
      { judge: vi.fn() } as any,
      new EvidenceMatcher(),
      accounting as any,
      configService as any,
    );

    const summary = await service.run({ set, companyId: "c", userId: "u" });

    expect(summary.results).toHaveLength(2);
    for (const result of summary.results) {
      expect(result.tokenAccounting.checked).toBe(false);
      expect(result.tokenAccounting.agrees).toBe(false);
    }
    expect(accounting.check).not.toHaveBeenCalled();
  });

  it("resets the accumulator between questions even when one fails", async () => {
    const responder = { run: vi.fn().mockRejectedValue(new Error("boom")) };
    const accounting = { check: vi.fn(), observe: vi.fn(), reset: vi.fn() };
    const service = new EndToEndSweepService(
      responder as any,
      { judge: vi.fn() } as any,
      new EvidenceMatcher(),
      accounting as any,
      configService as any,
    );

    await service.run({ set, companyId: "c", userId: "u" });

    // Two questions, both failed: the accumulator must be cleared each time or
    // question 2 inherits question 1's observed tokens.
    expect(accounting.reset).toHaveBeenCalledTimes(2);
  });

  it("marks a completed check as checked so the report can tell the two apart", () => {
    const checker = new TokenAccountingChecker();
    checker.observe({ input: 100, output: 10 });

    const result = checker.check({ questionId: "q1", ledger: { input: 100, output: 10 } });

    expect(result.checked).toBe(true);
    expect(result.agrees).toBe(true);
  });

  it("clears the accumulator on reset without producing a verdict", () => {
    const checker = new TokenAccountingChecker();
    checker.observe({ input: 999, output: 99 });
    checker.reset();

    checker.observe({ input: 200, output: 20 });
    const result = checker.check({ questionId: "q2", ledger: { input: 200, output: 20 } });

    expect(result.observedInput).toBe(200);
    expect(result.observedOutput).toBe(20);
    expect(result.agrees).toBe(true);
  });
});

describe("the report does not double-report an unchecked question", () => {
  const failed: EndToEndSweepResult = {
    questionId: "q1",
    evidenceRetrieved: 0,
    missingSnippets: ["x"],
    evidenceCited: 0,
    uncitedSnippets: ["x"],
    chunksRead: 0,
    retrievalMs: 0,
    answerMs: 12,
    inputTokens: 0,
    outputTokens: 0,
    verdict: { passed: false, explanation: "Turn failed: boom" },
    tokenAccounting: {
      ledgerInput: 0,
      observedInput: 0,
      ledgerOutput: 0,
      observedOutput: 0,
      agrees: false,
      checked: false,
    },
    evidenceRead: 0,
    chunksKept: 0,
    readObserved: false,
    error: "boom",
  };

  const summary: SweepSummary<EndToEndSweepResult> = {
    product: "a360ai",
    mode: "end-to-end",
    model: "gpt-5.6-luna",
    startedAt: "2026-08-21T10:00:00.000Z",
    results: [failed],
  };

  it("raises no token-mismatch banner for a question whose check never ran", () => {
    const report = renderSweepReport(summary);

    expect(report).not.toContain("TOKEN ACCOUNTING MISMATCH");
    // It is still visible — as the failure it actually is.
    expect(report).toContain("q1");
    expect(report).toContain("Turn failed: boom");
  });

  it("still raises the banner for a check that ran and disagreed", () => {
    const mismatched: SweepSummary<EndToEndSweepResult> = {
      ...summary,
      results: [
        {
          ...failed,
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

    expect(renderSweepReport(mismatched)).toContain("TOKEN ACCOUNTING MISMATCH");
  });
});
