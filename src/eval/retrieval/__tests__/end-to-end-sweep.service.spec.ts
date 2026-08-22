import { describe, expect, it, vi } from "vitest";
import { AgentMessageType } from "../../../common/enums/agentmessage.type";
import { EndToEndSweepService } from "../end-to-end-sweep.service";
import { EvidenceMatcher } from "../evidence.matcher";
import { EvalQuestionSet } from "../retrieval-eval.types";

const set: EvalQuestionSet = {
  version: 1,
  product: "a360ai",
  questions: [
    {
      id: "loc-01",
      corpus: "a360ai/P10",
      question: "Termini di diffida?",
      mustRetrieve: ["quindici (15) giorni"],
      rubric: "Must state the fifteen-day cure period.",
    },
  ],
};

/**
 * Shaped like the real `ResponderResponseInterface` at HEAD: the answer lives
 * under `answer`, and the per-node token figures under `trace`.
 */
const responderResponse = {
  type: AgentMessageType.Assistant,
  answer: { title: "", analysis: "", answer: "Il termine e di quindici (15) giorni.", questions: [], hasAnswer: true },
  sources: [{ chunkId: "c1", relevance: 90, reason: "cure period" }],
  context: {
    notebook: [
      { chunkId: "c1", content: "Decorso il termine di quindici (15) giorni." },
      { chunkId: "c2", content: "Clausola risolutiva espressa." },
    ],
  },
  trace: {
    planner: { tokens: { input: 500, output: 100 } },
    contextualiser: { tokens: { input: 18000, output: 2500 } },
    answer: { tokens: { input: 3000, output: 500 } },
  },
  tokens: { input: 21500, output: 3100 },
};

const configService = { get: vi.fn().mockReturnValue({ ai: { model: "gpt-5.6-luna" } }) };

const accountingCheck = {
  ledgerInput: 21500,
  observedInput: 21500,
  ledgerOutput: 3100,
  observedOutput: 3100,
  agrees: true,
  checked: true,
};

