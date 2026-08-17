import { Logger } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { ResolvedAiCandidate } from "../../interfaces/ai-candidate.interface";
import { ImageLLMService } from "../image.llm.service";
import { ModelService } from "../model.service";
import { ContentModerationError } from "../vision.llm.service";

describe("ImageLLMService", () => {
  let service: ImageLLMService;
  let modelService: { getCandidatesForType: Mock; notifyCandidateFailure: Mock };
  let fetchMock: Mock;

  /**
   * One link of the "image" connection chain. Defaults to the env link; a test
   * that needs a DB-configured connection overrides `source`/`connectionId`.
   */
  const makeCandidate = (overrides: Partial<ResolvedAiCandidate> = {}): ResolvedAiCandidate => ({
    source: "env",
    connectionId: "env:image",
    connectionType: "image",
    provider: "openrouter",
    apiKey: "sk-image-test",
    model: "google/gemini-3.1-flash-lite-image",
    url: "https://openrouter.ai/api/v1",
    inputCostPer1MTokens: 0.25,
    outputCostPer1MTokens: 30,
    ...overrides,
  });

  /** A 200 carrying an arbitrary JSON body. */
  const okResponse = (body: unknown) =>
    ({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    }) as unknown as Response;

  /** A non-2xx response; the service reads `.text()` for the error message. */
  const errorResponse = (status: number, bodyText: string) =>
    ({
      ok: false,
      status,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve(bodyText),
    }) as unknown as Response;

  /** The image half of a provider payload, without any `usage` block. */
  const imageChoices = (url = "data:image/png;base64,AAA") => ({
    choices: [{ message: { images: [{ image_url: { url } }] } }],
  });

  /** The canonical happy-path provider payload. */
  const imageResponse = (url = "data:image/png;base64,AAA") => ({
    ...imageChoices(url),
    usage: { prompt_tokens: 12, completion_tokens: 1290 },
  });

  beforeEach(async () => {
    vi.clearAllMocks();

    modelService = {
      getCandidatesForType: vi.fn().mockReturnValue([makeCandidate()]),
      notifyCandidateFailure: vi.fn(),
    };
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    // The service logs upstream failures at error level; keep the suite quiet.
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [ImageLLMService, { provide: ModelService, useValue: modelService }],
    }).compile();

    service = moduleRef.get(ImageLLMService);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("connection resolution", () => {
    it('resolves the chain for the "image" connection type — never the chat tiers', async () => {
      fetchMock.mockResolvedValueOnce(okResponse(imageResponse()));

      await service.generate({ prompt: "p" });

      expect(modelService.getCandidatesForType).toHaveBeenCalledWith("image");
    });

    it("serves from the FIRST link of the chain (a DB connection outranks env)", async () => {
      const db = makeCandidate({
        source: "db",
        connectionId: "conn-1",
        apiKey: "sk-db",
        model: "db/model",
        url: "https://db.example.com/v1",
      });
      modelService.getCandidatesForType.mockReturnValue([db, makeCandidate()]);
      fetchMock.mockResolvedValueOnce(okResponse(imageResponse()));

      await service.generate({ prompt: "p" });

      const [endpoint, init] = fetchMock.mock.calls[0];
      expect(endpoint).toBe("https://db.example.com/v1/chat/completions");
      expect(init.headers.Authorization).toBe("Bearer sk-db");
      expect(JSON.parse(init.body).model).toBe("db/model");
    });

    it("skips unusable links (no model / no url) instead of calling them", async () => {
      const bare = makeCandidate({ model: "", url: "" });
      modelService.getCandidatesForType.mockReturnValue([bare, makeCandidate()]);
      fetchMock.mockResolvedValueOnce(okResponse(imageResponse()));

      await service.generate({ prompt: "p" });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe("https://openrouter.ai/api/v1/chat/completions");
    });

    it("fails fast, without calling any provider, when no link of the chain is usable", async () => {
      modelService.getCandidatesForType.mockReturnValue([makeCandidate({ model: "", url: "" })]);

      await expect(service.generate({ prompt: "p" })).rejects.toThrow(
        /Image generation is not configured.*does not fall back to the AI_\*/s,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("request shape", () => {
    it("POSTs to `${url}/chat/completions` with bearer auth, model, messages and image modalities", async () => {
      fetchMock.mockResolvedValueOnce(okResponse(imageResponse()));

      await service.generate({ prompt: "a lantern-lit archive", aspectRatio: "16:9" });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [endpoint, init] = fetchMock.mock.calls[0];

      expect(endpoint).toBe("https://openrouter.ai/api/v1/chat/completions");
      expect(init.method).toBe("POST");
      expect(init.headers).toEqual({
        Authorization: "Bearer sk-image-test",
        "Content-Type": "application/json",
      });

      expect(JSON.parse(init.body)).toEqual({
        model: "google/gemini-3.1-flash-lite-image",
        modalities: ["image", "text"],
        messages: [{ role: "user", content: "a lantern-lit archive" }],
        image_config: { aspect_ratio: "16:9" },
      });
    });

    it("omits the Authorization header when the connection has no api key (custom endpoints)", async () => {
      modelService.getCandidatesForType.mockReturnValue([makeCandidate({ apiKey: "" })]);
      fetchMock.mockResolvedValueOnce(okResponse(imageResponse()));

      await service.generate({ prompt: "p" });

      expect(fetchMock.mock.calls[0][1].headers).toEqual({ "Content-Type": "application/json" });
    });

    it("carries the aspect ratio as image_config.aspect_ratio when one is passed", async () => {
      fetchMock.mockResolvedValueOnce(okResponse(imageResponse()));

      await service.generate({ prompt: "p", aspectRatio: "2:3" });

      expect(JSON.parse(fetchMock.mock.calls[0][1].body).image_config).toEqual({ aspect_ratio: "2:3" });
    });

    it("omits image_config entirely when no aspect ratio is passed (no service-level default)", async () => {
      fetchMock.mockResolvedValueOnce(okResponse(imageResponse()));

      await service.generate({ prompt: "p" });

      // The "1:1" default lives at the CALLER (ImageGenerationService resolves
      // `campaign.imageAspectRatio ?? "1:1"`), not here: with no ratio the
      // service sends no image_config at all so the provider default applies.
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body).not.toHaveProperty("image_config");
    });

    it("strips trailing slashes from the connection url before appending the path", async () => {
      modelService.getCandidatesForType.mockReturnValue([makeCandidate({ url: "https://openrouter.ai/api/v1///" })]);
      fetchMock.mockResolvedValueOnce(okResponse(imageResponse()));

      await service.generate({ prompt: "p" });

      expect(fetchMock.mock.calls[0][0]).toBe("https://openrouter.ai/api/v1/chat/completions");
    });
  });

  describe("success path", () => {
    it("returns the data URL, the mime type parsed from its prefix, and the usage counts", async () => {
      fetchMock.mockResolvedValueOnce(okResponse(imageResponse()));

      const result = await service.generate({ prompt: "p", aspectRatio: "1:1" });

      expect(result.imageBase64).toBe("data:image/png;base64,AAA");
      expect(result.mimeType).toBe("image/png");
      expect(result.tokenUsage).toEqual({ input: 12, output: 1290 });
    });

    it("derives the mime type from the data URL rather than assuming png", async () => {
      fetchMock.mockResolvedValueOnce(okResponse(imageResponse("data:image/webp;base64,BBB")));

      const result = await service.generate({ prompt: "p" });

      expect(result.mimeType).toBe("image/webp");
      expect(result.imageBase64).toBe("data:image/webp;base64,BBB");
    });

    it("falls back to { input: 0, output: 0 } when the response carries no usage block", async () => {
      fetchMock.mockResolvedValueOnce(okResponse(imageChoices()));

      const result = await service.generate({ prompt: "p" });

      expect(result.tokenUsage).toEqual({ input: 0, output: 0 });
    });

    it("falls back per-field when usage is present but partial", async () => {
      fetchMock.mockResolvedValueOnce(okResponse({ ...imageChoices(), usage: { prompt_tokens: 7 } }));

      const result = await service.generate({ prompt: "p" });

      expect(result.tokenUsage).toEqual({ input: 7, output: 0 });
    });

    it("passes through the provider's actual charge as `cost` (OpenRouter usage accounting)", async () => {
      fetchMock.mockResolvedValueOnce(
        okResponse({ ...imageChoices(), usage: { prompt_tokens: 12, completion_tokens: 1290, cost: 0.0336 } }),
      );

      const result = await service.generate({ prompt: "p" });

      expect(result.cost).toBe(0.0336);
    });

    it("leaves `cost` undefined when the provider reports none or a non-numeric value", async () => {
      fetchMock
        .mockResolvedValueOnce(okResponse(imageResponse()))
        .mockResolvedValueOnce(
          okResponse({ ...imageChoices(), usage: { prompt_tokens: 1, completion_tokens: 2, cost: "0.03" } }),
        );

      // No cost field at all → undefined, so the caller's costOverride path
      // falls back to token-based pricing.
      expect((await service.generate({ prompt: "p" })).cost).toBeUndefined();
      // A malformed (non-number) cost must degrade the same way, not poison
      // the override with a string.
      expect((await service.generate({ prompt: "p" })).cost).toBeUndefined();
    });

    it("reports the SERVING connection's rates for fallback pricing", async () => {
      fetchMock.mockResolvedValueOnce(okResponse(imageResponse()));

      const result = await service.generate({ prompt: "p" });

      expect(result.rates).toEqual({ inputCostPer1MTokens: 0.25, outputCostPer1MTokens: 30 });
    });

    it("leaves `rates` undefined when the serving connection declares no costs", async () => {
      modelService.getCandidatesForType.mockReturnValue([
        makeCandidate({ inputCostPer1MTokens: undefined, outputCostPer1MTokens: undefined }),
      ]);
      fetchMock.mockResolvedValueOnce(okResponse(imageResponse()));

      const result = await service.generate({ prompt: "p" });

      // Undefined (not zeros): the caller must be able to tell "no rates
      // configured on this connection" apart from "rates of zero".
      expect(result.rates).toBeUndefined();
    });
  });

  describe("failure paths", () => {
    it("rejects with the provider response when the payload carries no image", async () => {
      fetchMock.mockResolvedValueOnce(okResponse({ choices: [{ message: { content: "I cannot do that." } }] }));

      await expect(service.generate({ prompt: "p" })).rejects.toThrow(
        /Image generation returned no image\. Provider response:.*I cannot do that\./s,
      );
    });

    it("rejects when the provider returns a remote URL instead of a base64 data URL", async () => {
      fetchMock.mockResolvedValueOnce(okResponse(imageResponse("https://cdn.example.com/img.png")));

      await expect(service.generate({ prompt: "p" })).rejects.toThrow(
        "Image generation returned an unexpected image payload (expected a base64 data URL)",
      );
    });

    it("raises ContentModerationError when a refusal mentions a content policy", async () => {
      fetchMock.mockResolvedValue(
        okResponse({ choices: [{ message: { content: "Refused: this violates our content policy." } }] }),
      );

      await expect(service.generate({ prompt: "p" })).rejects.toThrow(ContentModerationError);
      await expect(service.generate({ prompt: "p" })).rejects.toThrow(/blocked by content moderation/);
    });

    it("raises ContentModerationError when the refusal marker arrives in the error field", async () => {
      fetchMock.mockResolvedValue(okResponse({ choices: [{ message: {} }], error: { reason: "SAFETY" } }));

      await expect(service.generate({ prompt: "p" })).rejects.toThrow(ContentModerationError);
    });

    it("rejects on a non-retryable HTTP 500 without exhausting the retry budget or cooling anything down", async () => {
      fetchMock.mockResolvedValue(errorResponse(500, "upstream exploded"));

      await expect(service.generate({ prompt: "p" })).rejects.toThrow("HTTP 500 — upstream exploded");

      // A 500 is not a rate limit, so withRetry rethrows on the first attempt.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(modelService.notifyCandidateFailure).not.toHaveBeenCalled();
    });
  });

  describe("rate-limit retry and failover", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("retries after an HTTP 429 and resolves once the provider recovers", async () => {
      fetchMock
        .mockResolvedValueOnce(errorResponse(429, "rate limited"))
        .mockResolvedValueOnce(okResponse(imageResponse()));

      const pending = service.generate({ prompt: "p", aspectRatio: "1:1" });

      // First backoff is 1s + up to 500ms jitter; 2s covers it without reaching
      // the 120s call timeout.
      await vi.advanceTimersByTimeAsync(2_000);

      const result = await pending;
      expect(result.imageBase64).toBe("data:image/png;base64,AAA");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("cools the rate-limited connection down and fails over to the next link of the chain", async () => {
      const first = makeCandidate({
        source: "db",
        connectionId: "conn-1",
        apiKey: "sk-db",
        model: "db/model",
        url: "https://db.example.com/v1",
      });
      const second = makeCandidate();
      modelService.getCandidatesForType.mockReturnValue([first, second]);
      fetchMock
        .mockResolvedValueOnce(errorResponse(429, "rate limited"))
        .mockResolvedValueOnce(okResponse(imageResponse()));

      const pending = service.generate({ prompt: "p" });
      await vi.advanceTimersByTimeAsync(2_000);
      await pending;

      expect(modelService.notifyCandidateFailure).toHaveBeenCalledWith(first);
      // Attempt 0 hit the DB connection, attempt 1 the env link.
      expect(fetchMock.mock.calls[0][0]).toBe("https://db.example.com/v1/chat/completions");
      expect(fetchMock.mock.calls[1][0]).toBe("https://openrouter.ai/api/v1/chat/completions");
      expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer sk-image-test");
    });

    it("gives up after MAX_RETRIES consecutive rate limits, cooling the connection down each time", async () => {
      fetchMock.mockResolvedValue(errorResponse(429, "rate limited"));

      const pending = service.generate({ prompt: "p" });
      const settled = expect(pending).rejects.toThrow("HTTP 429 — rate limited");

      // Backoffs are 1s, 2s, 4s, 8s (+jitter) between the 5 attempts.
      await vi.advanceTimersByTimeAsync(20_000);
      await settled;

      expect(fetchMock).toHaveBeenCalledTimes(5);
      // Marked on every attempt INCLUDING the last: the cooldown outlives the
      // call so the next request starts on a healthier connection.
      expect(modelService.notifyCandidateFailure).toHaveBeenCalledTimes(5);
    });
  });
});
