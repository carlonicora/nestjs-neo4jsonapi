import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { describe, it, expect, vi, type Mock } from "vitest";
import { LLMService } from "../../../../core/llm/services/llm.service";
import { NOTEBOOK_BUDGET_CHARS } from "../../../../foundations/chunk/repositories/retrieval.constants";
import { ResponderAnswerNodeService, buildResponderOutputSchema } from "../responder.answer.node.service";

/**
 * Block 3c deletes the ~23 per-chunk LLM calls, and neither a relevance floor
 * nor a chunk-count cap replaced them (owner decision, 2026-08-22). The notebook
 * budget inside `buildNotebookSection` is therefore the ONLY thing deciding what
 * reaches the answer, so it is exercised here through the node's public
 * `execute()` — the same idiom every other spec in this folder uses — rather
 * than through a test seam onto the private method. Going through `execute()`
 * also pins the two properties a seam cannot see: that the budget never reaches
 * `seedSection` (C3), and that `sources[].reason` now comes from the citation.
 */

/** Deterministic filler so each notebook entry has a known character cost. */
function body(chars: number, marker: string): string {
  return marker.repeat(Math.ceil(chars / marker.length)).slice(0, chars);
}

function buildState(partial: Record<string, any>): any {
  return {
    companyId: "co-1",
    userId: "user-1",
    userModuleIds: [],
    rawQuestion: "what?",
    question: "what?",
    chatHistory: [],
    seedContexts: [],
    tokens: { input: 0, output: 0 },
    branchPlan: { runGraph: false, runContextualiser: true, runDrift: false, reasoning: "" },
    plannerError: null,
    graphError: null,
    contextualiserError: null,
    driftError: null,
    trace: {
      planner: {
        reasoning: "",
        branchPlan: { runGraph: false, runContextualiser: false, runDrift: false },
        tokens: { input: 0, output: 0 },
      },
      answer: { branchesUsed: [], tokens: { input: 0, output: 0 } },
      totalTokens: { input: 0, output: 0 },
    },
    ...partial,
  };
}

async function makeService(llmResponse: Record<string, unknown> = {}) {
  const llm = {
    call: vi.fn().mockResolvedValue({
      title: "t",
      analyse: "a",
      finalAnswer: "f",
      citations: [],
      references: [],
      questions: [],
      tokenUsage: { input: 1, output: 1 },
      ...llmResponse,
    }),
  } as unknown as LLMService;
  const config = { get: vi.fn().mockReturnValue(undefined) } as unknown as ConfigService;
  const moduleRef = await Test.createTestingModule({
    providers: [
      ResponderAnswerNodeService,
      { provide: LLMService, useValue: llm },
      { provide: ConfigService, useValue: config },
    ],
  }).compile();
  return { service: moduleRef.get(ResponderAnswerNodeService), llm };
}

async function notebookSectionFor(notebook: unknown[], extraContext: Record<string, unknown> = {}) {
  const { service, llm } = await makeService();
  await service.execute({
    state: buildState({
      context: { question: "what?", annotations: "", notebook, ontology: [], ...extraContext },
    }),
  });
  return (llm.call as unknown as Mock).mock.calls[0][0].inputParams.notebookSection as string;
}

