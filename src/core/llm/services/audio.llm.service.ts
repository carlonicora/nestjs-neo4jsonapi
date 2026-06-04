import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as fs from "fs";
import { BaseConfigInterface, ConfigAiInterface } from "../../../config/interfaces";
import { transcodeForDirect, type TranscodeOptions, type TranscodeResult } from "./audio/ffmpeg-transcode";
import { DumpSession, LLMCallDumper } from "./llm-call-dumper.service";
import { ModelService } from "./model.service";

/**
 * Parameters for AudioLLMService.call. Engine-agnostic: the service decides
 * how to use `prompt` based on whether audio.directUrl is configured.
 */
export interface AudioCallParams {
  audioPath: string;
  /**
   * Free-form prompt. Caller sizes/shapes it for the configured engine:
   *   - audio.directUrl unset → used verbatim as the chat-LLM system prompt
   *   - audio.directUrl set   → passed as the /audio/transcriptions `prompt`
   *     parameter; the upstream API typically truncates at ~224 tokens and
   *     treats it as vocabulary biasing (no instruction-following).
   */
  prompt: string;
  temperature?: number;
  /**
   * Optional in-pass audio cleanup applied during the universal transcode
   * (high-pass, silence trim). Omit for the plain resample. See TranscodeOptions.
   */
  transcode?: TranscodeOptions;
}

export interface TranscriptionResult {
  text: string;
  /** {0, 0} when audio.directUrl is set — /audio/transcriptions returns no tokens. */
  tokenUsage: { input: number; output: number };
  /** Duration of the audio actually sent (from ffmpeg's Duration line). */
  audioSeconds: number;
}

/**
 * LangChain AIMessage shape we consume from `BaseChatModel.invoke(...)`.
 * `.content` is either a single string or an array of content parts (Gemini
 * sometimes returns the latter); we coerce both into a plain transcript.
 */
interface ChatInvokeResponse {
  content?: string | Array<{ type: string; text?: string }>;
  usage_metadata?: { input_tokens?: number; output_tokens?: number };
  response_metadata?: { finish_reason?: string; [k: string]: unknown };
}

function extractText(content: ChatInvokeResponse["content"]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c) => c?.type === "text" && typeof c.text === "string")
      .map((c) => c.text as string)
      .join("");
  }
  return "";
}

/**
 * Audio transcription facade. One env var (AUDIO_DIRECT_URL) flips dispatch
 * between two unrelated backends. The ffmpeg transcode to 16 kHz mono mp3 runs
 * for **both** backends (universal pre-normalisation):
 *
 *   - The recorder writes hand-rolled OGG/Opus framing; OpenAI's audio chat
 *     models (gpt-audio*, gpt-4o-audio-preview) reject OGG outright in
 *     `input_audio` content parts, and even compliant OGG occasionally trips
 *     up STT endpoints. Transcoding once at the boundary makes every backend
 *     accept the same bytes.
 *
 *   - chat-LLM (AUDIO_DIRECT_URL unset): the chat model configured via
 *     ModelService.getAudioLLM receives an `input_audio` content part with the
 *     transcoded MP3 and a system prompt. Plain `invoke` — no structured
 *     output (OpenAI's gpt-audio* family rejects `response_format: json_schema`,
 *     and the response.content is already plain text per the system prompt).
 *     Provider routing (openrouter / vertex / azure / requesty / llamacpp)
 *     lives in ModelService — this service does not branch on it.
 *
 *   - direct (AUDIO_DIRECT_URL set): the transcoded MP3 is POSTed as
 *     multipart to AUDIO_DIRECT_URL using AUDIO_API_KEY as Bearer auth. Any
 *     OpenAI-style transcription endpoint works (api.openai.com, Groq,
 *     self-hosted Whisper, ...). No provider whitelist.
 *
 * No retry layer — BullMQ's job-level retry handles transient failures.
 */
@Injectable()
export class AudioLLMService {
  private readonly logger = new Logger(AudioLLMService.name);

  constructor(
    private readonly modelService: ModelService,
    private readonly config: ConfigService<BaseConfigInterface>,
    private readonly dumper: LLMCallDumper,
  ) {}

