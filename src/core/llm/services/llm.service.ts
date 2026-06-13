import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { streamObject, streamText } from "ai";
import { ZodType } from "zod";
import { AgentMessageType } from "../../../common/enums/agentmessage.type";
import { BaseConfigInterface } from "../../../config/interfaces";
import { ModelWeight } from "../enums/model.weight";
import { ModelService } from "../../llm/services/model.service";
import {
  convertZodToJsonSchema,
  extractSchemaMetadata,
  formatFieldWithDescription,
  sanitizeSchemaForGemini,
} from "../../llm/utils/schema.utils";
import { DumpSession, DumpSessionStartParams, LLMCallDumper } from "./llm-call-dumper.service";

/**
 * Inject OpenRouter's `provider` routing block into a JSON request body.
 * OpenRouter routes a request to ANY provider unless the body carries this
 * block — and a misroute can land on a moderating provider that refuses
 * explicit content mid-stream. The LangChain path (ModelService.buildChatModel)
 * sets this via modelKwargs; the Vercel AI SDK streaming path builds its own
 * model and must inject it here. Mirrors buildChatModel: order + allow_fallbacks
 * + require_parameters. Returns the body unchanged if it is not JSON.
 */
export function injectOpenRouterProvider(bodyStr: string, region: string, allowFallbacks: boolean): string {
  try {
    const body = JSON.parse(bodyStr);
    body.provider = { order: [region], allow_fallbacks: allowFallbacks, require_parameters: true };
    return JSON.stringify(body);
  } catch {
    return bodyStr;
  }
}

/** A `fetch` middleware that pins OpenRouter routing on every request body. */
function openRouterPinnedFetch(region: string, allowFallbacks: boolean): typeof fetch {
  return ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    if (init?.body && typeof init.body === "string") {
      init = { ...init, body: injectOpenRouterProvider(init.body, region, allowFallbacks) };
    }
    return fetch(input, init);
  }) as typeof fetch;
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
    [key: string]: any;
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
 * Parameters for LLM service calls
 */
interface LLMCallParams<T> {
  inputParams: Record<string, any>;
  inputSchema?: ZodType; // Optional Zod schema for input validation and context injection
  outputSchema: ZodType<T>;
  systemPrompts: string[];
  instructions?: string;
  temperature?: number;
  history?: Array<{ role: AgentMessageType; content: string }>;
  maxTokens?: number;
  timeout?: number;
  metadata?: Record<string, any>;
  stopSequences?: string[];
  maxHistoryMessages?: number;
  validateInput?: boolean; // Optional flag to enable input validation (default: false)
  tools?: DynamicStructuredTool[]; // Optional tools to bind to the LLM
  maxToolIterations?: number; // Max tool call iterations (default: 5)
  modelWeight?: ModelWeight; // Optional model tier (lite/normal/large). Default: Normal.
}

/**
 * Session usage statistics
 */
interface SessionUsage {
  input: number;
  output: number;
  total: number;
  callCount: number;
}

/**
 * Structured output response from LLM
 */
interface StructuredOutputResponse<T> {
  parsed: T | null;
  raw?: LLMRawResponse;
}

/**
 * Best-effort extraction of a JSON object from free-form model text. Local
 * models (notably Gemma over Ollama) routinely ignore a forced `tool_choice`
 * and emit the structured payload as plain text — sometimes bare, sometimes
 * wrapped in a ```json fence or surrounded by prose. Returns the first parseable
 * object, or `null` when none is found. Never throws.
 */
function extractJsonObject(text: unknown): Record<string, unknown> | null {
  if (typeof text !== "string" || text.trim() === "") return null;
  const tryParse = (s: string): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(s);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  };

  const direct = tryParse(text.trim());
  if (direct) return direct;

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    const fenced = tryParse(fence[1].trim());
    if (fenced) return fenced;
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const sliced = tryParse(text.slice(start, end + 1));
    if (sliced) return sliced;
  }

  return null;
}

/**
 * Recovers a forced tool call that a Gemma/MLX model emitted as TEXT instead of
 * a structured `tool_calls` entry. These models (e.g. `gemma4:26b-mlx` over
 * Ollama, whose Modelfile template is the bare `{{ .Prompt }}` with no real
 * tool-calling support) leak their native tool format as literal pseudo-tokens:
 *
 *   toolName{key:<|"|>value<|"|>,key:<|"|>value<|"|>}<tool_call|>
 *
 * Ollama can't parse that, so it returns it as `content` with `tool_calls=[]`
 * and `finish_reason=stop`. It is NOT valid JSON (unquoted keys, `<|"|>` quote
 * tokens, values that themselves contain `"`), so `extractJsonObject` misses it.
 * We split on the `<|"|>` pseudo-quote — which never appears inside real text —
 * giving alternating [keyspec, value, keyspec, value, …] and rebuild the object.
 * Returns the recovered object, or `null` when the marker is absent. Never throws.
 */
function parseGemmaToolCallText(text: unknown): Record<string, unknown> | null {
  if (typeof text !== "string" || !text.includes('<|"|>')) return null;
  const open = text.indexOf("{");
  const close = text.lastIndexOf("}");
  const body = open >= 0 && close > open ? text.slice(open + 1, close) : text;

  const parts = body.split('<|"|>');
  const obj: Record<string, unknown> = {};
  // Even-indexed parts hold the `…,key:` spec; the following odd part is its value.
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const keyMatch = parts[i].match(/([A-Za-z_][A-Za-z0-9_]*)\s*:\s*$/);
    if (keyMatch) obj[keyMatch[1]] = parts[i + 1];
  }
  return Object.keys(obj).length > 0 ? obj : null;
}

/**
 * A structured tool call's `args` is usually the parsed object, but models
 * served over Ollama deliver variants that fail strict `safeParse`:
 *  - the raw JSON arguments STRING instead of a parsed object, and/or
 *  - the real payload nested under a single wrapper key (often the tool name):
 *    `{ record_memories: { operations: [...] } }`.
 * Return every plausible shape so the caller can validate each against the
 * schema and accept the first that matches. Order: as-is, JSON-parsed, unwrapped.
 */
function toolArgCandidates(args: unknown): unknown[] {
  const candidates: unknown[] = [args];
  let obj: unknown = args;
  if (typeof args === "string") {
    try {
      obj = JSON.parse(args);
      candidates.push(obj);
    } catch {
      obj = undefined;
    }
  }
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    const keys = Object.keys(obj as Record<string, unknown>);
    if (keys.length === 1) {
      const inner = (obj as Record<string, unknown>)[keys[0]];
      if (inner && typeof inner === "object") candidates.push(inner);
    }
  }
  return candidates;
}

