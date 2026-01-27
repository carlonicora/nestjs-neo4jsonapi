import { HumanMessage } from "@langchain/core/messages";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ZodType } from "zod";
import { BaseConfigInterface, ConfigAiInterface } from "../../../config/interfaces";
import { ModelService } from "../../llm/services/model.service";
import { convertZodToJsonSchema, sanitizeSchemaForGemini } from "../utils/schema.utils";

/**
 * Error thrown when vision model's content moderation blocks an image analysis request.
 * This typically happens when the image content triggers safety filters.
 */
export class ContentModerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentModerationError";
  }
}

/**
 * Parameters for Vision LLM service calls
 */
interface VisionCallParams<T> {
  image: string;
  systemPrompt: string;
  outputSchema: ZodType<T>;
  temperature?: number;
}

/**
 * Raw LLM response structure with usage metadata
 */
interface LLMRawResponse {
  usage_metadata?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  response_metadata?: {
    finish_reason?: string;
    [key: string]: unknown;
  };
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

@Injectable()
export class VisionLLMService {
  private readonly MAX_RETRIES = 5;
  private readonly INITIAL_DELAY_MS = 1000;

  constructor(
    private readonly modelService: ModelService,
    private readonly config: ConfigService<BaseConfigInterface>,
  ) {}

  /**
   * Checks if an error is a rate limit (429) error
   */
  private isRateLimitError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return (
        message.includes("429") ||
        message.includes("rate limit") ||
        message.includes("resource exhausted") ||
        message.includes("too many requests")
      );
    }
    return false;
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Execute a function with exponential backoff retry on rate limit errors
   */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (!this.isRateLimitError(error) || attempt === this.MAX_RETRIES - 1) {
          throw lastError;
        }

        // Exponential backoff with jitter: 1s, 2s, 4s, 8s, 16s + random 0-500ms
        const baseDelay = this.INITIAL_DELAY_MS * Math.pow(2, attempt);
        const jitter = Math.random() * 500;
        const delay = baseDelay + jitter;

