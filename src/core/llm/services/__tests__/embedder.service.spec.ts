import { Logger } from "@nestjs/common";
import { encodingForModel } from "js-tiktoken";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmbedderService } from "../embedder.service";
import { EmbedderBucketStarvedError } from "../rate-limited-embedder";

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

function makeEmbedder(failWith?: Error) {
  if (failWith)
    return {
      embedQuery: vi.fn(async () => {
        throw failWith;
      }),
      embedDocuments: vi.fn(async (_texts: string[]) => {
        throw failWith;
      }),
    };
  return {
    embedQuery: vi.fn(async () => [0.1, 0.2]),
    embedDocuments: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2])),
  };
}

/**
 * Provider hard cap is 8192 tokens per input; the service slices below 8000.
 * The tests measure with the real tokenizer rather than trusting a literal.
 */
const MAX_EMBED_INPUT_TOKENS = 8000;
const encoder = encodingForModel("text-embedding-3-large");
const tokensOf = (text: string): number => encoder.encode(text).length;

/** ~20k tokens of real words — the shape of input that lost a document in production. */
const HUGE = Array.from({ length: 20_000 }, () => "token").join(" ");

/** Element-wise mean, L2-normalized — the assertion oracle for mean-pooling. */
function poolOf(vectors: number[][]): number[] {
  const dims = vectors[0].length;
  const mean = new Array<number>(dims).fill(0);
  for (const vector of vectors) for (let i = 0; i < dims; i++) mean[i] += vector[i];
  for (let i = 0; i < dims; i++) mean[i] /= vectors.length;
  const norm = Math.sqrt(mean.reduce((sum, value) => sum + value * value, 0));
  return mean.map((value) => value / norm);
}

/**
 * Returns a vector DERIVED from the input, so a returned vector identifies the
 * text it came from whatever order the service calls the provider in.
 */
const vectorFor = (text: string): number[] => [text.length, 1, -1];

function makeTextEmbedder() {
  return {
    embedQuery: vi.fn(async (text: string) => vectorFor(text)),
    embedDocuments: vi.fn(async (texts: string[]) => texts.map(vectorFor)),
  };
}