@Injectable()
export class LLMService {
  private _sessionTokens: SessionUsage;

  constructor(
    private readonly modelService: ModelService,
    private readonly config: ConfigService<BaseConfigInterface>,
    private readonly dumper: LLMCallDumper,
  ) {
    this._sessionTokens = {
      input: 0,
      output: 0,
      total: 0,
      callCount: 0,
    };
  }

  /**
   * Converts AgentMessageType to LangChain BaseMessage
   */
  private _convertToBaseMessage(role: AgentMessageType, content: string): BaseMessage {
    switch (role) {
      case AgentMessageType.System:
        return new SystemMessage(content);
      case AgentMessageType.Assistant:
        return new AIMessage(content);
      case AgentMessageType.User:
        return new HumanMessage(content);
      default:
        return new HumanMessage(content);
    }
  }

  /**
   * Trims history to prevent context overflow
   */
  private _trimHistory(
    history: Array<{ role: AgentMessageType; content: string }>,
    maxMessages?: number,
  ): Array<{ role: AgentMessageType; content: string }> {
    if (!maxMessages || history.length <= maxMessages) {
      return history;
    }

    // Keep the most recent messages
    const trimmed = history.slice(-maxMessages);

    return trimmed;
  }

  /**
   * Auto-generates instructions from input parameters
   *
   * Formats parameters as "key: value" pairs separated by double newlines.
   * Handles primitives, objects, and arrays intelligently.
   *
   * IMPORTANT: For objects/arrays, curly braces are escaped with double braces
   * ({{ and }}) to prevent ChatPromptTemplate from treating them as template
   * variables. ChatPromptTemplate will render {{ as literal { in the final prompt.
   *
   * @param inputParams - Parameters to format
   * @returns Formatted instruction string with escaped braces, or empty string if no params
   */
  private _autoGenerateInstructions(inputParams: Record<string, any>): string {
    const keys = Object.keys(inputParams);

    if (keys.length === 0) {
      return "";
    }

    // const formattedPairs = keys.map((key) => {
    //   const value = inputParams[key];

    //   // Format the value based on its type
    //   let formattedValue: string;
    //   if (value === null || value === undefined) {
    //     formattedValue = String(value);
    //   } else if (typeof value === "object") {
    //     // For objects/arrays, use JSON stringify with formatting
    //     // CRITICAL: Escape curly braces for ChatPromptTemplate
    //     // Single braces {} are interpreted as template variables
    //     // Double braces {{}} render as literal {} in the output
    //     formattedValue = JSON.stringify(value, null, 2).replace(/{/g, "{{").replace(/}/g, "}}");
    //   } else {
    //     formattedValue = String(value);
    //   }

    //   return `${key}: ${formattedValue}`;
    // });
    const formattedPairs = keys.map((key) => {
      const value = inputParams[key];

      let formattedValue: string;
      if (value === null || value === undefined) {
        formattedValue = String(value);
      } else if (typeof value === "object") {
        formattedValue = JSON.stringify(value, null, 2).replace(/{/g, "{{").replace(/}/g, "}}");
      } else {
        // ✅ FIX: Escape braces in string values too!
        formattedValue = String(value).replace(/{/g, "{{").replace(/}/g, "}}");
      }

      return `${key}: ${formattedValue}`;
    });

    return formattedPairs.join("\n\n");
  }

  /**
   * Generates schema-guided instructions with inline descriptions
   *
   * This method enhances auto-generated instructions by including field descriptions
   * from the input schema. This provides the LLM with semantic context about each
   * input parameter, improving understanding and adherence to constraints.
   *
   * Benefits:
   * - LLM understands field purposes (e.g., "use likes to SUBTLY influence tone")
   * - LLM receives explicit constraints (e.g., "FORBIDDEN - never repeat these")
   * - Reduces need for redundant explanations in system prompts
   * - Single source of truth for input semantics
   *
   * Format: "fieldName (description): value"
   *
   * @param inputParams - Parameters to format (actual values)
   * @param inputSchema - Optional Zod schema with descriptions
   * @returns Formatted instruction string with inline descriptions
   *
   * @example Without schema (fallback to auto-generation):
   * ```typescript
   * _generateSchemaGuidedInstructions({ name: "Alice" })
   * // Returns: "name: Alice"
   * ```
   *
   * @example With schema (includes descriptions):
   * ```typescript
   * const schema = z.object({
   *   name: z.string().describe("The user's name"),
   *   recentActions: z.array(z.string()).describe("FORBIDDEN - never repeat")
   * });
   * _generateSchemaGuidedInstructions({ name: "Alice", recentActions: ["wave"] }, schema)
   * // Returns:
   * // "name (The user's name): Alice
   * //
   * // recentActions (FORBIDDEN - never repeat): ["wave"]"
   * ```
   */
  private _generateSchemaGuidedInstructions(inputParams: Record<string, any>, inputSchema?: ZodType): string {
    const keys = Object.keys(inputParams);

    if (keys.length === 0) {
      return "";
    }

    // If no schema provided, fall back to basic auto-generation
    if (!inputSchema) {
      return this._autoGenerateInstructions(inputParams);
    }

    // Extract schema metadata (field descriptions)
    const schemaMetadata = extractSchemaMetadata(inputSchema);

    // Format each field with its description (if available)
    const formattedPairs = keys.map((key) => {
      const value = inputParams[key];
      const fieldMetadata = schemaMetadata.fields[key];

      return formatFieldWithDescription(key, value, fieldMetadata?.description);
    });

    return formattedPairs.join("\n\n");
  }

  /**
   * Creates message array for ChatPromptTemplate using MessagesPlaceholder pattern
   */
  private _createMessages(params: {
    systemPrompts: string[];
    instructions?: string;
    inputParams: Record<string, any>;
    inputSchema?: ZodType;
    history?: Array<{ role: AgentMessageType; content: string }>;
    maxHistoryMessages?: number;
  }): {
    template: Array<[AgentMessageType, string] | MessagesPlaceholder>;
    historyMessages: BaseMessage[];
  } {
    const templateMessages: Array<[AgentMessageType, string] | MessagesPlaceholder> = [];

    // Add system prompts
    params.systemPrompts.forEach((systemPrompt) => {
      templateMessages.push([AgentMessageType.System, systemPrompt.replace(/{/g, "{{").replace(/}/g, "}}")]);
    });

    // Add placeholder for conversation history (modern LangChain pattern)
    templateMessages.push(new MessagesPlaceholder("chat_history"));

    // Determine final instructions: use provided or generate with schema guidance
    const finalInstructions =
      params.instructions || this._generateSchemaGuidedInstructions(params.inputParams, params.inputSchema);

    // Add instructions with {placeholders} intact - ChatPromptTemplate will substitute them
    templateMessages.push([AgentMessageType.User, finalInstructions]);

    // Prepare history messages
    let historyToUse = params.history || [];

    // Trim history if needed
    if (params.maxHistoryMessages) {
      historyToUse = this._trimHistory(historyToUse, params.maxHistoryMessages);
    }

    // Convert to BaseMessage format
    const historyMessages = historyToUse.map((entry) => this._convertToBaseMessage(entry.role, entry.content));

    return {
      template: templateMessages,
      historyMessages,
    };
  }