        await this.sleep(delay);
      }
    }

    throw lastError ?? new Error("Max retries exceeded");
  }

  /**
   * Fetches an image from a URL and converts it to a base64 data URL.
   * Required because OpenRouter cannot access local/private URLs.
   */
  private async fetchImageAsBase64(image: string): Promise<string> {
    const response = await fetch(image);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type") || "image/jpeg";
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    return `data:${contentType};base64,${base64}`;
  }

  /**
   * Checks if the configured vision model is a Gemini model.
   * Gemini models require schema sanitization (removal of $schema, $defs, etc.)
   */
  private isGeminiVisionModel(): boolean {
    const visionConfig = this.config.get<ConfigAiInterface>("ai").vision;
    const modelLower = visionConfig.model.toLowerCase();
    return modelLower.startsWith("gemini") || modelLower.includes("/gemini");
  }

  /**
   * Fallback method to call the LLM without structured output.
   * Used when structured output parsing fails.
   *
   * @template T - The expected output type
   * @param params - Call parameters
   * @param message - The HumanMessage to send
   * @returns Promise with parsed response and raw content
   */
  private async callWithoutStructuredOutput<T>(
    params: VisionCallParams<T>,
    message: HumanMessage,
  ): Promise<{ parsed: T; rawContent: string }> {
    const baseModel = this.modelService.getVisionLLM({
      temperature: params.temperature ?? 0.1,
    });

    try {
      // Call without structured output - the model will return raw text
      const response = await baseModel.invoke([message]);
      const rawContent = typeof response.content === "string" ? response.content : JSON.stringify(response.content);

      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = rawContent.match(/```json\n?([\s\S]*?)\n?```/) || rawContent.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[1] || jsonMatch[0] : rawContent;

      // Parse and validate
      const parsed = JSON.parse(jsonStr);
      const validated = params.outputSchema.parse(parsed);

      return { parsed: validated as T, rawContent };
    } catch (error) {
      // Check for content moderation / safety filter errors
      const errorStr = error instanceof Error ? error.message : String(error);
      if (
        errorStr.includes("SAFETY") ||
        errorStr.includes("blocked") ||
        errorStr.includes("content policy") ||
        errorStr.includes("HARM_CATEGORY") ||
        errorStr.includes("message") // This catches the "Cannot read properties of undefined (reading 'message')" error
      ) {
        throw new ContentModerationError(
          `Image may have been blocked by content moderation. Original error: ${errorStr}. ` +
            `This typically happens when the vision model's safety filters reject the image content.`,
        );
      }

      throw error;
    }
  }

  /**
   * Calls the LLM with an image for vision analysis using structured output.
   *
   * This method follows the same pattern as LLMService:
   * 1. Gets the base model from ModelService
   * 2. Wraps it with withStructuredOutput for schema enforcement (with Gemini sanitization if needed)
   * 3. Creates a multimodal HumanMessage with text and image
   * 4. Invokes the structured LLM directly
   * 5. Falls back to non-structured call if parsing fails
   * 6. Returns parsed response with token usage metadata
   *
   * @template T - The expected output type (inferred from outputSchema)
   * @param params - Call parameters
   * @param params.image - URL of the image to analyze (will be converted to base64)
   * @param params.systemPrompt - System prompt for the vision analysis
   * @param params.outputSchema - Zod schema defining expected LLM response structure
   * @param params.temperature - Optional temperature override (default: 0.1)
   * @returns Promise resolving to parsed output + token usage metadata
   * @throws {Error} If LLM call fails or returns invalid structured output
   */
  async call<T>(params: VisionCallParams<T>): Promise<T & { tokenUsage: { input: number; output: number } }> {
    // Create message first so it can be reused in fallback
    const message = new HumanMessage({
      content: [
        {
          type: "text",
          text: params.systemPrompt,
        },
        {
          type: "image_url",
          image_url: {
            url: params.image,
          },
        },
      ],
    });

    try {
      const baseModel = this.modelService.getVisionLLM({
        temperature: params.temperature ?? 0.1,
      });

      // Check if Gemini model needs schema sanitization (remove $schema, $defs, etc.)
      const needsGeminiSanitization = this.isGeminiVisionModel();

      let structuredLlm;
      if (needsGeminiSanitization) {
        const jsonSchema = convertZodToJsonSchema(params.outputSchema);
        const sanitizedSchema = sanitizeSchemaForGemini(jsonSchema);
        structuredLlm = baseModel.withStructuredOutput(sanitizedSchema, {
          includeRaw: true,
        });
      } else {
        structuredLlm = baseModel.withStructuredOutput(params.outputSchema, {
          includeRaw: true,
        });
      }

      const response = await this.withRetry(async () => {
        return (await structuredLlm.invoke([message])) as unknown as StructuredOutputResponse<T>;
      });

      // Handle null parsed response with fallback JSON parsing
      if (!response.parsed) {
        const raw = isValidRaw(response.raw) ? response.raw : undefined;
        const rawContent = raw?.content || "";

        if (rawContent) {
          // Attempt manual JSON parsing
          const jsonMatch = rawContent.match(/```json\n?([\s\S]*?)\n?```/) || rawContent.match(/\{[\s\S]*\}/);
          const jsonStr = jsonMatch ? jsonMatch[1] || jsonMatch[0] : rawContent;
          const parsed = JSON.parse(jsonStr);
          const validated = params.outputSchema.parse(parsed);

          return {
            ...(validated as T),
            tokenUsage: {
              input: raw?.usage_metadata?.input_tokens ?? 0,
              output: raw?.usage_metadata?.output_tokens ?? 0,
            },
          };
        }

        throw new Error("Structured output parsing failed and no raw content available");
      }

      // Success path - extract token usage with type guard
      const raw = isValidRaw(response.raw) ? response.raw : undefined;
      const input = raw?.usage_metadata?.input_tokens ?? 0;
      const output = raw?.usage_metadata?.output_tokens ?? 0;

      return {
        ...(response.parsed as T),
        tokenUsage: {
          input,
          output,
        },
      };
    } catch (error) {
      // Check if this is the structured output parsing error
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isParsingError =
        errorMessage.includes("Cannot read properties of undefined") || errorMessage.includes("map");

      if (isParsingError) {
        try {
          const { parsed } = await this.withRetry(() => this.callWithoutStructuredOutput(params, message));

          return {
            ...(parsed as T),
            tokenUsage: { input: 0, output: 0 }, // Token usage not available in fallback
          };
        } catch (fallbackError) {
          const fallbackErrorMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);

          // Re-throw ContentModerationError to allow proper handling upstream
          if (fallbackError instanceof ContentModerationError) {
            throw fallbackError;
          }

          throw new Error(`Vision LLM service error: ${errorMessage}. ` + `Fallback error: ${fallbackErrorMessage}`);
        }
      }

      throw new Error(`Vision LLM service error: ${errorMessage}`);
    }
  }
}
