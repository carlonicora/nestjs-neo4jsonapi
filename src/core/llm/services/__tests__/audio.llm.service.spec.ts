import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { z } from "zod";
import { AudioLLMService } from "../audio.llm.service";
import { LLMCallDumper } from "../llm-call-dumper.service";
import { ModelService } from "../model.service";

describe("AudioLLMService", () => {
  let service: AudioLLMService;
  let modelService: { getAudioLLM: Mock };
  let dumper: { startSession: Mock };
  let configService: { get: Mock };
  let tempAudioPath: string;

  beforeEach(async () => {
    tempAudioPath = path.join(os.tmpdir(), `audio-test-${Date.now()}.wav`);
    fs.writeFileSync(tempAudioPath, Buffer.from([0x01, 0x02, 0x03, 0x04]));

    modelService = { getAudioLLM: vi.fn() };
    dumper = {
      startSession: vi.fn().mockReturnValue({
        recordResponse: vi.fn(),
        recordInputs: vi.fn(),
        startIteration: vi.fn(),
        close: vi.fn(),
      }),
    };
    configService = {
      get: vi.fn().mockReturnValue({
        audio: { provider: "openrouter", model: "google/gemini-2.5-flash" },
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AudioLLMService,
        { provide: ModelService, useValue: modelService },
        { provide: LLMCallDumper, useValue: dumper },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = moduleRef.get(AudioLLMService);
  });

  afterEach(() => {
    if (fs.existsSync(tempAudioPath)) fs.unlinkSync(tempAudioPath);
  });

  it("returns parsed structured output with token usage on success", async () => {
    const mockStructured = {
      invoke: vi.fn().mockResolvedValue({
        parsed: { text: "Hello world." },
        raw: {
          content: '{"text": "Hello world."}',
          usage_metadata: { input_tokens: 100, output_tokens: 5 },
        },
      }),
    };
    const mockBase = { withStructuredOutput: vi.fn().mockReturnValue(mockStructured) };
    modelService.getAudioLLM.mockReturnValue(mockBase);

    const result = await service.call({
      audioPath: tempAudioPath,
      mimeType: "audio/wav",
      systemPrompt: "Transcribe.",
      outputSchema: z.object({ text: z.string() }),
    });

    expect(result.text).toBe("Hello world.");
    expect(result.tokenUsage).toEqual({ input: 100, output: 5 });
  });

  it("propagates rate-limit errors to the caller (BullMQ owns retries)", async () => {
    const mockStructured = {
      invoke: vi.fn().mockRejectedValue(new Error("429 rate limit exceeded")),
    };
    const mockBase = { withStructuredOutput: vi.fn().mockReturnValue(mockStructured) };
    modelService.getAudioLLM.mockReturnValue(mockBase);

    await expect(
      service.call({
        audioPath: tempAudioPath,
        mimeType: "audio/wav",
        systemPrompt: "Transcribe.",
        outputSchema: z.object({ text: z.string() }),
      }),
    ).rejects.toThrow(/Audio LLM service error/);
    expect(mockStructured.invoke).toHaveBeenCalledTimes(1);
  });

  it("uses sanitized schema when model is Gemini", async () => {
    const mockStructured = {
      invoke: vi.fn().mockResolvedValue({
        parsed: { text: "x" },
        raw: { usage_metadata: { input_tokens: 1, output_tokens: 1 } },
      }),
    };
    const mockBase = { withStructuredOutput: vi.fn().mockReturnValue(mockStructured) };
    modelService.getAudioLLM.mockReturnValue(mockBase);

    await service.call({
      audioPath: tempAudioPath,
      mimeType: "audio/wav",
      systemPrompt: "x",
      outputSchema: z.object({ text: z.string() }),
    });

    expect(mockBase.withStructuredOutput).toHaveBeenCalled();
    const arg = mockBase.withStructuredOutput.mock.calls[0][0];
    // Sanitized schema does not retain $schema or $defs from JSON Schema draft conversion.
    expect(JSON.stringify(arg)).not.toContain("$schema");
  });

  it("throws on permanent errors", async () => {
    const mockStructured = {
      invoke: vi.fn().mockRejectedValue(new Error("400 invalid_request")),
    };
    const mockBase = { withStructuredOutput: vi.fn().mockReturnValue(mockStructured) };
    modelService.getAudioLLM.mockReturnValue(mockBase);

    await expect(
      service.call({
        audioPath: tempAudioPath,
        mimeType: "audio/wav",
        systemPrompt: "x",
        outputSchema: z.object({ text: z.string() }),
      }),
    ).rejects.toThrow(/Audio LLM service error/);
  });
});
