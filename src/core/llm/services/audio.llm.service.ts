import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as fs from "fs";
import { TOKEN_USAGE_RECORDER, TokenUsageRecorderInterface } from "../../../common/tokens";
import { BaseConfigInterface, ConfigAiInterface } from "../../../config/interfaces";
import { TokenUsageService } from "../../../foundations/tokenusage/services/tokenusage.service";
import { transcodeForDirect, type TranscodeOptions, type TranscodeResult } from "./audio/ffmpeg-transcode";
import { DumpSession, LLMCallDumper } from "./llm-call-dumper.service";
import { ModelService } from "./model.service";

/** Default `tokenUsageType` written when a caller attributes a call but names no category. */
const DEFAULT_AUDIO_TOKEN_USAGE_TYPE = "transcription";

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
  /**
   * Cost-attribution category written to the usage record. Free-form so each
   * application owns its own vocabulary; defaults to "transcription".
   */
  tokenUsageType?: string;
  /**
   * Opt-in cost attribution, exactly like `LLMCallParams`: BOTH of these must
   * be present or no usage record is written at all. The package stays
   * domain-agnostic — the caller decides what the transcription is billed
   * against (narr8: the Session the recording belongs to).
   */
  relationshipId?: string;
  relationshipType?: string;
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
    // Both usage dependencies are @Optional() — same shape as EmbedderService —
    // so consumers that never mount the tokenusage module (and apps that bind
    // no TOKEN_USAGE_RECORDER) keep booting and simply record nothing.
    @Optional() private readonly tokenUsageService?: TokenUsageService,
    @Optional() @Inject(TOKEN_USAGE_RECORDER) private readonly tokenUsageRecorder?: TokenUsageRecorderInterface,
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
    // The JSON STT path emits WAV (some OpenRouter STT providers reject mp3);
    // chat + multipart paths keep mp3.
    const outputFormat = audio.directUrl && audio.directFormat === "json" ? "wav" : "mp3";
    const transcode = await transcodeForDirect(params.audioPath, { ...params.transcode, outputFormat }).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`audio-call: ffmpeg failed for ${params.audioPath}: ${message}`);
      throw new Error(`Audio LLM service error: ffmpeg failed: ${message}`);
    });
    this.logger.log(
      `audio-call: transcode done → ${transcode.path} durationSeconds=${transcode.durationSeconds.toFixed(2)}`,
    );

    try {
      const result = audio.directUrl
        ? await this.callDirect(params, audio, transcode)
        : await this.callChat(params, audio, transcode);
      this.warnIfDirectPathUnbilled(audio, result.tokenUsage);
      await this.persistUsage(params, result.tokenUsage);
      return result;
    } catch (error) {
      // A failed transcription is not a free call in principle, but neither
      // branch surfaces the tokens it burned before throwing (LangChain drops
      // usage_metadata on error; /audio/transcriptions never reports any), so
      // this is {0,0} today and the zero-token rule in persistUsage skips it.
      // Wired anyway so partial usage is billed the day a branch can report it.
      await this.persistUsage(params, { input: 0, output: 0 });
      throw error;
    } finally {
      await transcode.cleanup().catch((err) => {
        this.logger.warn(`audio-transcode: cleanup failed for ${transcode.path}: ${(err as Error).message}`);
      });
    }
  }

  /**
   * True once the "direct STT reports no tokens" warning has been emitted by
   * this instance. The audio service is a singleton, so this throttles the
   * warning to once per process instead of once per utterance.
   */
  private directPathUnbilledWarned = false;

  /**
   * Makes an unbillable engine LOUD instead of silent.
   *
   * The direct `/audio/transcriptions` engine (AUDIO_DIRECT_URL) reports no
   * token counts at all, and the zero-token rule in {@link persistUsage} then
   * writes no usage record — so switching an application to that engine
   * silently turns transcription back into completely unbilled work. There is
   * no per-minute rate to fall back on (`audioSeconds` is available on the
   * result, but no price for it is configured anywhere), and inventing a token
   * count would be a lie, so the honest fix is a warning that names the
   * consequence. Emitted once per process — never in the hot per-utterance
   * path beyond a boolean check.
   */
  private warnIfDirectPathUnbilled(audio: ConfigAiInterface["audio"], tokens: { input: number; output: number }): void {
    if (!audio.directUrl) return;
    if (tokens.input + tokens.output > 0) return;
    if (this.directPathUnbilledWarned) return;
    this.directPathUnbilledWarned = true;
    this.logger.warn(
      `audio-billing: TRANSCRIPTION USAGE IS NOT BEING BILLED — the direct STT endpoint ` +
        `(AUDIO_DIRECT_URL=${audio.directUrl}, model=${audio.model}) returns no token counts, so every ` +
        `transcription records zero usage and deducts no credits. Billing this engine needs a ` +
        `per-duration rate (the call already measures audioSeconds); until one exists this cost is ` +
        `invisible. Unset AUDIO_DIRECT_URL to use the chat engine, which reports real tokens and bills ` +
        `normally. Logged once per process.`,
    );
  }

  /**
   * Records transcription usage. Attribution is opt-in — same contract as
   * `LLMService.persistUsage`: no relationship, no record, so the package stays
   * domain-agnostic. Cost comes from the `audio` config block rather than
   * `computeCost()`, which only knows the text tiers (`configForWeight` never
   * looks at `ai.audio`), hence `costOverride`.
   *
   * ZERO-TOKEN RULE (mirrors `LLMService.persistUsageOnFailure`): a call that
   * reports no tokens records NOTHING. `recordTokenUsage` floors every row at
   * `minCreditsPerRecord`, so a 0/0 row would invent a charge for tokens nobody
   * spent. This is what the direct `/audio/transcriptions` path always hits —
   * it returns no token counts by design — so that engine bills nothing until
   * the endpoint reports usage (and says so loudly: see
   * {@link warnIfDirectPathUnbilled}). The chat path (AUDIO_DIRECT_URL unset)
   * returns real counts and is billed normally.
   *
   * FLOOR-EXEMPT (`applyMinimum: false`), same rationale as EmbedderService:
   * transcription is per-utterance, not per-request. A session averages a few
   * hundred segments and can exceed a thousand, each truly worth a fraction of
   * a credit, so applying the per-record floor to every one of them would bill
   * a large multiple of the real cost. The floor exists to stop sub-cent REAL
   * usage rounding to nothing on a handful of records, not to price a thousand
   * of them.
   *
   * Writes through the application-provided `TOKEN_USAGE_RECORDER` when one is
   * bound, falling back to the module-local `TokenUsageService` otherwise (see
   * the token's docblock for why package code must use this seam).
   *
   * Never throws: a persistence failure logs a warning and the transcription
   * result stands.
   */
  private async persistUsage(
    params: { tokenUsageType?: string; relationshipId?: string; relationshipType?: string },
    tokens: { input: number; output: number },
  ): Promise<void> {
    if (!params.relationshipId || !params.relationshipType) return;
    if (tokens.input + tokens.output === 0) return;

    const recorder = this.tokenUsageRecorder ?? this.tokenUsageService;
    if (!recorder) return;

    const audio = this.config.get<ConfigAiInterface>("ai")?.audio;
    const cost =
      (tokens.input * (audio?.inputCostPer1MTokens ?? 0) + tokens.output * (audio?.outputCostPer1MTokens ?? 0)) /
      1_000_000;

    try {
      await recorder.recordTokenUsage({
        tokens,
        type: params.tokenUsageType ?? DEFAULT_AUDIO_TOKEN_USAGE_TYPE,
        relationshipId: params.relationshipId,
        relationshipType: params.relationshipType,
        costOverride: cost,
        applyMinimum: false,
      });
    } catch (err) {
      this.logger.warn(`Transcription usage persistence failed — continuing: ${String(err)}`);
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
      const audioBuffer = await fs.promises.readFile(transcode.path);

      // Request shape is CONFIG-DRIVEN (AUDIO_DIRECT_FORMAT) — never inferred:
      //   - "json"      → OpenRouter-style: JSON body with base64 `input_audio`
      //                   (no biasing prompt — a dedicated STT needs none).
      //   - "multipart" → OpenAI / self-hosted Whisper: multipart form-data (default).
      let headers: Record<string, string>;
      let body: string | FormData;
      if (audio.directFormat === "json") {
        // OpenRouter STT: the documented "complete working example" is ONLY the
        // required fields (model + input_audio). Optional language/temperature get
        // forwarded to the provider and some reject them (→ "Provider returned
        // 400"), so we keep the body minimal. `data` is raw base64, NOT a data URI.
        // `format` matches the transcode output (wav for STT). `directProvider`
        // pins a provider (e.g. "Together") to route around dead ones (Groq's
        // whisper-large-v3 endpoint 400s everything).
        const audioFormat = transcode.path.endsWith(".wav") ? "wav" : "mp3";
        headers = { Authorization: `Bearer ${audio.apiKey}`, "Content-Type": "application/json" };
        body = JSON.stringify({
          model: audio.model,
          input_audio: { data: audioBuffer.toString("base64"), format: audioFormat },
          ...(audio.directProvider ? { provider: { order: [audio.directProvider], allow_fallbacks: false } } : {}),
        });
      } else {
        const formData = new FormData();
        formData.append("file", new Blob([new Uint8Array(audioBuffer)], { type: "audio/mpeg" }), "audio.mp3");
        formData.append("model", audio.model);
        formData.append("prompt", params.prompt);
        if (audio.language) formData.append("language", audio.language);
        formData.append("temperature", String(params.temperature ?? 0.1));
        formData.append("response_format", "json");
        headers = { Authorization: `Bearer ${audio.apiKey}` };
        body = formData;
      }

      this.logger.log(
        `audio-direct: POST ${directUrl} format=${audio.directFormat || "multipart"} model=${audio.model} ` +
          `language=${audio.language || "(unset)"} audioBytes=${audioBuffer.length} provider=${audio.provider}`,
      );

      const response = await fetch(directUrl, { method: "POST", headers, body });

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