describe("EndToEndSweepService", () => {
  it("reports evidence retrieved, evidence cited, verdict and tokens", async () => {
    const responder = { run: vi.fn().mockResolvedValue(responderResponse) };
    const judge = {
      judge: vi.fn().mockResolvedValue({ passed: true, explanation: "States the period." }),
    };
    const accounting = { observe: vi.fn(), check: vi.fn().mockReturnValue(accountingCheck) };
    const service = new EndToEndSweepService(
      responder as any,
      judge as any,
      new EvidenceMatcher(),
      accounting as any,
      configService as any,
    );

    const summary = await service.run({ set, companyId: "c", userId: "u" });

    expect(summary.mode).toBe("end-to-end");
    expect(summary.product).toBe("a360ai");
    expect(summary.model).toBe("gpt-5.6-luna");
    expect(summary.results[0].evidenceRetrieved).toBe(1);
    expect(summary.results[0].evidenceCited).toBe(1);
    expect(summary.results[0].missingSnippets).toEqual([]);
    expect(summary.results[0].chunksRead).toBe(2);
    expect(summary.results[0].verdict.passed).toBe(true);
    expect(summary.results[0].inputTokens).toBe(21500);
    expect(summary.results[0].outputTokens).toBe(3100);
    expect(summary.results[0].tokenAccounting.agrees).toBe(true);
    expect(summary.results[0].error).toBeUndefined();
  });

  it("asks the responder one real turn per question, scope included", async () => {
    const scoped: EvalQuestionSet = {
      ...set,
      questions: [{ ...set.questions[0], scopeId: "s1", scopeType: "campaigns" }],
    };
    const responder = { run: vi.fn().mockResolvedValue(responderResponse) };
    const service = new EndToEndSweepService(
      responder as any,
      { judge: vi.fn().mockResolvedValue({ passed: true, explanation: "ok" }) } as any,
      new EvidenceMatcher(),
      { observe: vi.fn(), check: vi.fn().mockReturnValue(accountingCheck) } as any,
      configService as any,
    );

    await service.run({ set: scoped, companyId: "company-1", userId: "user-1" });

    expect(responder.run).toHaveBeenCalledTimes(1);
    expect(responder.run.mock.calls[0][0]).toMatchObject({
      companyId: "company-1",
      userId: "user-1",
      userModuleIds: [],
      dataLimits: {},
      question: "Termini di diffida?",
      scopeId: "s1",
      scopeType: "campaigns",
      messages: [{ type: AgentMessageType.User, content: "Termini di diffida?" }],
    });
  });

  it("counts only the snippets present in the chunks the answer actually cited", async () => {
    const uncited = {
      ...responderResponse,
      sources: [{ chunkId: "c2", relevance: 40, reason: "unrelated" }],
    };
    const responder = { run: vi.fn().mockResolvedValue(uncited) };
    const judge = {
      judge: vi.fn().mockResolvedValue({ passed: false, failureMode: "retrieved-but-unused", explanation: "x" }),
    };
    const service = new EndToEndSweepService(
      responder as any,
      judge as any,
      new EvidenceMatcher(),
      { observe: vi.fn(), check: vi.fn().mockReturnValue(accountingCheck) } as any,
      configService as any,
    );

    const summary = await service.run({ set, companyId: "c", userId: "u" });

    expect(summary.results[0].evidenceRetrieved).toBe(1);
    expect(summary.results[0].evidenceCited).toBe(0);
    expect(summary.results[0].uncitedSnippets).toEqual(["quindici (15) giorni"]);
    expect(judge.judge).toHaveBeenCalledWith(
      expect.objectContaining({ evidenceCited: 0, rubric: "Must state the fifteen-day cure period." }),
    );
  });

  it("cross-checks the ledger against the per-node figures the turn reported", async () => {
    const responder = { run: vi.fn().mockResolvedValue(responderResponse) };
    const accounting = { observe: vi.fn(), check: vi.fn().mockReturnValue(accountingCheck) };
    const service = new EndToEndSweepService(
      responder as any,
      { judge: vi.fn().mockResolvedValue({ passed: true, explanation: "ok" }) } as any,
      new EvidenceMatcher(),
      accounting as any,
      configService as any,
    );

    await service.run({ set, companyId: "c", userId: "u" });

    expect(accounting.observe.mock.calls.map((call) => call[0])).toEqual([
      { input: 500, output: 100 },
      { input: 18000, output: 2500 },
      { input: 3000, output: 500 },
    ]);
    expect(accounting.check).toHaveBeenCalledWith({
      questionId: "loc-01",
      ledger: { input: 21500, output: 3100 },
    });
  });

  it("marks a question failed and continues when the responder throws", async () => {
    const responder = { run: vi.fn().mockRejectedValue(new Error("responder exploded")) };
    const service = new EndToEndSweepService(
      responder as any,
      { judge: vi.fn() } as any,
      new EvidenceMatcher(),
      { observe: vi.fn(), check: vi.fn(), reset: vi.fn() } as any,
      configService as any,
    );

    const summary = await service.run({ set, companyId: "c", userId: "u" });

    expect(summary.results).toHaveLength(1);
    expect(summary.results[0].error).toContain("responder exploded");
    expect(summary.results[0].verdict.passed).toBe(false);
    expect(summary.results[0].missingSnippets).toEqual(["quindici (15) giorni"]);
  });

  describe("evidenceRead scores only the kept entries", () => {
    it("counts a snippet in a kept entry, not one only in a dropped entry", async () => {
      const trimmedSet: EvalQuestionSet = {
        ...set,
        questions: [
          {
            ...set.questions[0],
            mustRetrieve: ["la clausola risolutiva espressa", "il termine di quindici giorni"],
          },
        ],
      };
      const response = {
        ...responderResponse,
        sources: [],
        context: {
          notebook: [
            { chunkId: "kept-1", content: "la clausola risolutiva espressa" },
            { chunkId: "dropped-1", content: "il termine di quindici giorni" },
          ],
        },
        trace: {
          ...responderResponse.trace,
          answer: { branchesUsed: [], tokens: { input: 1, output: 1 }, keptChunkIds: ["kept-1"] },
        },
      };
      const responder = { run: vi.fn().mockResolvedValue(response) };
      const judge = { judge: vi.fn().mockResolvedValue({ passed: true, explanation: "ok" }) };
      const accounting = { observe: vi.fn(), check: vi.fn().mockReturnValue(accountingCheck) };
      const service = new EndToEndSweepService(
        responder as any,
        judge as any,
        new EvidenceMatcher(),
        accounting as any,
        configService as any,
      );

      const summary = await service.run({ set: trimmedSet, companyId: "c", userId: "u" });

      const r = summary.results[0];
      expect(r.evidenceRetrieved).toBe(2); // pre-trim metric unchanged
      expect(r.evidenceRead).toBe(1); // only the kept entry counts
      expect(r.chunksKept).toBe(1);
      expect(r.readObserved).toBe(true);
    });

    it("degrades to evidenceRead 0 / readObserved false when keptChunkIds is absent", async () => {
      const trimmedSet: EvalQuestionSet = {
        ...set,
        questions: [{ ...set.questions[0], mustRetrieve: ["snippet uno"] }],
      };
      const response = {
        ...responderResponse,
        sources: [],
        context: { notebook: [{ chunkId: "a", content: "snippet uno" }] },
        trace: {
          ...responderResponse.trace,
          answer: { branchesUsed: [], tokens: { input: 1, output: 1 } }, // no keptChunkIds
        },
      };
      const responder = { run: vi.fn().mockResolvedValue(response) };
      const judge = { judge: vi.fn().mockResolvedValue({ passed: true, explanation: "ok" }) };
      const accounting = { observe: vi.fn(), check: vi.fn().mockReturnValue(accountingCheck) };
      const service = new EndToEndSweepService(
        responder as any,
        judge as any,
        new EvidenceMatcher(),
        accounting as any,
        configService as any,
      );

      const summary = await service.run({ set: trimmedSet, companyId: "c", userId: "u" });

      const r = summary.results[0];
      expect(r.evidenceRead).toBe(0);
      expect(r.chunksKept).toBe(0);
      expect(r.readObserved).toBe(false);
      expect(r.evidenceRetrieved).toBe(1); // never a crash, pre-trim metric intact
    });
  });

  describe("core-only entries are scored against core text (spec §3c)", () => {
    it("does not credit neighbour text that never reached the model", async () => {
      const trimmedSet: EvalQuestionSet = {
        ...set,
        questions: [
          {
            ...set.questions[0],
            mustRetrieve: ["la clausola risolutiva", "il termine di quindici giorni"],
          },
        ],
      };
      const response = {
        ...responderResponse,
        sources: [],
        context: {
          notebook: [
            {
              chunkId: "shed-1",
              content: "NEIGHBOUR il termine di quindici giorni\n\nCORE la clausola risolutiva",
              coreContent: "CORE la clausola risolutiva",
            },
          ],
        },
        trace: {
          ...responderResponse.trace,
          answer: {
            branchesUsed: [],
            tokens: { input: 1, output: 1 },
            keptChunkIds: ["shed-1"],
            coreOnlyChunkIds: ["shed-1"],
          },
        },
      };
      const responder = { run: vi.fn().mockResolvedValue(response) };
      const judge = { judge: vi.fn().mockResolvedValue({ passed: true, explanation: "ok" }) };
      const accounting = { observe: vi.fn(), check: vi.fn().mockReturnValue(accountingCheck) };
      const service = new EndToEndSweepService(
        responder as any,
        judge as any,
        new EvidenceMatcher(),
        accounting as any,
        configService as any,
      );

      const summary = await service.run({ set: trimmedSet, companyId: "c", userId: "u" });

      const r = summary.results[0];
      expect(r.evidenceRetrieved).toBe(2); // pre-trim metric still sees both
      expect(r.evidenceRead).toBe(1); // only the core-text snippet reached the model
      expect(r.chunksKept).toBe(1);
      expect(r.chunksKeptCore).toBe(1);
    });

    it("scores fully-kept entries against their widened content, as before", async () => {
      const trimmedSet: EvalQuestionSet = {
        ...set,
        questions: [
          {
            ...set.questions[0],
            mustRetrieve: ["snippet uno", "snippet due"],
          },
        ],
      };
      const response = {
        ...responderResponse,
        sources: [],
        context: {
          notebook: [
            {
              chunkId: "full-1",
              content: "NEIGHBOUR snippet due\n\nCORE snippet uno",
              coreContent: "CORE snippet uno",
            },
          ],
        },
        trace: {
          ...responderResponse.trace,
          answer: { branchesUsed: [], tokens: { input: 1, output: 1 }, keptChunkIds: ["full-1"], coreOnlyChunkIds: [] },
        },
      };
      const responder = { run: vi.fn().mockResolvedValue(response) };
      const judge = { judge: vi.fn().mockResolvedValue({ passed: true, explanation: "ok" }) };
      const accounting = { observe: vi.fn(), check: vi.fn().mockReturnValue(accountingCheck) };
      const service = new EndToEndSweepService(
        responder as any,
        judge as any,
        new EvidenceMatcher(),
        accounting as any,
        configService as any,
      );

      const summary = await service.run({ set: trimmedSet, companyId: "c", userId: "u" });

      const r = summary.results[0];
      expect(r.evidenceRead).toBe(2);
      expect(r.chunksKeptCore).toBe(0);
    });
  });

  it("records the model as unknown rather than throwing when no ai config is present", async () => {
    const responder = { run: vi.fn().mockResolvedValue(responderResponse) };
    const service = new EndToEndSweepService(
      responder as any,
      { judge: vi.fn().mockResolvedValue({ passed: true, explanation: "ok" }) } as any,
      new EvidenceMatcher(),
      { observe: vi.fn(), check: vi.fn().mockReturnValue(accountingCheck) } as any,
      { get: vi.fn().mockReturnValue(undefined) } as any,
    );

    const summary = await service.run({ set, companyId: "c", userId: "u" });

    expect(summary.model).toBe("unknown");
  });
});