  async call(params: AudioCallParams): Promise<TranscriptionResult> {
    const audio = this.config.get<ConfigAiInterface>("ai").audio;

    this.logger.log(
      `audio-call: branch=${audio.directUrl ? "direct" : "chat"} provider=${audio.provider} ` +
        `model=${audio.model} url=${audio.url || "(default)"} directUrl=${audio.directUrl || "(unset)"} ` +
        `language=${audio.language || "(unset)"} audioPath=${params.audioPath} ` +
        `promptLength=${params.prompt.length} temperature=${params.temperature ?? 0.1}`,
    );

    // Universal ffmpeg pre-normalisation. See class JSDoc for rationale.
    // `params.transcode` adds optional in-pass cleanup (high-pass, silence trim).
    const transcode = await transcodeForDirect(params.audioPath, params.transcode).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`audio-call: ffmpeg failed for ${params.audioPath}: ${message}`);
      throw new Error(`Audio LLM service error: ffmpeg failed: ${message}`);
    });
    this.logger.log(
      `audio-call: transcode done → ${transcode.path} durationSeconds=${transcode.durationSeconds.toFixed(2)}`,
    );

    try {
      return audio.directUrl
        ? await this.callDirect(params, audio, transcode)
        : await this.callChat(params, audio, transcode);
    } finally {
      await transcode.cleanup().catch((err) => {
        this.logger.warn(`audio-transcode: cleanup failed for ${transcode.path}: ${(err as Error).message}`);
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Chat-LLM branch (audio.directUrl unset) — provider routing via ModelService
  // ─────────────────────────────────────────────────────────────────────────

  private async callChat(
    params: AudioCallParams,
    audio: ConfigAiInterface["audio"],
    transcode: TranscodeResult,
  ): Promise<TranscriptionResult> {
    const audioBuffer = await fs.promises.readFile(transcode.path);
    const audioBase64 = audioBuffer.toString("base64");

    // Send the prompt as a SystemMessage (instruction) and the audio in its own
    // HumanMessage (data). Mixing both in a single user message caused some
    // audio-chat models (e.g. OpenAI gpt-audio-mini) to treat the text as the
    // primary request and respond as a chat assistant — refusing to transcribe.
    const messages = [
      new SystemMessage(params.prompt),
      new HumanMessage({
        content: [{ type: "input_audio", input_audio: { data: audioBase64, format: "mp3" } }],
      }),
    ];

    const session: DumpSession = this.dumper.startSession({
      metadata: {
        nodeName: "audio_transcription",
        agentName: "audio_transcription",
        node_type: "audio_transcription",
      },
      model: audio.model,
      provider: audio.provider,
      temperature: params.temperature ?? 0.1,
    });

    try {
      const baseModel = this.modelService.getAudioLLM({ temperature: params.temperature ?? 0.1 });

      this.logger.log(
        `audio-chat: invoking model=${audio.model} provider=${audio.provider} ` +
          `format=mp3 audioBase64Bytes=${audioBase64.length}`,
      );

      // Plain invoke — no structured output. OpenAI's gpt-audio* family
      // explicitly rejects `response_format: json_schema`, and for transcription
      // we only want the text content anyway. The system prompt instructs the
      // model to return plain text; the response.content is exactly that.
      const response = (await baseModel.invoke(messages)) as unknown as ChatInvokeResponse;

      const text = extractText(response.content);
      const input = response.usage_metadata?.input_tokens ?? 0;
      const output = response.usage_metadata?.output_tokens ?? 0;
      const finishReason = response.response_metadata?.finish_reason;
      this.logger.log(
        `audio-chat: invoke returned textLength=${text.length} ` +
          `tokensIn=${input} tokensOut=${output} finishReason=${finishReason ?? "(none)"}`,
      );

      session.recordResponse({
        content: text,
        tokenUsage: { input, output },
        finishReason,
      });
      session.close({ finalStatus: "success", totalTokens: { input, output } });
      return {
        text,
        tokenUsage: { input, output },
        audioSeconds: transcode.durationSeconds,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? (error.stack ?? "").split("\n").slice(0, 10).join("\n") : undefined;
      this.dumpUpstreamError("audio-chat", error);
      session.close({
        finalStatus: "error",
        errorMessage: message,
        errorStack: stack,
        totalTokens: { input: 0, output: 0 },
      });
      throw new Error(`Audio LLM service error: ${message}`);
    }
  }

  /**
   * Dump the full upstream error for diagnostics. LangChain wraps the openai
   * SDK's APIError which carries the upstream body in `.error` (or
   * `.response.data` depending on transport); without printing it we only see
   * the generic "400 Provider returned error" wrapper from OpenRouter, hiding
   * the real OpenAI rejection underneath.
   */
  private dumpUpstreamError(prefix: string, error: unknown): void {
    const e = error as Record<string, unknown> & {
      status?: number;
      message?: string;
      cause?: unknown;
      response?: { status?: number; data?: unknown; headers?: unknown };
      error?: unknown;
      headers?: unknown;
    };
    const parts: string[] = [];
    parts.push(`message="${e?.message ?? "(none)"}"`);
    parts.push(`status=${e?.status ?? e?.response?.status ?? "n/a"}`);
    if (e?.error !== undefined) {
      try {
        parts.push(`error=${JSON.stringify(e.error)}`);
      } catch {
        parts.push(`error=(unserializable: ${String(e.error)})`);
      }
    }
    if (e?.response?.data !== undefined) {
      try {
        parts.push(`response.data=${JSON.stringify(e.response.data)}`);
      } catch {
        parts.push(`response.data=(unserializable)`);
      }
    }
    if (e?.cause !== undefined) {
      try {
        parts.push(`cause=${JSON.stringify(e.cause)}`);
      } catch {
        parts.push(`cause=${String(e.cause)}`);
      }
    }
    this.logger.error(`${prefix}: UPSTREAM ERROR — ${parts.join(" | ")}`);

    // Best-effort full dump including non-enumerable properties.
    try {
      const own = Object.getOwnPropertyNames(e);
      const dump: Record<string, unknown> = {};
      for (const k of own) dump[k] = (e as Record<string, unknown>)[k];
      this.logger.error(`${prefix}: FULL ERROR DUMP — ${JSON.stringify(dump)}`);
    } catch {
      /* swallow circular */
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Direct branch (audio.directUrl set) — OpenAI-style /audio/transcriptions
  // ─────────────────────────────────────────────────────────────────────────

  private async callDirect(
    params: AudioCallParams,
    audio: ConfigAiInterface["audio"],
    transcode: TranscodeResult,
  ): Promise<TranscriptionResult> {
    const directUrl = audio.directUrl as string; // narrowed by the caller

    const session: DumpSession = this.dumper.startSession({
      metadata: {
        nodeName: "audio_transcription",
        agentName: "audio_transcription",
        node_type: "audio_transcription",
      },
      model: audio.model,
      provider: audio.provider,
      temperature: params.temperature ?? 0.1,
    });

    try {
      const mp3Buffer = await fs.promises.readFile(transcode.path);
      const formData = new FormData();
      formData.append("file", new Blob([new Uint8Array(mp3Buffer)], { type: "audio/mpeg" }), "audio.mp3");
      formData.append("model", audio.model);
      formData.append("prompt", params.prompt);
      if (audio.language) formData.append("language", audio.language);
      formData.append("temperature", String(params.temperature ?? 0.1));
      formData.append("response_format", "json");

      this.logger.log(
        `audio-direct: POST ${directUrl} model=${audio.model} language=${audio.language || "(unset)"} ` +
          `mp3Bytes=${mp3Buffer.length} apiKeyPrefix=${(audio.apiKey || "").slice(0, 6)}...`,
      );

      const response = await fetch(directUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${audio.apiKey}` },
        body: formData,
      });

      this.logger.log(`audio-direct: response status=${response.status}`);

      if (!response.ok) {
        const bodyText = await response.text().catch(() => "");
        this.logger.error(`audio-direct: UPSTREAM ERROR — status=${response.status} body=${bodyText}`);
        throw new Error(`HTTP ${response.status} — ${bodyText.slice(0, 500)}`);
      }

      const json = (await response.json().catch(() => ({}))) as { text?: unknown };
      const text = typeof json.text === "string" ? json.text : "";

      session.recordResponse({ content: text, tokenUsage: { input: 0, output: 0 } });
      session.close({ finalStatus: "success", totalTokens: { input: 0, output: 0 } });
      return { text, tokenUsage: { input: 0, output: 0 }, audioSeconds: transcode.durationSeconds };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? (error.stack ?? "").split("\n").slice(0, 10).join("\n") : undefined;
      session.close({
        finalStatus: "error",
        errorMessage: message,
        errorStack: stack,
        totalTokens: { input: 0, output: 0 },
      });
      throw new Error(`Audio LLM service error: ${message}`);
    }
  }
}