function makeService(params: {
  model?: string;
  inputCostPer1MTokens?: number;
  charsPerToken?: number;
  recorder?: { recordTokenUsage: ReturnType<typeof vi.fn> };
  tokenUsageService?: { recordTokenUsage: ReturnType<typeof vi.fn> };
  embedder?: ReturnType<typeof makeTextEmbedder>;
  /** Makes the underlying embedder reject, as RateLimitedEmbedder does when the provider errors. */
  embedderError?: Error;
}) {
  const embedder = params.embedder ?? (makeEmbedder(params.embedderError) as unknown as ReturnType<typeof makeTextEmbedder>);
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

  /**
   * A FAILED call bills ONLY when the rejection is evidence the provider did
   * work — a 5xx it reported. Everything else records nothing: the token counts
   * here are computed locally with tiktoken, so they exist even when nothing was
   * ever sent, and billing them would charge the customer for OUR outages. These
   * calls run inside BullMQ jobs with `attempts: 3`, so a single transient local
   * failure could otherwise bill the same batch four times.
   */
  describe("failed embedding calls", () => {
    /** A rejection carrying a provider-reported HTTP status, as the OpenAI/Azure client raises. */
    const providerError = (status: number, message = `provider ${status}`) =>
      Object.assign(new Error(message), { status });

    describe("provider-side faults (5xx) — the provider served part of the batch", () => {
      it("bills what a failed batch already burned and rethrows", async () => {
        // A large batch whose last provider sub-batch 500s: the provider charged
        // for every sub-batch it served, so recording nothing understates spend.
        const rate = 0.13;
        const { service } = makeService({
          inputCostPer1MTokens: rate,
          recorder,
          embedderError: providerError(500),
        });
        const texts = ["alpha", "beta gamma", FOX];
        const expected = texts.reduce(
          (sum, t) => sum + encodingForModel("text-embedding-3-large").encode(t).length,
          0,
        );

        await expect(service.vectoriseTextBatch(texts, ATTRIBUTION)).rejects.toThrow("provider 500");

        expect(recorder.recordTokenUsage).toHaveBeenCalledTimes(1);
        const call = recorder.recordTokenUsage.mock.calls[0][0];
        expect(call.tokens).toEqual({ input: expected, output: 0 });
        expect(call.relationshipId).toBe("entity-id");
        expect(call.relationshipType).toBe("Document");
        expect(call.applyMinimum).toBe(false);
        expect(call.costOverride).toBe((expected * rate) / 1_000_000);
      });

      it("bills what a failed single-text call already burned and rethrows", async () => {
        const { service } = makeService({
          inputCostPer1MTokens: 0.13,
          recorder,
          embedderError: providerError(503),
        });

        await expect(service.vectoriseText({ text: FOX, attribution: ATTRIBUTION })).rejects.toThrow("provider 503");

        expect(recorder.recordTokenUsage).toHaveBeenCalledTimes(1);
        expect(recorder.recordTokenUsage.mock.calls[0][0].tokens).toEqual({ input: FOX_TIKTOKEN_TOKENS, output: 0 });
      });

      it("reads the status off error.response too", async () => {
        const nested = Object.assign(new Error("gateway"), { response: { status: 502 } });
        const { service } = makeService({ inputCostPer1MTokens: 0.13, recorder, embedderError: nested });

        await expect(service.vectoriseText({ text: FOX, attribution: ATTRIBUTION })).rejects.toThrow("gateway");

        expect(recorder.recordTokenUsage).toHaveBeenCalledTimes(1);
      });

      it("records NOTHING when the failed operation burned zero tokens", async () => {
        const { service } = makeService({
          inputCostPer1MTokens: 0.13,
          recorder,
          embedderError: providerError(500),
        });

        // An empty STRING still travels to the provider (one zero-token input);
        // an empty ARRAY would short-circuit before any provider call.
        await expect(service.vectoriseTextBatch([""], ATTRIBUTION)).rejects.toThrow("provider 500");

        expect(recorder.recordTokenUsage).not.toHaveBeenCalled();
      });

      it("records nothing on failure when the caller passed no attribution", async () => {
        const { service } = makeService({
          inputCostPer1MTokens: 0.13,
          recorder,
          embedderError: providerError(500),
        });

        await expect(service.vectoriseText({ text: FOX })).rejects.toThrow("provider 500");

        expect(recorder.recordTokenUsage).not.toHaveBeenCalled();
      });

      it("rethrows the ORIGINAL provider error even when the recorder also throws", async () => {
        recorder.recordTokenUsage.mockRejectedValue(new Error("neo4j down"));
        const { service } = makeService({
          inputCostPer1MTokens: 0.13,
          recorder,
          embedderError: providerError(500),
        });

        await expect(service.vectoriseText({ text: FOX, attribution: ATTRIBUTION })).rejects.toThrow("provider 500");
      });
    });

    describe("pre-provider failures — nothing was served, so nothing is billed", () => {
      it("records NOTHING when our own token bucket starves the call", async () => {
        // `RateLimitedEmbedder` throws this BEFORE any HTTP request: our bucket
        // could not grant within maxWaitMs. Zero provider work — billing it
        // would charge the customer for our own rate limiter.
        const starved = new EmbedderBucketStarvedError(1234, 60_000);
        const { service } = makeService({ inputCostPer1MTokens: 0.13, recorder, embedderError: starved });

        await expect(service.vectoriseTextBatch(["alpha", FOX], ATTRIBUTION)).rejects.toThrow(starved);

        expect(recorder.recordTokenUsage).not.toHaveBeenCalled();
      });

      it("records NOTHING on a connection-style failure (no HTTP exchange happened)", async () => {
        const refused = Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:443"), { code: "ECONNREFUSED" });
        const { service } = makeService({ inputCostPer1MTokens: 0.13, recorder, embedderError: refused });

        await expect(service.vectoriseText({ text: FOX, attribution: ATTRIBUTION })).rejects.toThrow("ECONNREFUSED");

        expect(recorder.recordTokenUsage).not.toHaveBeenCalled();
      });

      it("records NOTHING for a bare Error carrying no provider status", async () => {
        const { service } = makeService({
          inputCostPer1MTokens: 0.13,
          recorder,
          embedderError: new Error("something went wrong"),
        });

        await expect(service.vectoriseText({ text: FOX, attribution: ATTRIBUTION })).rejects.toThrow(
          "something went wrong",
        );

        expect(recorder.recordTokenUsage).not.toHaveBeenCalled();
      });
    });

    describe("provider REFUSED the request (4xx) — it served none of this input", () => {
      it.each([
        [400, "malformed request"],
        [401, "auth failure"],
        [403, "forbidden"],
        [413, "payload too large"],
        [429, "rate limit, retries exhausted"],
      ])("records NOTHING on %i (%s)", async (status) => {
        const { service } = makeService({
          inputCostPer1MTokens: 0.13,
          recorder,
          embedderError: providerError(status),
        });

        await expect(service.vectoriseTextBatch(["alpha", FOX], ATTRIBUTION)).rejects.toThrow(`provider ${status}`);

        expect(recorder.recordTokenUsage).not.toHaveBeenCalled();
      });
    });

    it("still returns vectors and bills normally when nothing fails", async () => {
      // Guards the guard: the gate above must not have made the SUCCESS path
      // conditional on an error that is never there.
      const { service } = makeService({ inputCostPer1MTokens: 0.13, recorder });

      await expect(service.vectoriseText({ text: FOX, attribution: ATTRIBUTION })).resolves.toEqual([0.1, 0.2]);

      expect(recorder.recordTokenUsage).toHaveBeenCalledTimes(1);
    });
  });
});

