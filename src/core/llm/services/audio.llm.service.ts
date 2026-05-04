import { HumanMessage } from "@langchain/core/messages";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as fs from "fs";
import { ZodType } from "zod";
import { BaseConfigInterface, ConfigAiInterface } from "../../../config/interfaces";
import { convertZodToJsonSchema, sanitizeSchemaForGemini } from "../utils/schema.utils";
import { DumpSession, LLMCallDumper } from "./llm-call-dumper.service";
import { ModelService } from "./model.service";

/**
 * Parameters for Audio LLM service calls
 */
interface AudioCallParams<T> {
  audioPath: string;
  mimeType: string; // e.g., 'audio/wav', 'audio/ogg'
  systemPrompt: string;
  outputSchema: ZodType<T>;
  temperature?: number;
}

/**
 * Raw LLM response structure with usage metadata
 */
interface LLMRawResponse {
  usage_metadata?: { input_tokens?: number; output_tokens?: number };
  response_metadata?: { finish_reason?: string; [k: string]: unknown };
  content?: string;
}

/**
 * Type guard to validate raw response structure
 */
function isValidRaw(raw: unknown): raw is LLMRawResponse {
  return typeof raw === "object" && raw !== null;
}

/**
 * Structured output response from LLM
 */
interface StructuredOutputResponse<T> {
  parsed: T | null;
  raw?: LLMRawResponse;
}

/**
 * Audio-modality sibling of VisionLLMService that ships an `input_audio` content
 * part to the configured LLM. Adopts LLMCallDumper for observability (mirroring
 * LLMService) and intentionally has NO retry layer — BullMQ's job-level retry
 * (attempts: 3, exponential backoff) handles transient failures, so we avoid
 * compounded retry layers here.
 */
@Injectable()
export class AudioLLMService {
  constructor(
    private readonly modelService: ModelService,
    private readonly config: ConfigService<BaseConfigInterface>,
    private readonly dumper: LLMCallDumper,
  ) {}

  /**
   * Checks if the configured audio model is a Gemini model.
   * Gemini models require schema sanitization (removal of $schema, $defs, etc.)
   */
  private isGeminiAudioModel(): boolean {
    const audioConfig = this.config.get<ConfigAiInterface>("ai").audio;
    const m = audioConfig.model.toLowerCase();
    return m.startsWith("gemini") || m.includes("/gemini");
  }

  /**
   * Maps a MIME type to the short codec name expected by the LangChain
   * ChatOpenAI `input_audio` content part `format` field.
   */
  private formatForLangchain(mimeType: string): string {
    if (mimeType.includes("wav")) return "wav";
    if (mimeType.includes("mp3")) return "mp3";
    if (mimeType.includes("ogg")) return "ogg";
    if (mimeType.includes("webm")) return "webm";
    if (mimeType.includes("flac")) return "flac";
    return "wav";
  }

  /**
   * Calls the audio LLM with a base64-encoded audio file using structured output.
   *
   * Single-shot — no retry layer. BullMQ owns retries at the job level.
   *
   * @template T - The expected output type (inferred from outputSchema)
   * @param params - Call parameters
   * @returns Promise resolving to parsed output + token usage metadata
   */
  async call<T>(params: AudioCallParams<T>): Promise<T & { tokenUsage: { input: number; output: number } }> {
    const audioBuffer = await fs.promises.readFile(params.audioPath);
    const audioBase64 = audioBuffer.toString("base64");
    const format = this.formatForLangchain(params.mimeType);

    const message = new HumanMessage({
      content: [
        { type: "text", text: params.systemPrompt },
        {
          type: "input_audio",
          input_audio: { data: audioBase64, format },
        },
      ],
    });

    const aiConfig = this.config.get<ConfigAiInterface>("ai").audio;
    const session: DumpSession = this.dumper.startSession({
      metadata: {
        nodeName: "audio_transcription",
        agentName: "audio_transcription",
        node_type: "audio_transcription",
      },
      model: aiConfig.model,
      provider: aiConfig.provider,
      temperature: params.temperature ?? 0.1,
    });

    try {
      const baseModel = this.modelService.getAudioLLM({
        temperature: params.temperature ?? 0.1,
      });

      const needsGeminiSanitization = this.isGeminiAudioModel();

      let structuredLlm;
      if (needsGeminiSanitization) {
        const jsonSchema = convertZodToJsonSchema(params.outputSchema);
        const sanitizedSchema = sanitizeSchemaForGemini(jsonSchema);
        structuredLlm = baseModel.withStructuredOutput(sanitizedSchema, { includeRaw: true });
      } else {
        structuredLlm = baseModel.withStructuredOutput(params.outputSchema, { includeRaw: true });
      }

      const response = (await structuredLlm.invoke([message])) as unknown as StructuredOutputResponse<T>;

      const raw = isValidRaw(response.raw) ? response.raw : undefined;
      const input = raw?.usage_metadata?.input_tokens ?? 0;
      const output = raw?.usage_metadata?.output_tokens ?? 0;

      session.recordResponse({
        content: typeof raw?.content === "string" ? raw.content : "",
        tokenUsage: { input, output },
        finishReason: raw?.response_metadata?.finish_reason,
      });

      if (!response.parsed) {
        const rawContent = raw?.content || "";
        if (rawContent) {
          const jsonMatch = rawContent.match(/```json\n?([\s\S]*?)\n?```/) || rawContent.match(/\{[\s\S]*\}/);
          const jsonStr = jsonMatch ? jsonMatch[1] || jsonMatch[0] : rawContent;
          const parsed = JSON.parse(jsonStr);
          const validated = params.outputSchema.parse(parsed);
          session.close({ finalStatus: "success", totalTokens: { input, output } });
          return { ...(validated as T), tokenUsage: { input, output } };
        }
        session.close({
          finalStatus: "error",
          errorMessage: "Structured output parsing failed",
          totalTokens: { input, output },
        });
        throw new Error("Structured output parsing failed and no raw content available");
      }

      session.close({ finalStatus: "success", totalTokens: { input, output } });
      return { ...(response.parsed as T), tokenUsage: { input, output } };
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
