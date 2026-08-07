import { encodingForModel } from "js-tiktoken";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EmbedderService } from "../embedder.service";

/**
 * EmbedderService writes ONE token-usage record per invocation, and only when
 * the caller opts in with an attribution. Billing must be PRECISE, so tokens
 * are counted with the embedder model's own tiktoken tokenizer; the
 * chars-per-token heuristic is the fallback for models tiktoken does not know.
 *
 * Every test builds a FRESH service: the tokenizer is memoised per instance.
 */

/** A literal whose tiktoken count (10) differs from the heuristic (ceil(44/4) = 11). */
const FOX = "The quick brown fox jumps over the lazy dog.";
const FOX_TIKTOKEN_TOKENS = 10;

const ATTRIBUTION = { relationshipId: "entity-id", relationshipType: "Document" };

function makeEmbedder() {
  return {
    embedQuery: vi.fn(async () => [0.1, 0.2]),
    embedDocuments: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2])),
  };
}

function makeService(params: {
  model?: string;
  inputCostPer1MTokens?: number;
  charsPerToken?: number;
  recorder?: { recordTokenUsage: ReturnType<typeof vi.fn> };
  tokenUsageService?: { recordTokenUsage: ReturnType<typeof vi.fn> };
}) {
  const embedder = makeEmbedder();
  const modelService = { getEmbedder: () => embedder } as any;
  const aiConfig = {
    embedder: {
      model: params.model ?? "text-embedding-3-large",
      inputCostPer1MTokens: params.inputCostPer1MTokens,
      rateLimit: params.charsPerToken === undefined ? undefined : { charsPerToken: params.charsPerToken },
    },
  };
  const configService = { get: vi.fn((key: string) => (key === "ai" ? aiConfig : undefined)) } as any;
  const service = new EmbedderService(
    modelService,
    configService,
    params.tokenUsageService as any,
    params.recorder as any,
  );
  return { service, embedder };
}

describe("EmbedderService usage recording", () => {
  let recorder: { recordTokenUsage: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    recorder = { recordTokenUsage: vi.fn(async () => undefined) };
  });

  it("records nothing when the caller passes no attribution", async () => {
    const { service } = makeService({ inputCostPer1MTokens: 0.13, recorder });

    await service.vectoriseText({ text: FOX });

    expect(recorder.recordTokenUsage).not.toHaveBeenCalled();
  });

  it("records nothing when the attribution is incomplete", async () => {
    const { service } = makeService({ inputCostPer1MTokens: 0.13, recorder });

    await service.vectoriseText({ text: FOX, attribution: { relationshipId: "entity-id" } as any });

    expect(recorder.recordTokenUsage).not.toHaveBeenCalled();
  });

  it("records nothing when the embedder rate is 0 or unset", async () => {
    const zeroRate = makeService({ inputCostPer1MTokens: 0, recorder });
    await zeroRate.service.vectoriseText({ text: FOX, attribution: ATTRIBUTION });
    expect(recorder.recordTokenUsage).not.toHaveBeenCalled();

    const noRate = makeService({ recorder });
    await noRate.service.vectoriseText({ text: FOX, attribution: ATTRIBUTION });
    expect(recorder.recordTokenUsage).not.toHaveBeenCalled();
  });

  it("records one floor-exempt record with the embedder-rate cost override", async () => {
    const rate = 0.13;
    const { service } = makeService({ inputCostPer1MTokens: rate, recorder });

    await service.vectoriseText({ text: FOX, attribution: ATTRIBUTION });

    expect(recorder.recordTokenUsage).toHaveBeenCalledTimes(1);
    expect(recorder.recordTokenUsage).toHaveBeenCalledWith({
      tokens: { input: FOX_TIKTOKEN_TOKENS, output: 0 },
      type: "embedding",
      relationshipId: "entity-id",
      relationshipType: "Document",
      applyMinimum: false,
      costOverride: (FOX_TIKTOKEN_TOKENS * rate) / 1_000_000,
    });
  });

  it("honours an explicit tokenUsageType", async () => {
    const { service } = makeService({ inputCostPer1MTokens: 0.13, recorder });

    await service.vectoriseText({
      text: FOX,
      attribution: { ...ATTRIBUTION, tokenUsageType: "graph_creator" },
    });

    expect(recorder.recordTokenUsage.mock.calls[0][0].type).toBe("graph_creator");
  });

  it("writes ONE record for a batch, summing the per-text token counts", async () => {
    // Also pins model-name normalisation: the provider-prefixed form still
    // resolves to the text-embedding-3-large tokenizer.
    const rate = 0.13;
    const { service } = makeService({
      model: "azure/openai/text-embedding-3-large@francecentral",
      inputCostPer1MTokens: rate,
      recorder,
    });
    const texts = ["alpha", "beta gamma", FOX];
    const expected = texts.reduce((sum, t) => sum + encodingForModel("text-embedding-3-large").encode(t).length, 0);

    await service.vectoriseTextBatch(texts, ATTRIBUTION);

    expect(recorder.recordTokenUsage).toHaveBeenCalledTimes(1);
    const call = recorder.recordTokenUsage.mock.calls[0][0];
    expect(call.tokens).toEqual({ input: expected, output: 0 });
    expect(call.costOverride).toBe((expected * rate) / 1_000_000);
  });

  it("counts tokens with the model tokenizer, not the chars-per-token heuristic", async () => {
    const { service } = makeService({
      model: "text-embedding-3-large",
      inputCostPer1MTokens: 0.13,
      charsPerToken: 4,
      recorder,
    });

    await service.vectoriseText({ text: FOX, attribution: ATTRIBUTION });

    const exact = encodingForModel("text-embedding-3-large").encode(FOX).length;
    expect(exact).toBe(FOX_TIKTOKEN_TOKENS);
    expect(recorder.recordTokenUsage.mock.calls[0][0].tokens.input).toBe(exact);
    // The heuristic would have produced a different (wrong) figure.
    expect(exact).not.toBe(Math.ceil(FOX.length / 4));
  });

  it("falls back to the chars-per-token heuristic for a model tiktoken does not know", async () => {
    const { service } = makeService({
      model: "unknown-model",
      inputCostPer1MTokens: 0.13,
      charsPerToken: 4,
      recorder,
    });

    await service.vectoriseText({ text: FOX, attribution: ATTRIBUTION });

    expect(recorder.recordTokenUsage.mock.calls[0][0].tokens.input).toBe(Math.ceil(FOX.length / 4));
  });

  it("falls back to the module-local TokenUsageService when no recorder is bound", async () => {
    const tokenUsageService = { recordTokenUsage: vi.fn(async () => undefined) };
    const { service } = makeService({ inputCostPer1MTokens: 0.13, tokenUsageService });

    await service.vectoriseText({ text: FOX, attribution: ATTRIBUTION });

    expect(tokenUsageService.recordTokenUsage).toHaveBeenCalledTimes(1);
  });

  it("does not reject the vectorise call when the recorder throws", async () => {
    recorder.recordTokenUsage.mockRejectedValue(new Error("neo4j down"));
    const { service, embedder } = makeService({ inputCostPer1MTokens: 0.13, recorder });

    await expect(service.vectoriseText({ text: FOX, attribution: ATTRIBUTION })).resolves.toEqual([0.1, 0.2]);
    expect(embedder.embedQuery).toHaveBeenCalledTimes(1);
    expect(recorder.recordTokenUsage).toHaveBeenCalledTimes(1);
  });
});