/**
 * text-embedding-3-large refuses any single input above 8192 tokens
 * (`400 Invalid 'input[0]': maximum input length is 8192 tokens`) — a real run
 * lost a whole document that way. EmbedderService is the choke point every
 * embedding path goes through, so it slices oversized inputs itself, embeds
 * each slice through the same (rate-limited) embedder and mean-pools the
 * vectors: callers keep getting exactly ONE vector per input.
 */
describe("EmbedderService oversize guard", () => {
  /** Precedent: audio.llm.service.spec.ts:422 spies the Nest logger the same way. */
  const spyOnWarn = () => vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes a text within the token budget through untouched", async () => {
    const warn = spyOnWarn();
    const { service, embedder } = makeService({});

    const result = await service.vectoriseText({ text: FOX });

    expect(tokensOf(FOX)).toBeLessThanOrEqual(MAX_EMBED_INPUT_TOKENS);
    expect(embedder.embedQuery).toHaveBeenCalledTimes(1);
    expect(embedder.embedQuery).toHaveBeenCalledWith(FOX);
    // Identical vector: no slicing, no pooling, no re-normalisation.
    expect(result).toEqual([0.1, 0.2]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("slices an oversized text, embeds every slice and returns one mean-pooled vector", async () => {
    spyOnWarn();
    const { service, embedder } = makeService({ embedder: makeTextEmbedder() });

    const result = await service.vectoriseText({ text: HUGE });

    expect(tokensOf(HUGE)).toBeGreaterThan(16_000);
    const slices = embedder.embedQuery.mock.calls.map((call) => call[0] as string);
    expect(slices.length).toBeGreaterThanOrEqual(3);
    for (const slice of slices) expect(tokensOf(slice)).toBeLessThanOrEqual(MAX_EMBED_INPUT_TOKENS);
    // Nothing dropped: the slices concatenate back to the original text.
    expect(slices.join("")).toBe(HUGE);

    // ONE vector back, equal to the L2-normalized mean of the slice vectors.
    const expected = poolOf(slices.map(vectorFor));
    expect(result).toHaveLength(expected.length);
    expected.forEach((value, i) => expect(result[i]).toBeCloseTo(value, 10));
    expect(Math.sqrt((result as number[]).reduce((sum, value) => sum + value * value, 0))).toBeCloseTo(1, 10);
  });

  it("keeps positional order in the batch path when sizes are mixed", async () => {
    spyOnWarn();
    const small = "beta gamma";
    const { service, embedder } = makeService({ embedder: makeTextEmbedder() });

    const result = await service.vectoriseTextBatch([FOX, HUGE, small]);

    // The within-budget texts still travel in ONE provider batch, in order.
    expect(embedder.embedDocuments).toHaveBeenCalledTimes(1);
    expect(embedder.embedDocuments).toHaveBeenCalledWith([FOX, small]);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual(vectorFor(FOX));
    expect(result[2]).toEqual(vectorFor(small));

    const slices = embedder.embedQuery.mock.calls.map((call) => call[0] as string);
    expect(slices.length).toBeGreaterThanOrEqual(3);
    expect(slices.join("")).toBe(HUGE);
    poolOf(slices.map(vectorFor)).forEach((value, i) => expect(result[1][i]).toBeCloseTo(value, 10));
  });

  it("logs one WARN per oversized text, naming the size and the attribution", async () => {
    const warn = spyOnWarn();
    const { service } = makeService({ embedder: makeTextEmbedder() });

    await service.vectoriseTextBatch([FOX, HUGE, HUGE], ATTRIBUTION);

    expect(warn).toHaveBeenCalledTimes(2);
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain(String(tokensOf(HUGE)));
    expect(message).toContain(String(HUGE.length));
    expect(message).toContain("Document");
    expect(message).toContain("entity-id");
  });

  it("bills the ORIGINAL text once — usage accounting ignores the slicing", async () => {
    spyOnWarn();
    const recorder = { recordTokenUsage: vi.fn(async () => undefined) };
    const { service } = makeService({
      inputCostPer1MTokens: 0.13,
      recorder,
      embedder: makeTextEmbedder(),
    });

    await service.vectoriseText({ text: HUGE, attribution: ATTRIBUTION });

    expect(recorder.recordTokenUsage).toHaveBeenCalledTimes(1);
    expect(recorder.recordTokenUsage.mock.calls[0][0].tokens).toEqual({ input: tokensOf(HUGE), output: 0 });
  });
});