  /**
   * Calls the LLM with structured input/output using LangChain.
   *
   * This method:
   * 1. Builds a chat prompt from system prompts, history, and user instructions
   * 2. Auto-generates instructions from inputParams if not provided
   * 3. Trims history if maxHistoryMessages is specified (prevents context overflow)
   * 4. Substitutes {placeholders} in instructions with values from inputParams
   * 5. Calls the LLM with structured output enforcement (via function calling)
   * 6. Implements automatic retry logic with exponential backoff
   * 7. Returns the parsed response with token usage metadata
   * 8. Tracks session-level token usage
   *
   * @template T - The expected output type (inferred from outputSchema)
   *
   * @param params - Call parameters
   * @param params.inputParams - Variables to substitute in instruction template, or to auto-generate
   *                              Keys match {placeholders} in instructions (if provided)
   *                              Example: {character: {...}, userMessage: "Hello"}
   * @param params.inputSchema - Optional Zod schema for input validation and context injection
   *                              Field descriptions are extracted and included in prompts
   * @param params.outputSchema - Zod schema defining expected LLM response structure
   * @param params.systemPrompts - Array of system prompts to set context/behavior
   * @param params.instructions - Optional user instructions template with {placeholders}
   *                               If omitted, auto-generates from inputParams (with schema descriptions if provided)
   *                               Example: "Character: {character}\nUser says: {userMessage}"
   * @param params.temperature - Optional temperature override (0-2, default from config)
   * @param params.history - Optional conversation history as role/content pairs
   * @param params.maxHistoryMessages - Optional limit on history size (default: unlimited)
   * @param params.maxTokens - Optional max tokens for response
   * @param params.timeout - Optional timeout in milliseconds
   * @param params.metadata - Optional metadata for LangSmith tracking
   * @param params.stopSequences - Optional stop sequences
   * @param params.validateInput - Optional flag to enable input validation (default: false)
   * @param params.tools - Optional array of tools to bind to the LLM
   * @param params.maxToolIterations - Optional max tool call iterations (default: 5)
   *
   * @returns Promise resolving to parsed output + token usage metadata
   * @throws {Error} If LLM call fails or returns invalid structured output
   *
   * @example Simple case (auto-generated instructions):
   * ```typescript
   * const response = await llm.call({
   *   inputParams: { character: {...}, userMessage: "Hello" },
   *   outputSchema: z.object({ response: z.string() }),
   *   systemPrompts: ["You are a helpful assistant"],
   *   // No instructions - auto-generates: "character: {...}\n\nuserMessage: Hello"
   * });
   * ```
   *
   * @example Custom instructions with placeholders:
   * ```typescript
   * const response = await llm.call({
   *   inputParams: {
   *     character: { name: "Zoe", description: "..." },
   *     userMessage: "Hello"
   *   },
   *   outputSchema: z.object({ response: z.string() }),
   *   systemPrompts: ["You are a helpful assistant"],
   *   instructions: "Character: {character}\nUser says: {userMessage}\nRespond in character:",
   *   temperature: 0.7,
   *   maxHistoryMessages: 20,
   *   metadata: { node_type: "character" },
   *   history: [
   *     { role: AgentMessageType.User, content: "Previous message" },
   *     { role: AgentMessageType.Assistant, content: "Previous response" }
   *   ]
   * });
   * ```
   */
  async call<T>(
    params: LLMCallParams<T>,
  ): Promise<T & { tokenUsage: { input: number; output: number }; modelWeight: ModelWeight }> {
    const modelWeight = params.modelWeight ?? ModelWeight.Normal;
    const aiConfig = this.modelService.getResolvedConfig(modelWeight);
    const session: DumpSession = this.dumper.startSession({
      metadata: params.metadata as DumpSessionStartParams["metadata"],
      model: aiConfig.model,
      provider: aiConfig.provider,
      temperature: params.temperature,
    });
    let totalInput = 0;
    let totalOutput = 0;
    const parseFallbacks: Array<"tool_calls" | "lenient" | "raw"> = [];
    const warnings: string[] = [];
    try {
      const result = await this._invokeOriginal<T>(
        params,
        session,
        (i, o) => {
          totalInput += i;
          totalOutput += o;
        },
        (kind) => parseFallbacks.push(kind),
        (w) => warnings.push(w),
      );
      session.close({
        finalStatus: "success",
        totalTokens: { input: totalInput, output: totalOutput },
        warnings,
        parseFallbacks,
      });
      return { ...result, modelWeight };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? (error.stack ?? "").split("\n").slice(0, 10).join("\n") : undefined;
      session.close({
        finalStatus: "error",
        errorMessage: message,
        errorStack: stack,
        totalTokens: { input: totalInput, output: totalOutput },
        warnings,
        parseFallbacks,
      });
      console.error("[LLMService] Error calling LLM:", error);
      throw new Error(`LLM service error: ${message}`);
    }
  }