describe("buildNotebookSection — ordering", () => {
  it("emits scored entries strongest-first, whatever order the notebook arrived in", async () => {
    const section = await notebookSectionFor([
      { chunkId: "mid", content: "middle relevance", reason: "", score: 0.5 },
      { chunkId: "low", content: "low relevance", reason: "", score: 0.2 },
      { chunkId: "high", content: "high relevance", reason: "", score: 0.9 },
    ]);

    const order = ["high", "mid", "low"].map((id) => section.indexOf(`${id}: `));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});

describe("buildNotebookSection — budget", () => {
  it("drops the weakest entries once the budget is exhausted and stays inside it", async () => {
    // 30 entries x 4,000 chars = 120,000 chars against a 40,000 char budget.
    const notebook = Array.from({ length: 30 }, (_, i) => ({
      chunkId: `chunk-${i}`,
      content: body(4_000, `c${i}.`),
      reason: "",
      score: 1 - i / 100, // chunk-0 strongest, chunk-29 weakest
    }));

    const section = await notebookSectionFor(notebook);

    // Only the header line and the (empty) annotations sit outside the budget.
    expect(section.length).toBeLessThanOrEqual(NOTEBOOK_BUDGET_CHARS + 200);
    expect(section).toContain("chunk-0: ");
    expect(section).not.toContain("chunk-29: ");
    const kept = notebook.filter((n) => section.includes(`${n.chunkId}: `));
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(notebook.length);
    // What survives is a prefix of the score ordering: no weak entry outlives a
    // stronger one.
    expect(kept.map((n) => n.chunkId)).toEqual(notebook.slice(0, kept.length).map((n) => n.chunkId));
  });

  // `annotations` is model-written prose from up to three atomic-fact batches and
  // has no length bound of its own. Before the budget charged it, a large
  // annotations block consumed the answer's context for free — a hole in the only
  // bound left after Block 3c dropped the relevance bar and both chunk caps.
  it("charges the header and annotations against the budget", async () => {
    const annotations = body(30_000, "anno.");
    const notebook = Array.from({ length: 30 }, (_, i) => ({
      chunkId: `chunk-${i}`,
      content: body(4_000, `c${i}.`),
      reason: "",
      score: 1 - i / 100,
    }));

    const section = await notebookSectionFor(notebook, { annotations });

    // The whole section — header, annotations and every kept entry — fits the budget.
    expect(section).toContain(annotations);
    expect(section.length).toBeLessThanOrEqual(NOTEBOOK_BUDGET_CHARS);

    // 30,000 chars of annotations leave room for far fewer 4,000-char entries than
    // an empty annotations block does. Without the fix both cases kept the same number.
    const keptWith = notebook.filter((n) => section.includes(`${n.chunkId}: `)).length;
    const sectionWithout = await notebookSectionFor(notebook);
    const keptWithout = notebook.filter((n) => sectionWithout.includes(`${n.chunkId}: `)).length;
    expect(keptWith).toBeLessThan(keptWithout);

    // The strongest entry still survives: annotations crowd out the weak tail, not the head.
    expect(section).toContain("chunk-0: ");
  });

  it("never trims seed contexts — the budget cannot reach seedSection (C3)", async () => {
    const { service, llm } = await makeService();
    // Sized relative to the budget so the assertion below stays meaningful
    // whatever NOTEBOOK_BUDGET_CHARS is tuned to.
    const seedBody = body(Math.floor(NOTEBOOK_BUDGET_CHARS * 1.5), "seed.");
    await service.execute({
      state: buildState({
        seedContexts: [{ title: "APP SEED", content: seedBody, references: [] }],
        context: {
          question: "what?",
          annotations: "",
          notebook: Array.from({ length: 20 }, (_, i) => ({
            chunkId: `chunk-${i}`,
            content: body(4_000, `c${i}.`),
            reason: "",
            score: 1 - i / 100,
          })),
          ontology: [],
        },
      }),
    });

    const params = (llm.call as unknown as Mock).mock.calls[0][0].inputParams;
    expect(params.seedSection).toContain(seedBody);
    expect(params.seedSection.length).toBeGreaterThan(NOTEBOOK_BUDGET_CHARS);
    expect(params.notebookSection.length).toBeLessThanOrEqual(NOTEBOOK_BUDGET_CHARS + 200);
  });
});

describe("buildNotebookSection — unscored app contributions", () => {
  it("keeps an unscored entry even when scored entries are being dropped, and sorts it last", async () => {
    const notebook: any[] = Array.from({ length: 20 }, (_, i) => ({
      chunkId: `chunk-${i}`,
      content: body(4_000, `c${i}.`),
      reason: "",
      score: 1 - i / 100,
    }));
    // App-contributed (RETRIEVAL_SOURCES): no score, arrives last.
    notebook.push({ chunkId: "massima-1", content: "an app-contributed massima", reason: "app source" });

    const section = await notebookSectionFor(notebook);

    // Budget is exhausted — some scored entries were dropped ...
    expect(section).not.toContain("chunk-19: ");
    // ... but the unscored app contribution survived.
    expect(section).toContain("massima-1: an app-contributed massima");
    // It sorts after every scored entry that survived.
    expect(section.indexOf("massima-1: ")).toBeGreaterThan(section.indexOf("chunk-0: "));
  });

  it("an unscored entry is not treated as score 0 — it outlives the weakest scored entry", async () => {
    const section = await notebookSectionFor([
      { chunkId: "scored-high", content: "strong", reason: "", score: 0.9 },
      { chunkId: "unscored", content: "app contribution", reason: "app source" },
      { chunkId: "scored-low", content: "weak", reason: "", score: 0.01 },
    ]);

    expect(section).toContain("scored-high: ");
    expect(section).toContain("unscored: ");
    expect(section).toContain("scored-low: ");
    expect(section.indexOf("unscored: ")).toBeGreaterThan(section.indexOf("scored-low: "));
  });
});

describe("citations reason", () => {
  it("the citations schema carries a described reason field", () => {
    const schema = buildResponderOutputSchema();
    const citation = (schema.shape.citations as any).element;
    expect(citation.shape.reason).toBeDefined();
    expect(citation.shape.reason.description).toContain("Shown to the user");
    expect(citation.shape.reason.description).toContain("contributed to the answer");
  });

  it("sources[].reason comes from the citation, not from the notebook entry", async () => {
    const { service } = await makeService({
      citations: [{ chunkId: "chunk-1", relevance: 80, reason: "gave the deadline for the appeal" }],
    });

    const result = await service.execute({
      state: buildState({
        context: {
          question: "what?",
          annotations: "",
          notebook: [
            {
              chunkId: "chunk-1",
              content: "the source text",
              reason: "NOTEBOOK REASON",
              sourceLayer: "reference",
              metadata: { docId: "d-1" },
              score: 0.8,
            },
          ],
          ontology: [],
        },
      }),
    });

    const source = result.sources![0] as any;
    expect(source.reason).toBe("gave the deadline for the appeal");
    // Provenance is still backfilled from the notebook entry.
    expect(source.sourceLayer).toBe("reference");
    expect(source.metadata).toEqual({ docId: "d-1" });
  });

  it("a citation with no reason yields an empty string rather than the notebook's reason", async () => {
    const { service } = await makeService({
      citations: [{ chunkId: "chunk-1", relevance: 80 }],
    });

    const result = await service.execute({
      state: buildState({
        context: {
          question: "what?",
          annotations: "",
          notebook: [{ chunkId: "chunk-1", content: "text", reason: "NOTEBOOK REASON", score: 0.8 }],
          ontology: [],
        },
      }),
    });

    expect((result.sources![0] as any).reason).toBe("");
  });
});

describe("keptChunkIds on trace.answer", () => {
  it("records exactly the entries that survived, in emission order (scored strongest-first, unscored last)", async () => {
    // Three scored entries sized so the budget keeps two, plus one small
    // unscored app contribution that is admitted first (retention) but
    // emitted last (emission) — mirrors the retention/emission split in
    // buildNotebookSection.
    const big = Math.floor(NOTEBOOK_BUDGET_CHARS * 0.45);
    const state = buildState({
      context: {
        question: "what?",
        annotations: "",
        ontology: [],
        notebook: [
          { chunkId: "weak", content: body(big, "w"), reason: "", sourceLayer: "case", score: 0.1 },
          { chunkId: "strong", content: body(big, "s"), reason: "", sourceLayer: "case", score: 0.9 },
          { chunkId: "mid", content: body(big, "m"), reason: "", sourceLayer: "case", score: 0.5 },
          { chunkId: "law-1", content: body(200, "l"), reason: "", sourceLayer: "law", score: undefined },
        ],
      },
    });
    const { service } = await makeService();
    const out = await service.execute({ state });
    // budget: header + law-1 (unscored, admitted first) + strong + mid fit; weak dropped
    expect((out.trace as any).answer.keptChunkIds).toEqual(["strong", "mid", "law-1"]);
  });

  it("is an empty array when the contextualiser branch did not run", async () => {
    const state = buildState({
      branchPlan: { runGraph: false, runContextualiser: false, runDrift: false, reasoning: "" },
      context: undefined,
    });
    const { service } = await makeService();
    const out = await service.execute({ state });
    expect((out.trace as any).answer.keptChunkIds).toEqual([]);
  });
});

describe("shed widening before dropping (spec §3b)", () => {
  it("keeps an entry in core form when the widened line does not fit, and reports it core-only", async () => {
    const big = Math.floor(NOTEBOOK_BUDGET_CHARS * 0.6);
    const state = buildState({
      context: {
        notebook: [
          {
            chunkId: "first",
            content: body(big, "f"),
            coreContent: body(200, "f"),
            reason: "",
            sourceLayer: "case",
            score: 0.9,
          },
          {
            chunkId: "second",
            content: body(big, "s"),
            coreContent: body(200, "s"),
            reason: "",
            sourceLayer: "case",
            score: 0.5,
          },
        ],
      },
    });
    const { service } = await makeService();
    const out = await service.execute({ state });
    // first fits widened (0.6B); second's widened does not (1.2B) but its 200-char core does
    expect(out.trace.answer.keptChunkIds).toEqual(["first", "second"]);
    expect(out.trace.answer.coreOnlyChunkIds).toEqual(["second"]);
  });

  it("breaks when even the core does not fit — nothing weaker is kept in any form", async () => {
    const big = Math.floor(NOTEBOOK_BUDGET_CHARS * 0.99);
    const state = buildState({
      context: {
        notebook: [
          {
            chunkId: "first",
            content: body(big, "f"),
            coreContent: body(big, "f"),
            reason: "",
            sourceLayer: "case",
            score: 0.9,
          },
          {
            chunkId: "huge",
            content: body(big, "h"),
            coreContent: body(big, "h"),
            reason: "",
            sourceLayer: "case",
            score: 0.5,
          },
          {
            chunkId: "tiny",
            content: body(50, "t"),
            coreContent: body(50, "t"),
            reason: "",
            sourceLayer: "case",
            score: 0.1,
          },
        ],
      },
    });
    const { service } = await makeService();
    const out = await service.execute({ state });
    expect(out.trace.answer.keptChunkIds).toEqual(["first"]); // huge fits neither → break; tiny never considered
    expect(out.trace.answer.coreOnlyChunkIds).toEqual([]);
  });

  it("keeps whole-entry semantics for entries without coreContent (app contributions)", async () => {
    const big = Math.floor(NOTEBOOK_BUDGET_CHARS * 1.2);
    const state = buildState({
      context: {
        notebook: [
          { chunkId: "law-1", content: body(big, "l"), reason: "", sourceLayer: "law", score: undefined },
          {
            chunkId: "case-1",
            content: body(300, "c"),
            coreContent: body(300, "c"),
            reason: "",
            sourceLayer: "case",
            score: 0.9,
          },
        ],
      },
    });
    const { service } = await makeService();
    const out = await service.execute({ state });
    expect(out.trace.answer.keptChunkIds).toEqual(["case-1"]); // oversized unscored entry dropped whole, never shed
    expect(out.trace.answer.coreOnlyChunkIds).toEqual([]);
  });
});
