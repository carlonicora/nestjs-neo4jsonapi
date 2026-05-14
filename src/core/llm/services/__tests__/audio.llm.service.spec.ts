import { vi, describe, it, expect, beforeEach, beforeAll, afterAll, afterEach, type Mock } from "vitest";
import { Test, type TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AudioLLMService } from "../audio.llm.service";
import { LLMCallDumper } from "../llm-call-dumper.service";
import { ModelService } from "../model.service";
import { transcodeForDirect } from "../audio/ffmpeg-transcode";

// Mock the ffmpeg helper so we never actually run ffmpeg in tests.
vi.mock("../audio/ffmpeg-transcode", () => ({
  transcodeForDirect: vi.fn(),
}));
const mockedTranscodeForDirect = vi.mocked(transcodeForDirect);

describe("AudioLLMService", () => {
  let service: AudioLLMService;
  let configService: { get: Mock };
  let modelService: { getAudioLLM: Mock };
  let dumper: { startSession: Mock };
  let dumpSession: {
    isEnabled: boolean;
    recordInputs: Mock;
    startIteration: Mock;
    recordResponse: Mock;
    recordToolResult: Mock;
    close: Mock;
  };

  // Universal transcode now fires for BOTH branches, so the temp mp3 needs to
  // exist for the whole suite (any test that hits service.call needs it).
  let tmpDir: string;
  let tmpMp3: string;

  const buildAudioConfig = (overrides: Partial<Record<string, unknown>> = {}) => ({
    provider: "openrouter",
    apiKey: "key",
    model: "google/gemini-2.5-flash",
    url: "",
    region: "",
    secret: "",
    instance: "",
    apiVersion: "",
    inputCostPer1MTokens: 0,
    outputCostPer1MTokens: 0,
    directUrl: undefined as string | undefined,
    language: undefined as string | undefined,
    ...overrides,
  });

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "vitest-audio-"));
    tmpMp3 = join(tmpDir, "test.mp3");
    writeFileSync(tmpMp3, "fake-mp3-bytes");
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    vi.clearAllMocks();

    dumpSession = {
      isEnabled: true,
      recordInputs: vi.fn(),
      startIteration: vi.fn(),
      recordResponse: vi.fn(),
      recordToolResult: vi.fn(),
      close: vi.fn(),
    };

    configService = { get: vi.fn() };
    modelService = { getAudioLLM: vi.fn() };
    dumper = { startSession: vi.fn().mockReturnValue(dumpSession) };

    // Default: transcode succeeds and points at the shared temp file. Tests
    // that exercise ffmpeg failure override with mockRejectedValueOnce.
    mockedTranscodeForDirect.mockResolvedValue({
      path: tmpMp3,
      durationSeconds: 12.5,
      cleanup: vi.fn().mockResolvedValue(undefined),
    });

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        AudioLLMService,
        { provide: ConfigService, useValue: configService },
        { provide: ModelService, useValue: modelService },
        { provide: LLMCallDumper, useValue: dumper },
      ],
    }).compile();

    service = moduleRef.get(AudioLLMService);
  });

  // ─────────────── Universal transcode (applies to BOTH branches) ───────────────

  describe("universal ffmpeg transcode", () => {
    it("runs ffmpeg even when audio.directUrl is unset (chat-LLM branch)", async () => {
      configService.get.mockReturnValue({ audio: buildAudioConfig({ directUrl: undefined }) });
      modelService.getAudioLLM.mockReturnValue({
        invoke: vi.fn().mockResolvedValue({
          content: "hi",
          usage_metadata: { input_tokens: 1, output_tokens: 1 },
        }),
      });

      await service.call({ audioPath: "/tmp/stem.ogg", prompt: "p" });

      expect(mockedTranscodeForDirect).toHaveBeenCalledWith("/tmp/stem.ogg");
    });

    it("wraps ffmpeg failures with the canonical prefix regardless of branch", async () => {
      mockedTranscodeForDirect.mockRejectedValueOnce(new Error("ffmpeg exited 1: bad codec"));
      configService.get.mockReturnValue({ audio: buildAudioConfig({ directUrl: undefined }) });

      await expect(service.call({ audioPath: "/tmp/stem.ogg", prompt: "p" })).rejects.toThrow(
        "Audio LLM service error: ffmpeg failed: ffmpeg exited 1: bad codec",
      );
    });

    it("cleans up the transcoded mp3 even when the chat-LLM call throws", async () => {
      const cleanup = vi.fn().mockResolvedValue(undefined);
      mockedTranscodeForDirect.mockResolvedValueOnce({
        path: tmpMp3,
        durationSeconds: 3,
        cleanup,
      });
      configService.get.mockReturnValue({ audio: buildAudioConfig({ directUrl: undefined }) });
      modelService.getAudioLLM.mockImplementation(() => {
        throw new Error("boom");
      });

      await expect(service.call({ audioPath: "/tmp/stem.ogg", prompt: "p" })).rejects.toThrow(
        "Audio LLM service error: boom",
      );
      expect(cleanup).toHaveBeenCalled();
    });
  });

  // ─────────────── Chat-LLM branch (audio.directUrl unset) ───────────────

  describe("chat-LLM branch (audio.directUrl unset)", () => {
    beforeEach(() => {
      configService.get.mockReturnValue({ audio: buildAudioConfig({ directUrl: undefined }) });
    });

    it("sends input_audio with format=mp3 (post-transcode) and returns text from response.content", async () => {
      const invoke = vi.fn().mockResolvedValue({
        content: "hello world",
        usage_metadata: { input_tokens: 12, output_tokens: 3 },
        response_metadata: { finish_reason: "stop" },
      });
      modelService.getAudioLLM.mockReturnValue({ invoke });

      const result = await service.call({ audioPath: "/tmp/x.ogg", prompt: "system prompt" });

      expect(result).toEqual({
        text: "hello world",
        tokenUsage: { input: 12, output: 3 },
        audioSeconds: 12.5,
      });

      // Two-message shape: SystemMessage with the prompt, then HumanMessage with
      // only the input_audio content part (audio-chat models like OpenAI
      // gpt-audio-mini refuse to transcribe when the prompt is mixed into the
      // user message).
      const sentMessages = invoke.mock.calls[0][0] as Array<{
        _getType?: () => string;
        content: unknown;
      }>;
      expect(sentMessages).toHaveLength(2);
      expect(sentMessages[0]._getType?.()).toBe("system");
      expect(sentMessages[0].content).toBe("system prompt");
      expect(sentMessages[1]._getType?.()).toBe("human");

      const userContent = sentMessages[1].content as Array<{ type: string; input_audio?: { format: string } }>;
      expect(userContent).toHaveLength(1);
      expect(userContent[0].type).toBe("input_audio");
      expect(userContent[0].input_audio?.format).toBe("mp3");
    });

    it("flattens array content (Gemini-style) to a single text string", async () => {
      const invoke = vi.fn().mockResolvedValue({
        content: [
          { type: "text", text: "hello " },
          { type: "text", text: "world" },
        ],
        usage_metadata: { input_tokens: 5, output_tokens: 2 },
      });
      modelService.getAudioLLM.mockReturnValue({ invoke });

      const result = await service.call({ audioPath: "/tmp/x.ogg", prompt: "p" });
      expect(result.text).toBe("hello world");
    });

    it("returns empty string when the model produces no content", async () => {
      modelService.getAudioLLM.mockReturnValue({
        invoke: vi.fn().mockResolvedValue({ content: undefined, usage_metadata: {} }),
      });

      const result = await service.call({ audioPath: "/tmp/x.ogg", prompt: "p" });
      expect(result.text).toBe("");
    });

    it("wraps LLM errors with the canonical prefix", async () => {
      modelService.getAudioLLM.mockImplementation(() => {
        throw new Error("boom");
      });

      await expect(service.call({ audioPath: "/tmp/x.ogg", prompt: "p" })).rejects.toThrow(
        "Audio LLM service error: boom",
      );
    });
  });

  // ─────────────── Direct branch (audio.directUrl set) ───────────────

  describe("direct branch (audio.directUrl set)", () => {
    let fetchMock: Mock;

    beforeEach(() => {
      fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    const okResponse = (body: unknown) =>
      ({
        ok: true,
        status: 200,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
      }) as unknown as Response;

    it("POSTs multipart to the configured URL and returns audioSeconds", async () => {
      configService.get.mockReturnValue({
        audio: buildAudioConfig({
          directUrl: "https://api.openai.com/v1/audio/transcriptions",
          provider: "openrouter", // intentionally NOT openai — verify no whitelist
          apiKey: "sk-test",
          model: "gpt-4o-mini-transcribe",
          language: "en",
        }),
      });
      fetchMock.mockResolvedValue(okResponse({ text: "spoken words" }));

      const result = await service.call({
        audioPath: "/tmp/stem.ogg",
        prompt: "Bias toward: Elric, Tamsin.",
      });

      expect(mockedTranscodeForDirect).toHaveBeenCalledWith("/tmp/stem.ogg");
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
      expect(init.method).toBe("POST");
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
      expect(init.body).toBeInstanceOf(FormData);

      const form = init.body as FormData;
      expect(form.get("model")).toBe("gpt-4o-mini-transcribe");
      expect(form.get("prompt")).toBe("Bias toward: Elric, Tamsin.");
      expect(form.get("language")).toBe("en");
      expect(form.get("temperature")).toBe("0.1");
      expect(form.get("response_format")).toBe("json");
      expect(form.get("file")).toBeInstanceOf(Blob);

      expect(result).toEqual({
        text: "spoken words",
        tokenUsage: { input: 0, output: 0 },
        audioSeconds: 12.5,
      });
    });

    it("omits language from the form body when audio.language is unset", async () => {
      configService.get.mockReturnValue({
        audio: buildAudioConfig({
          directUrl: "https://example.test/v1/audio/transcriptions",
          apiKey: "k",
          model: "whisper-1",
          language: undefined,
        }),
      });
      fetchMock.mockResolvedValue(okResponse({ text: "ok" }));

      await service.call({ audioPath: "/tmp/stem.ogg", prompt: "p" });

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const form = init.body as FormData;
      expect(form.has("language")).toBe(false);
    });

    it("cleans up the transcoded mp3 even on non-2xx response", async () => {
      const cleanup = vi.fn().mockResolvedValue(undefined);
      mockedTranscodeForDirect.mockResolvedValueOnce({
        path: tmpMp3,
        durationSeconds: 3,
        cleanup,
      });
      configService.get.mockReturnValue({
        audio: buildAudioConfig({
          directUrl: "https://example.test/v1/audio/transcriptions",
          apiKey: "k",
          model: "whisper-1",
        }),
      });
      fetchMock.mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve("unauthorized"),
      } as unknown as Response);

      await expect(service.call({ audioPath: "/tmp/stem.ogg", prompt: "p" })).rejects.toThrow(
        "Audio LLM service error: HTTP 401 — unauthorized",
      );
      expect(cleanup).toHaveBeenCalled();
    });

    it("returns empty text gracefully when the upstream JSON has no `text` field", async () => {
      configService.get.mockReturnValue({
        audio: buildAudioConfig({
          directUrl: "https://example.test/v1/audio/transcriptions",
          apiKey: "k",
        }),
      });
      fetchMock.mockResolvedValue(okResponse({}));

      const result = await service.call({ audioPath: "/tmp/stem.ogg", prompt: "p" });
      expect(result.text).toBe("");
    });
  });
});