  private async _invokeOriginal<T>(
    params: LLMCallParams<T>,
    session: DumpSession,
    addTokens: (input: number, output: number) => void,
    addParseFallback: (kind: "tool_calls" | "lenient" | "raw") => void,
    addWarning: (msg: string) => void,
  ): Promise<T & { tokenUsage: { input: number; output: number } }> {
    // Optional: Validate input parameters against schema
    if (params.inputSchema && params.validateInput) {
      try {
        params.inputParams = params.inputSchema.parse(params.inputParams);
      } catch (validationError) {
        console.error("[LLMService] Input validation failed:", validationError);
        throw new Error(
          `Invalid input parameters: ${validationError instanceof Error ? validationError.message : "Unknown validation error"}`,
        );
      }
    }

    // Create messages with modern MessagesPlaceholder pattern (with schema-guided instructions)
    const { template, historyMessages } = this._createMessages({
      systemPrompts: params.systemPrompts,
      instructions: params.instructions,
      inputParams: params.inputParams,
      inputSchema: params.inputSchema,
      history: params.history,
      maxHistoryMessages: params.maxHistoryMessages,
    });

    const prompt = ChatPromptTemplate.fromMessages(template);

    // Get base model
    const baseModel = this.modelService.getLLM({
      temperature: params.temperature,
      modelWeight: params.modelWeight,
    });

    // Build config options for the invocation
    const configOptions: Record<string, any> = {};
    if (params.maxTokens) configOptions.maxTokens = params.maxTokens;
    if (params.stopSequences) configOptions.stop = params.stopSequences;
    if (params.metadata) configOptions.metadata = params.metadata;
    if (params.timeout) configOptions.timeout = params.timeout;

    // Track token usage across tool iterations
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    // Build initial messages for the conversation
    const conversationMessages: BaseMessage[] = await prompt.formatMessages({
      ...params.inputParams,
      chat_history: historyMessages,
    });

    session.recordInputs({
      systemPrompts: params.systemPrompts,
      instructions:
        params.instructions ?? this._generateSchemaGuidedInstructions(params.inputParams, params.inputSchema),
      inputParams: params.inputParams,
      history: (params.history ?? []).map((h) => ({ role: String(h.role), content: h.content })),
      tools: (params.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description,
        schema: (t as any).schema,
      })),
      outputSchemaName: (params.outputSchema as any)?.constructor?.name ?? "outputSchema",
    });

    // If tools are provided, handle tool calling loop
    if (params.tools && params.tools.length > 0) {
      const maxIterations = params.maxToolIterations ?? 5;

      // Build tool map for execution
      const toolMap = new Map<string, DynamicStructuredTool>();
      for (const tool of params.tools) {
        toolMap.set(tool.name, tool);
      }

      // Bind tools to model
      const modelWithTools = baseModel.bindTools(params.tools);

      // Tool calling loop
      for (let iteration = 0; iteration < maxIterations; iteration++) {
        session.startIteration("tool-loop", conversationMessages);
        // Call model with tools
        const toolResponse =
          Object.keys(configOptions).length > 0
            ? await modelWithTools.invoke(conversationMessages, configOptions)
            : await modelWithTools.invoke(conversationMessages);

        session.recordResponse({
          content: typeof (toolResponse as any).content === "string" ? (toolResponse as any).content : "",
          toolCalls: ((toolResponse as AIMessage).tool_calls ?? []).map((c) => ({
            id: c.id ?? "",
            name: c.name,
            args: c.args,
          })),
          tokenUsage: {
            input: (toolResponse as unknown as LLMRawResponse).usage_metadata?.input_tokens ?? 0,
            output: (toolResponse as unknown as LLMRawResponse).usage_metadata?.output_tokens ?? 0,
          },
          finishReason: (toolResponse as unknown as LLMRawResponse).response_metadata?.finish_reason,
        });

        // Track token usage
        const responseUsage = (toolResponse as unknown as LLMRawResponse).usage_metadata;
        if (responseUsage) {
          totalInputTokens += responseUsage.input_tokens ?? 0;
          totalOutputTokens += responseUsage.output_tokens ?? 0;
        }

        // Check for tool calls
        const toolCalls = (toolResponse as AIMessage).tool_calls ?? [];

        if (toolCalls.length === 0) {
          // No more tool calls - break to get final structured response
          break;
        }

        // Add AI message with tool calls to conversation
        conversationMessages.push(toolResponse);

        // Execute each tool call
        for (const toolCall of toolCalls) {
          const tool = toolMap.get(toolCall.name);

          if (!tool) {
            console.warn(`[LLMService] Tool not found: ${toolCall.name}`);
            conversationMessages.push(
              new ToolMessage({
                content: `Tool "${toolCall.name}" not found`,
                tool_call_id: toolCall.id ?? "",
              }),
            );
            session.recordToolResult(toolCall.id ?? "", toolCall.name, `Tool "${toolCall.name}" not found`);
            continue;
          }

          try {
            const result = await tool.invoke(toolCall.args);
            const resultStr = typeof result === "string" ? result : JSON.stringify(result);
            conversationMessages.push(
              new ToolMessage({
                content: resultStr,
                tool_call_id: toolCall.id ?? "",
              }),
            );
            session.recordToolResult(toolCall.id ?? "", toolCall.name, resultStr);
          } catch (error) {
            console.error(`[LLMService] Tool error: ${toolCall.name}`, error);
            conversationMessages.push(
              new ToolMessage({
                content: `Tool error: ${error instanceof Error ? error.message : "Unknown error"}`,
                tool_call_id: toolCall.id ?? "",
              }),
            );
            session.recordToolResult(
              toolCall.id ?? "",
              toolCall.name,
              `Tool error: ${error instanceof Error ? error.message : "Unknown error"}`,
            );
          }
        }
      }
    }

    // Nudge the model out of tool-use mode before asking for the final structured
    // answer. Without this, some models (notably gpt-oss) emit another tool_calls
    // response instead of producing the structured output, and parsing fails with
    // "No content" / finish_reason=tool_calls. The nudge is only appended when the
    // tool-calling loop ran at all.
    if (params.tools && params.tools.length > 0 && conversationMessages.length > 0) {
      conversationMessages.push(
        new HumanMessage(
          "You have gathered enough information from the tool calls above to answer the user's question. Produce your final answer now as the structured output the system expects. Do not request any further tool calls.",
        ),
      );
    }

    // Get final structured response (unified path for both tool and non-tool flows)
    // For Requesty + Gemini: sanitize schema to remove $schema, $defs, etc. that Gemini rejects.
    // Resolve against the same weight getLLM used, so lite/large Gemini models are detected correctly.
    const aiConfig = this.modelService.getResolvedConfig(params.modelWeight);
    // Check if model is Gemini (handles both "gemini-..." and "google/gemini-..." formats)
    const modelLower = aiConfig.model.toLowerCase();
    const isGeminiModel = modelLower.startsWith("gemini") || modelLower.includes("/gemini");
    const needsGeminiSanitization = aiConfig.provider === "requesty" && isGeminiModel;

    let structuredLlm;
    if (needsGeminiSanitization) {
      // Convert Zod to JSON Schema and remove Gemini-incompatible properties
      const jsonSchema = convertZodToJsonSchema(params.outputSchema);
      const sanitizedSchema = sanitizeSchemaForGemini(jsonSchema);
      structuredLlm = baseModel.withStructuredOutput(sanitizedSchema, {
        includeRaw: true,
      });
    } else {
      // All other providers: use Zod schema directly
      structuredLlm = baseModel.withStructuredOutput(params.outputSchema, {
        includeRaw: true,
      });
    }

    session.startIteration("final-structured", conversationMessages);

    const response = (await structuredLlm.invoke(
      conversationMessages,
      Object.keys(configOptions).length > 0 ? configOptions : undefined,
    )) as unknown as StructuredOutputResponse<T>;

    // Extract token usage with type guard (includes tool iteration tokens)
    const raw = isValidRaw(response.raw) ? response.raw : undefined;

    session.recordResponse({
      content: typeof raw?.content === "string" ? raw.content : "",
      tokenUsage: {
        input: raw?.usage_metadata?.input_tokens ?? 0,
        output: raw?.usage_metadata?.output_tokens ?? 0,
      },
      finishReason: raw?.response_metadata?.finish_reason,
    });
    const input = totalInputTokens + (raw?.usage_metadata?.input_tokens ?? 0);
    const output = totalOutputTokens + (raw?.usage_metadata?.output_tokens ?? 0);

    // Update session tracking
    this._sessionTokens.input += input;
    this._sessionTokens.output += output;
    this._sessionTokens.total += input + output;
    this._sessionTokens.callCount += 1;

    // Warn if high token usage
    const totalTokens = input + output;
    if (totalTokens > 8000) {
      const msg = `High token usage detected: ${totalTokens} tokens in this call`;
      console.warn(`[LLMService] ${msg}`);
      addWarning(msg);
    }

    // Enhanced error handling with detailed diagnostics
    if (!response.parsed) {
      const rawContent = raw?.content || "No content";
      const finishReason = raw?.response_metadata?.finish_reason;

      console.error("[LLMService] Parsing failed:", {
        rawContentPreview: rawContent.substring(0, 500),
        finishReason,
        schemaName: params.outputSchema.constructor.name,
      });

      // Attempt fallback parsing from tool_calls first (Azure/OpenAI function calling puts structured data here)
      const rawAnyFallback = raw as any;
      const toolCallArgs = rawAnyFallback?.tool_calls?.[0]?.args;
      if (toolCallArgs && typeof toolCallArgs === "object") {
        addParseFallback("tool_calls");
        try {
          console.warn("[LLMService] Attempting fallback parsing from tool_calls args");
          const validated = params.outputSchema.parse(toolCallArgs);

          console.warn("[LLMService] Fallback tool_calls parsing succeeded");

          addTokens(input, output);
          return {
            ...(validated as T),
            tokenUsage: { input, output },
          };
        } catch (_toolCallFallbackError) {
          // Lenient fallback: filter out malformed array entries from tool_calls args
          // This handles cases where the model returns mostly valid data with a few corrupt entries
          addParseFallback("lenient");
          try {
            console.warn("[LLMService] Attempting lenient tool_calls parsing (filtering invalid array entries)");
            const cleanedArgs = { ...toolCallArgs };
            const shape = (params.outputSchema as any)?.shape;

            if (shape) {
              for (const [key, fieldSchema] of Object.entries(shape)) {
                if (Array.isArray(cleanedArgs[key])) {
                  // In Zod v4, ZodArray exposes .element as the element schema with .safeParse()
                  // Unwrap optional/default/nullable wrappers first if present
                  let schema = fieldSchema as any;
                  while (schema?.unwrap && !schema?.element) {
                    schema = schema.unwrap();
                  }
                  const elementSchema = schema?.element;

                  if (elementSchema && typeof elementSchema.safeParse === "function") {
                    const original = cleanedArgs[key];
                    cleanedArgs[key] = original.filter((entry: any) => elementSchema.safeParse(entry).success);
                    if (cleanedArgs[key].length < original.length) {
                      console.warn(
                        `[LLMService] Filtered ${original.length - cleanedArgs[key].length}/${original.length} invalid entries from "${key}"`,
                      );
                    }
                  }
                }
              }
            }

            const validated = params.outputSchema.parse(cleanedArgs);
            console.warn("[LLMService] Lenient tool_calls parsing succeeded");

            addTokens(input, output);
            return {
              ...(validated as T),
              tokenUsage: { input, output },
            };
          } catch {
            // Fall through to raw content parsing
          }
        }
      }

      // Attempt fallback parsing from raw content
      addParseFallback("raw");
      try {
        console.warn("[LLMService] Attempting fallback JSON parsing");
        const manualParse = JSON.parse(rawContent);
        const validated = params.outputSchema.parse(manualParse);

        console.warn("[LLMService] Fallback parsing succeeded");

        addTokens(input, output);
        return {
          ...(validated as T),
          tokenUsage: { input, output },
        };
      } catch (fallbackError) {
        throw new Error(
          `LLM failed to return structured output. ` +
            `Finish reason: ${finishReason}. ` +
            `Raw content preview: ${rawContent.substring(0, 200)}...` +
            `Fallback parsing error: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`,
        );
      }
    }

    addTokens(input, output);
    return {
      ...(response.parsed as T),
      tokenUsage: {
        input,
        output,
      },
    };
  }

  /**
   * Streaming variant of {@link call}. Same structured-input/structured-output
   * contract — uses `outputSchema` (Zod) for enforced structured output and
   * `inputSchema` for schema-guided instructions — but yields the LLM's
   * response progressively as it generates.
   *
   * Returns two handles:
   *   - `textStream` — raw JSON-text fragments as the LLM builds the object.
   *     Useful for forwarding to clients that incrementally parse JSON (e.g.
   *     BlockNote AI's UIMessageStream consumer). MUST be consumed (even if
   *     just to drain) for `result` to resolve — `streamObject` only commits
   *     the final object after the source stream is fully read.
   *   - `result` — Promise that resolves to the final fully-parsed structured
   *     output + token usage, once the stream completes. Equivalent to what
   *     `call` returns.
   *
   * Returns `partialObjectStream` (not `textStream`): each iteration yields
   * the cumulative best-effort parse of the output object as it grows. For a
   * schema like `z.object({ paragraph: z.string() })`, consumers see
   * `{paragraph: undefined}` → `{paragraph: "Jam"}` → `{paragraph: "James"}`
   * etc., letting them extract field-value deltas without parsing raw JSON
   * tokens themselves.
   *
   * Note: only one stream view is exposed because `streamObject`'s
   * `textStream` / `partialObjectStream` / `fullStream` getters all consume
   * the same underlying source — accessing two of them locks the source on
   * the first and throws on the second. For consumers that want raw JSON
   * text fragments instead, add a separate variant.
   *
   * Implementation note: uses Vercel AI SDK's `streamObject` under the hood
   * because LangChain's `withStructuredOutput().stream()` only yields parsed
   * partials — not the raw JSON text fragments that downstream UI-message
   * consumers (BlockNote AI, the AI SDK's own React hooks, etc.) need to
   * apply changes incrementally. `call` stays on LangChain for non-streaming
   * structured output — both paths share `_generateSchemaGuidedInstructions`
   * for input formatting and the `LLMCallDumper` session for cost tracking.
   *
   * Provider support: currently OpenAI-compatible only (llamacpp, openrouter,
   * requesty, plus any other provider exposed via an OpenAI-compatible URL).
   * Throws for vertex/azure with native (non-OpenAI-compat) configurations.
   * Extend via new `@ai-sdk/*` provider adapters when needed.
   */
  async streamCall<T extends Record<string, any>>(
    params: LLMCallParams<T>,
  ): Promise<{
    partialObjectStream: AsyncIterable<Partial<T>>;
    result: Promise<T & { tokenUsage: { input: number; output: number }; modelWeight: ModelWeight }>;
  }> {
    const modelWeight = params.modelWeight ?? ModelWeight.Normal;
    const aiConfig = this.modelService.getResolvedConfig(modelWeight);
    const session: DumpSession = this.dumper.startSession({
      metadata: params.metadata as DumpSessionStartParams["metadata"],
      model: aiConfig.model,
      provider: aiConfig.provider,
      temperature: params.temperature,
    });

    // Build the same schema-guided instruction string `call` would build, so
    // structured input semantics (field descriptions from `inputSchema`) flow
    // through identically. If the caller passed explicit `instructions` with
    // {placeholders}, substitute them from `inputParams` (mimicking
    // ChatPromptTemplate's behavior without dragging in the LangChain runtime).
    let finalInstructions =
      params.instructions || this._generateSchemaGuidedInstructions(params.inputParams, params.inputSchema);
    if (params.instructions && params.inputParams) {
      for (const [key, value] of Object.entries(params.inputParams)) {
        const placeholder = `{${key}}`;
        if (!finalInstructions.includes(placeholder)) continue;
        const formatted = typeof value === "string" ? value : JSON.stringify(value);
        finalInstructions = finalInstructions.split(placeholder).join(formatted);
      }
    }

    const system = params.systemPrompts.join("\n\n");

    session.recordInputs({
      systemPrompts: params.systemPrompts,
      instructions: finalInstructions,
      inputParams: params.inputParams,
      history: [],
      tools: [],
      outputSchemaName: (params.outputSchema as any)?.constructor?.name ?? "outputSchema",
    });

    // Map narr8 provider → Vercel AI SDK provider adapter. v1 supports
    // OpenAI-compatible providers only; extend with new `@ai-sdk/*` packages
    // (e.g. `@ai-sdk/google-vertex`, `@ai-sdk/azure`) when narr8 starts using
    // a non-OpenAI-compat path with streamCall.
    const openaiCompatProviders = new Set(["llamacpp", "local", "openrouter", "requesty"]);
    if (!openaiCompatProviders.has(aiConfig.provider) && aiConfig.url) {
      // If the configured `url` exists, treat as OpenAI-compatible by default —
      // most narr8 setups route through an OpenAI-compatible endpoint even for
      // azure/vertex via custom URLs.
    } else if (!openaiCompatProviders.has(aiConfig.provider)) {
      session.close({
        finalStatus: "error",
        errorMessage: `streamCall does not yet support provider "${aiConfig.provider}"`,
        totalTokens: { input: 0, output: 0 },
        warnings: [],
        parseFallbacks: [],
      });
      throw new Error(
        `LLMService.streamCall: provider "${aiConfig.provider}" not supported. ` +
          `Add a Vercel AI SDK adapter to LLMService.streamCall or use an OpenAI-compatible URL.`,
      );
    }

    const provider = createOpenAICompatible({
      name: aiConfig.provider || "narr8",
      apiKey: aiConfig.apiKey,
      baseURL: aiConfig.url,
      // Pin OpenRouter routing on the streaming path too (the LangChain path
      // pins via modelKwargs; this SDK builds its own model). Without it the
      // stream is unpinned and can be moderated by a misrouted provider.
      ...(aiConfig.provider === "openrouter" && aiConfig.region
        ? { fetch: openRouterPinnedFetch(aiConfig.region, aiConfig.allowFallbacks ?? true) }
        : {}),
    });
    const model = provider.chatModel(aiConfig.model);

    // Reuse the "final-structured" iteration kind — semantically this IS the
    // final-structured response, just streamed instead of awaited atomically.
    // Avoids widening the dumper's union type for a single call site.
    session.startIteration("final-structured", []);

    // Schema cast: `streamObject`'s typing is a conditional union over the
    // output mode (`object` / `enum` / `array` / `no-schema`). Our T is always
    // a Zod object schema; the runtime call is correct.
    const streamResult = streamObject({
      model,
      schema: params.outputSchema as any,
      system,
      prompt: finalInstructions,
      temperature: params.temperature,
      maxOutputTokens: params.maxTokens,
    });

    // Build the result Promise that closes the session once the stream finishes.
    // This is awaitable independently of consuming the streams — `streamObject`
    // internally tees the source, so consuming `textStream` (or not) doesn't
    // affect `result` resolution.
    const resultPromise: Promise<T & { tokenUsage: { input: number; output: number }; modelWeight: ModelWeight }> =
      (async () => {
        try {
          const finalObject = (await streamResult.object) as T;
          const usage = await streamResult.usage;
          const input = usage?.inputTokens ?? 0;
          const output = usage?.outputTokens ?? 0;

          this._sessionTokens.input += input;
          this._sessionTokens.output += output;
          this._sessionTokens.total += input + output;
          this._sessionTokens.callCount += 1;

          session.recordResponse({
            content: JSON.stringify(finalObject),
            tokenUsage: { input, output },
            finishReason: String(await streamResult.finishReason),
          });
          session.close({
            finalStatus: "success",
            totalTokens: { input, output },
            warnings: [],
            parseFallbacks: [],
          });

          return { ...(finalObject as any), tokenUsage: { input, output }, modelWeight };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const stack = error instanceof Error ? (error.stack ?? "").split("\n").slice(0, 10).join("\n") : undefined;
          session.close({
            finalStatus: "error",
            errorMessage: message,
            errorStack: stack,
            totalTokens: { input: 0, output: 0 },
            warnings: [],
            parseFallbacks: [],
          });
          console.error("[LLMService.streamCall] Error:", error);
          throw new Error(`LLM streamCall error: ${message}`);
        }
      })();

    // Guard against an unhandled rejection if the caller never awaits `result`.
    void resultPromise.catch(() => undefined);

    return {
      partialObjectStream: streamResult.partialObjectStream as AsyncIterable<Partial<T>>,
      result: resultPromise,
    };
  }

  /**
   * Plain-text streaming variant of {@link streamCall}. Unlike `streamCall`
   * (which enforces a Zod `outputSchema` via `streamObject` and therefore
   * requires the model/provider to support structured/JSON output), this method
   * streams free-form text via the Vercel AI SDK's `streamText`.
   *
   * Use this when:
   *   - The desired output is just prose (no structured object), AND/OR
   *   - The provider/model does not support JSON response formats
   *     (e.g. Ollama with many local models), where `streamObject` fails with
   *     `NoObjectGeneratedError` because the model returns prose, not JSON.
   *
   * Returns two handles:
   *   - `fullStream` — normalized incremental parts as the model generates them:
   *     `{ type: "text", delta }` for answer content and `{ type: "reasoning",
   *     delta }` for a reasoning/"thinking" trace (emitted by reasoning-capable
   *     models — e.g. Ollama surfaces `delta.reasoning` over its OpenAI-compatible
   *     endpoint). Non-reasoning models simply never yield `reasoning` parts.
   *     MUST be consumed for `result` to resolve.
   *   - `result` — Promise resolving to the final concatenated answer `text`, the
   *     full `reasoning` trace (empty string when the model emits none), and token
   *     usage once the stream completes.
   *
   * Provider support mirrors `streamCall`: OpenAI-compatible only (llamacpp,
   * local, openrouter, requesty, ollama, plus any provider exposed via an
   * OpenAI-compatible URL).
   */
  async streamText(params: {
    systemPrompts: string[];
    prompt: string;
    temperature?: number;
    maxTokens?: number;
    modelWeight?: ModelWeight;
    metadata?: Record<string, any>;
  }): Promise<{
    fullStream: AsyncIterable<{ type: "text" | "reasoning"; delta: string }>;
    result: Promise<{
      text: string;
      reasoning: string;
      tokenUsage: { input: number; output: number };
      modelWeight: ModelWeight;
    }>;
  }> {
    const modelWeight = params.modelWeight ?? ModelWeight.Normal;
    const aiConfig = this.modelService.getResolvedConfig(modelWeight);
    const session: DumpSession = this.dumper.startSession({
      metadata: params.metadata as DumpSessionStartParams["metadata"],
      model: aiConfig.model,
      provider: aiConfig.provider,
      temperature: params.temperature,
    });

    const system = params.systemPrompts.join("\n\n");

    session.recordInputs({
      systemPrompts: params.systemPrompts,
      instructions: params.prompt,
      inputParams: {},
      history: [],
      tools: [],
      outputSchemaName: "text",
    });

    // Same OpenAI-compatible provider gate as streamCall.
    const openaiCompatProviders = new Set(["llamacpp", "local", "openrouter", "requesty", "ollama"]);
    if (!openaiCompatProviders.has(aiConfig.provider) && !aiConfig.url) {
      session.close({
        finalStatus: "error",
        errorMessage: `streamText does not yet support provider "${aiConfig.provider}"`,
        totalTokens: { input: 0, output: 0 },
        warnings: [],
        parseFallbacks: [],
      });
      throw new Error(
        `LLMService.streamText: provider "${aiConfig.provider}" not supported. ` +
          `Add a Vercel AI SDK adapter to LLMService.streamText or use an OpenAI-compatible URL.`,
      );
    }

    const provider = createOpenAICompatible({
      name: aiConfig.provider || "narr8",
      apiKey: aiConfig.apiKey,
      baseURL: aiConfig.url,
      // Pin OpenRouter routing on the streaming path too (see streamCall). The
      // narrator runs here; an unpinned stream can be misrouted to a moderating
      // provider that refuses explicit content mid-stream.
      ...(aiConfig.provider === "openrouter" && aiConfig.region
        ? { fetch: openRouterPinnedFetch(aiConfig.region, aiConfig.allowFallbacks ?? true) }
        : {}),
    });
    const model = provider.chatModel(aiConfig.model);

    session.startIteration("final-structured", []);

    const streamResult = streamText({
      model,
      system,
      prompt: params.prompt,
      temperature: params.temperature,
      maxOutputTokens: params.maxTokens,
    });

    const resultPromise: Promise<{
      text: string;
      reasoning: string;
      tokenUsage: { input: number; output: number };
      modelWeight: ModelWeight;
    }> = (async () => {
      try {
        const text = await streamResult.text;
        const reasoning = (await streamResult.reasoningText) ?? "";
        const usage = await streamResult.usage;
        const input = usage?.inputTokens ?? 0;
        const output = usage?.outputTokens ?? 0;

        this._sessionTokens.input += input;
        this._sessionTokens.output += output;
        this._sessionTokens.total += input + output;
        this._sessionTokens.callCount += 1;

        session.recordResponse({
          content: text,
          tokenUsage: { input, output },
          finishReason: String(await streamResult.finishReason),
        });
        session.close({
          finalStatus: "success",
          totalTokens: { input, output },
          warnings: [],
          parseFallbacks: [],
        });

        return { text, reasoning, tokenUsage: { input, output }, modelWeight };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? (error.stack ?? "").split("\n").slice(0, 10).join("\n") : undefined;
        session.close({
          finalStatus: "error",
          errorMessage: message,
          errorStack: stack,
          totalTokens: { input: 0, output: 0 },
          warnings: [],
          parseFallbacks: [],
        });
        console.error("[LLMService.streamText] Error:", error);
        throw new Error(`LLM streamText error: ${message}`);
      }
    })();

    // Normalize the AI SDK `fullStream` to text/reasoning deltas. Consuming this
    // is what drives `resultPromise` (the `text`/`reasoning`/`usage` promises) to
    // resolve. Reasoning-capable models interleave `reasoning-delta` parts (e.g.
    // Ollama emits the full thinking trace before answer content).
    async function* normalizedStream(): AsyncGenerator<{ type: "text" | "reasoning"; delta: string }> {
      for await (const part of streamResult.fullStream) {
        if (part.type === "text-delta") {
          yield { type: "text", delta: part.text };
        } else if (part.type === "reasoning-delta") {
          yield { type: "reasoning", delta: part.text };
        } else if (part.type === "error") {
          throw part.error;
        }
      }
    }

    // Prevent an unhandled promise rejection from crashing the process if the
    // caller stops consuming `fullStream` on error (e.g. the model is
    // unreachable) and therefore never awaits `result`. Attaching a no-op
    // handler marks the promise as handled; callers that DO await it still
    // receive the rejection.
    void resultPromise.catch(() => undefined);

    return {
      fullStream: normalizedStream(),
      result: resultPromise,
    };
  }

  /**
   * Structured extraction via FORCED tool calling — the gemma/Ollama-reliable
   * counterpart to `streamCall`/`call()`'s `withStructuredOutput`, which fails on
   * models that don't support `response_format` json_schema. Forces the model to
   * call a single tool and returns its (Zod-validated) arguments.
   */
  async extractViaTool<T>(params: {
    systemPrompts: string[];
    prompt: string;
    tool: { name: string; description: string; schema: ZodType<T> };
    modelWeight?: ModelWeight;
    metadata?: Record<string, any>;
    disableThinking?: boolean;
    maxOutputTokens?: number;
    frequencyPenalty?: number;
  }): Promise<T> {
    const modelWeight = params.modelWeight ?? ModelWeight.Normal;
    const aiConfig = this.modelService.getResolvedConfig(modelWeight);
    const session: DumpSession = this.dumper.startSession({
      metadata: params.metadata as DumpSessionStartParams["metadata"],
      model: aiConfig.model,
      provider: aiConfig.provider,
      temperature: 0,
    });

    session.recordInputs({
      systemPrompts: params.systemPrompts,
      instructions: params.prompt,
      inputParams: {},
      history: [],
      tools: [{ name: params.tool.name, description: params.tool.description, schema: params.tool.schema }],
      outputSchemaName: params.tool.name,
    });

    try {
      const model = this.modelService.getLLM({
        modelWeight,
        disableThinking: params.disableThinking,
        maxOutputTokens: params.maxOutputTokens,
        frequencyPenalty: params.frequencyPenalty,
      });
      const tool = new DynamicStructuredTool({
        name: params.tool.name,
        description: params.tool.description,
        schema: params.tool.schema as any,
        func: async (input: unknown) => JSON.stringify(input),
      });
      const bound = model.bindTools!([tool], { tool_choice: params.tool.name });
      const systemPrompt = params.systemPrompts.join("\n\n");
      const baseMessages = [new SystemMessage(systemPrompt), new HumanMessage(params.prompt)];
      session.startIteration("final-structured", []);

      // Diagnostic for the no-tool-call path: dump exactly what the provider
      // returned so a future regression is debuggable without re-instrumenting.
      const describe = (r: AIMessage, attempt: string) => {
        const content = typeof r?.content === "string" ? r.content : JSON.stringify(r?.content);
        const call0 = (r?.tool_calls ?? [])[0];
        console.error(
          `[extractViaTool] ${params.tool.name} ${attempt}: no parseable tool call — ` +
            `finish_reason=${(r as any)?.response_metadata?.finish_reason} ` +
            `tool_calls=${(r?.tool_calls ?? []).length} invalid_tool_calls=${((r as any)?.invalid_tool_calls ?? []).length} ` +
            `contentLen=${content?.length ?? 0}`,
        );
        if (call0) {
          // A tool call WAS returned but its args failed the schema — log the args
          // and the validation issues so the mismatch is visible.
          const issues = params.tool.schema.safeParse(call0.args as unknown);
          console.error(
            `[extractViaTool] ${params.tool.name} ${attempt} tool_call.args(typeof=${typeof call0.args})=` +
              `${JSON.stringify(call0.args)?.slice(0, 2000)}`,
          );
          console.error(
            `[extractViaTool] ${params.tool.name} ${attempt} zodIssues=` +
              `${JSON.stringify(issues.success ? [] : issues.error.issues)?.slice(0, 1500)}`,
          );
        }
        console.error(`[extractViaTool] ${params.tool.name} ${attempt} content<<<\n${content?.slice(0, 2000)}\n>>>`);
      };

      // Resilience for local models (Gemma/Ollama) that ignore the forced
      // `tool_choice` and answer with text: accept a real tool call OR a payload
      // recovered from the message content (JSON, or Gemma's pseudo-token tool
      // text). `tool_choice` is only a soft hint on the OpenAI-compatible Ollama
      // endpoint, so a single empty `tool_calls` is NOT a hard failure — mirror
      // `streamCall`'s tool_calls → raw-content fallback chain. Returns the
      // validated payload or null.
      const tryExtract = (response: AIMessage): T | null => {
        const call = (response.tool_calls ?? [])[0];
        if (call) {
          // Try the args as-is, JSON-parsed (if a string), and unwrapped from a
          // single-key wrapper — accept the first shape that matches the schema.
          for (const candidate of toolArgCandidates(call.args)) {
            const fromTool = params.tool.schema.safeParse(candidate);
            if (fromTool.success) return fromTool.data;
          }
        }
        // 1) Model emitted the call as a JSON object in content (bare/fenced/prose).
        const salvaged = extractJsonObject(response.content);
        if (salvaged) {
          const fromContent = params.tool.schema.safeParse(salvaged);
          if (fromContent.success) {
            console.warn(`[extractViaTool] recovered ${params.tool.name} from JSON in message content`);
            return fromContent.data;
          }
        }
        // 2) Gemma/MLX emitted the call as pseudo-token text (`name{k:<|"|>v<|"|>}<tool_call|>`).
        const gemma = parseGemmaToolCallText(response.content);
        if (gemma) {
          const fromGemma = params.tool.schema.safeParse(gemma);
          if (fromGemma.success) {
            console.warn(`[extractViaTool] recovered ${params.tool.name} from Gemma pseudo-token tool text`);
            return fromGemma.data;
          }
        }
        return null;
      };

      let response = (await bound.invoke(baseMessages)) as AIMessage;
      let parsed = tryExtract(response);

      // One retry with an explicit nudge — local models frequently comply on a
      // second pass once told plainly that prose is not acceptable.
      if (parsed === null) {
        describe(response, "attempt-1");
        const nudge = new HumanMessage(
          `You did NOT call the \`${params.tool.name}\` tool. Do not write prose, refusals, or explanations. Respond ONLY by calling \`${params.tool.name}\` with valid arguments now.`,
        );
        response = (await bound.invoke([...baseMessages, nudge])) as AIMessage;
        parsed = tryExtract(response);
        if (parsed === null) describe(response, "attempt-2");
      }

      if (parsed === null) throw new Error("extractViaTool: model did not call the tool");
      session.recordResponse({
        content: JSON.stringify(parsed),
        tokenUsage: { input: 0, output: 0 },
        finishReason: "tool_call",
      });
      session.close({ finalStatus: "success", totalTokens: { input: 0, output: 0 }, warnings: [], parseFallbacks: [] });
      return parsed as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      session.close({
        finalStatus: "error",
        errorMessage: message,
        totalTokens: { input: 0, output: 0 },
        warnings: [],
        parseFallbacks: [],
      });
      console.error("[LLMService.extractViaTool] Error:", error);
      throw error instanceof Error ? error : new Error(message);
    }
  }

  /**
   * Get session-level token usage statistics
   *
   * @returns Session usage data including total tokens and call count
   */
  getSessionUsage(): SessionUsage {
    return { ...this._sessionTokens };
  }

  /**
   * Reset session token tracking
   *
   * Useful when starting a new conversation or game session
   */
  resetSession(): void {
    this._sessionTokens = {
      input: 0,
      output: 0,
      total: 0,
      callCount: 0,
    };
  }
}
