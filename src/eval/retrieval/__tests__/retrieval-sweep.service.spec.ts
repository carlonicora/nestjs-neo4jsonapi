import { describe, expect, it, vi } from "vitest";
import { EvidenceMatcher } from "../evidence.matcher";
import { EvalQuestionSet } from "../retrieval-eval.types";
import { RetrievalSweepService } from "../retrieval-sweep.service";

const set: EvalQuestionSet = {
  version: 1,
  product: "a360ai",
  questions: [
    {
      id: "loc-01",
      corpus: "a360ai/P10",
      question: "Termini di diffida?",
      mustRetrieve: ["quindici (15) giorni", "Legge 392/1978"],
      rubric: "Must state the cure period.",
    },
  ],
};

describe("RetrievalSweepService", () => {
  it("reports which ground-truth snippets the retrieval actually returned", async () => {
    const chunkRepository = {
      findPotentialChunks: vi.fn().mockResolvedValue([
        { id: "c1", content: "Decorso il termine di quindici (15) giorni il locatore agisce." },
        { id: "c2", content: "Cessione e sublocazione vietate." },
      ]),
    };
    const service = new RetrievalSweepService(chunkRepository as any, new EvidenceMatcher());

    const summary = await service.run({ set });

    expect(summary.mode).toBe("retrieval-only");
    expect(summary.results).toHaveLength(1);
    expect(summary.results[0].evidenceRetrieved).toBe(1);
    expect(summary.results[0].missingSnippets).toEqual(["Legge 392/1978"]);
    expect(summary.results[0].chunksRead).toBe(2);
  });

  it("calls the retrieval layer with the question and the required dataLimits argument", async () => {
    const chunkRepository = { findPotentialChunks: vi.fn().mockResolvedValue([]) };
    const service = new RetrievalSweepService(chunkRepository as any, new EvidenceMatcher());

    await service.run({ set });

    expect(chunkRepository.findPotentialChunks).toHaveBeenCalledWith({
      question: "Termini di diffida?",
      dataLimits: {},
    });
  });

  it("records the error and continues when one question's retrieval throws", async () => {
    const chunkRepository = {
      findPotentialChunks: vi.fn().mockRejectedValue(new Error("neo4j down")),
    };
    const service = new RetrievalSweepService(chunkRepository as any, new EvidenceMatcher());

    const summary = await service.run({ set });

    expect(summary.results[0].error).toContain("neo4j down");
    expect(summary.results[0].evidenceRetrieved).toBe(0);
    expect(summary.results[0].missingSnippets).toEqual(["quindici (15) giorni", "Legge 392/1978"]);
    expect(summary.results[0].chunksRead).toBe(0);
  });
});
