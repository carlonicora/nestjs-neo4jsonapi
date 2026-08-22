import { describe, expect, it, vi } from "vitest";
import { RUBRIC_JUDGE_PROMPT, RubricJudgeService } from "../rubric-judge.service";

describe("RubricJudgeService", () => {
  it("returns the model's verdict and failure mode", async () => {
    const llmService = {
      call: vi.fn().mockResolvedValue({
        passed: false,
        failureMode: "retrieved-but-unused",
        explanation: "The cure period appears in the sources but not in the answer.",
        tokenUsage: { input: 900, output: 60 },
      }),
    };
    const service = new RubricJudgeService(llmService as any);

    const verdict = await service.judge({
      question: "Termini di diffida?",
      rubric: "Must state the fifteen-day cure period.",
      answer: "Il contratto prevede varie clausole.",
      evidenceCited: 1,
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.failureMode).toBe("retrieved-but-unused");
    expect(llmService.call).toHaveBeenCalledTimes(1);

    const callArgs = llmService.call.mock.calls[0][0];
    expect(callArgs.inputSchema).toBeDefined();
    expect(callArgs.outputSchema).toBeDefined();
    expect(callArgs.metadata).toEqual({ agentName: "retrieval-eval", nodeName: "rubric-judge" });
    expect(callArgs.temperature).toBe(0);
  });

  it("attributes the call and passes every input param it declares", async () => {
    const llmService = {
      call: vi.fn().mockResolvedValue({
        passed: true,
        explanation: "States the fifteen-day cure period.",
        tokenUsage: { input: 900, output: 60 },
      }),
    };
    const service = new RubricJudgeService(llmService as any);

    await service.judge({
      question: "Termini di diffida?",
      rubric: "Must state the fifteen-day cure period.",
      answer: "Il termine e di quindici giorni.",
      evidenceCited: 2,
    });

    const callArgs = llmService.call.mock.calls[0][0];
    expect(callArgs.tokenUsageType).toBe("retrieval_eval");
    // Set per call on purpose, never inherited from the tier default.
    expect(callArgs.reasoningEffort).toBe("low");
    expect(callArgs.systemPrompts).toEqual([RUBRIC_JUDGE_PROMPT]);
    expect(callArgs.inputParams).toEqual({
      question: "Termini di diffida?",
      rubric: "Must state the fifteen-day cure period.",
      answer: "Il termine e di quindici giorni.",
      evidenceCited: 2,
    });
    // A sweep has no tenant entity to bill, so the usage row is deliberately
    // not persisted — see the comment on RubricJudgeService.judge.
    expect(callArgs.relationshipId).toBeUndefined();
    expect(callArgs.relationshipType).toBeUndefined();

    // Every inputParams key must be declared and described in inputSchema
    // (06-llm-calls.md rule 1 + ENFORCEMENT CHECKPOINT step 1).
    const shape = callArgs.inputSchema.shape;
    for (const key of Object.keys(callArgs.inputParams)) {
      expect(shape[key]).toBeDefined();
      expect(shape[key].description).toBeTruthy();
    }
    for (const key of Object.keys(callArgs.outputSchema.shape)) {
      expect(callArgs.outputSchema.shape[key].description).toBeTruthy();
    }
  });

  it("rejects a failure mode outside the closed set", async () => {
    const llmService = {
      call: vi.fn().mockResolvedValue({
        passed: false,
        failureMode: "made-up-mode",
        explanation: "n/a",
        tokenUsage: { input: 1, output: 1 },
      }),
    };
    const service = new RubricJudgeService(llmService as any);

    const verdict = await service.judge({ question: "q", rubric: "r", answer: "a", evidenceCited: 0 });

    expect(verdict.passed).toBe(false);
    expect(verdict.failureMode).toBeUndefined();
  });

  it("fails the question rather than the sweep when the judge errors", async () => {
    const llmService = { call: vi.fn().mockRejectedValue(new Error("provider down")) };
    const service = new RubricJudgeService(llmService as any);

    const verdict = await service.judge({
      question: "q",
      rubric: "r",
      answer: "a",
      evidenceCited: 0,
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.explanation).toContain("provider down");
  });
});

describe("RUBRIC_JUDGE_PROMPT", () => {
  it("contains no backticks (template-literal safety)", () => {
    expect(RUBRIC_JUDGE_PROMPT.includes("`")).toBe(false);
  });
  it("contains no dynamic placeholders (data travels via inputParams)", () => {
    expect(RUBRIC_JUDGE_PROMPT).not.toMatch(/\$\{/);
  });
});
