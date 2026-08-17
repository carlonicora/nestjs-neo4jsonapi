import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { ImageLLMService } from "../image.llm.service";
import { ContentModerationError } from "../vision.llm.service";

describe("ImageLLMService", () => {
  let service: ImageLLMService;
  let configService: { get: Mock };
  let fetchMock: Mock;

  const buildImageConfig = (overrides: Partial<Record<string, unknown>> = {}) => ({
    provider: "openrouter",
    apiKey: "sk-image-test",
    model: "google/gemini-3.1-flash-lite-image",
    url: "https://openrouter.ai/api/v1",
    inputCostPer1MTokens: 0.3,
    outputCostPer1MTokens: 2.5,
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

  /** The canonical happy-path provider payload from the plan's case list. */
  const imageResponse = (url = "data:image/png;base64,AAA") => ({
    ...imageChoices(url),
    usage: { prompt_tokens: 12, completion_tokens: 1290 },
  });

  beforeEach(async () => {
    vi.clearAllMocks();

    configService = { get: vi.fn().mockReturnValue({ image: buildImageConfig() }) };
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    // The service logs upstream failures at error level; keep the suite quiet.
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [ImageLLMService, { provide: ConfigService, useValue: configService }],
    }).compile();

    service = moduleRef.get(ImageLLMService);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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

    it("strips trailing slashes from the configured url before appending the path", async () => {
      configService.get.mockReturnValue({ image: buildImageConfig({ url: "https://openrouter.ai/api/v1///" }) });
      fetchMock.mockResolvedValueOnce(okResponse(imageResponse()));

      await service.generate({ prompt: "p" });

      expect(fetchMock.mock.calls[0][0]).toBe("https://openrouter.ai/api/v1/chat/completions");
    });

    it("fails fast, without calling the provider, when the image config is incomplete", async () => {
      configService.get.mockReturnValue({ image: buildImageConfig({ model: "" }) });

      await expect(service.generate({ prompt: "p" })).rejects.toThrow(
        "Image generation is not configured: missing IMAGE_MODEL",
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("success path", () => {
    it("returns the data URL, the mime type parsed from its prefix, and the usage counts", async () => {
      fetchMock.mockResolvedValueOnce(okResponse(imageResponse()));

      const result = await service.generate({ prompt: "p", aspectRatio: "1:1" });

      expect(result).toEqual({
        imageBase64: "data:image/png;base64,AAA",
        mimeType: "image/png",
        tokenUsage: { input: 12, output: 1290 },
      });
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

    it("rejects on a non-retryable HTTP 500 without exhausting the retry budget", async () => {
      fetchMock.mockResolvedValue(errorResponse(500, "upstream exploded"));

      await expect(service.generate({ prompt: "p" })).rejects.toThrow("HTTP 500 — upstream exploded");

      // A 500 is not a rate limit, so withRetry rethrows on the first attempt.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("rate-limit retry", () => {
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

      await expect(pending).resolves.toEqual({
        imageBase64: "data:image/png;base64,AAA",
        mimeType: "image/png",
        tokenUsage: { input: 12, output: 1290 },
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("gives up after MAX_RETRIES consecutive rate limits", async () => {
      fetchMock.mockResolvedValue(errorResponse(429, "rate limited"));

      const pending = service.generate({ prompt: "p" });
      const settled = expect(pending).rejects.toThrow("HTTP 429 — rate limited");

      // Backoffs are 1s, 2s, 4s, 8s (+jitter) between the 5 attempts.
      await vi.advanceTimersByTimeAsync(20_000);
      await settled;

      expect(fetchMock).toHaveBeenCalledTimes(5);
    });
  });
});
