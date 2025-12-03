import { AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { Injectable } from "@nestjs/common";
import { ZodType } from "zod";
import { AgentMessageType } from "../../../common/enums/agentmessage.type";
import { ModelService } from "../../llm/services/model.service";
import { extractSchemaMetadata, formatFieldWithDescription } from "../../llm/utils/schema.utils";

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

@Injectable()
export class LLMService {
  private _sessionTokens: SessionUsage;

  constructor(private readonly modelService: ModelService) {
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
  async call<T>(params: LLMCallParams<T>): Promise<T & { tokenUsage: { input: number; output: number } }> {
    try {
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
          // Call model with tools
          const toolResponse =
            Object.keys(configOptions).length > 0
              ? await modelWithTools.invoke(conversationMessages, configOptions)
              : await modelWithTools.invoke(conversationMessages);

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
            } catch (error) {
              console.error(`[LLMService] Tool error: ${toolCall.name}`, error);
              conversationMessages.push(
                new ToolMessage({
                  content: `Tool error: ${error instanceof Error ? error.message : "Unknown error"}`,
                  tool_call_id: toolCall.id ?? "",
                }),
              );
            }
          }
        }
      }

      // Get final structured response (unified path for both tool and non-tool flows)
      const structuredLlm = baseModel.withStructuredOutput(params.outputSchema, {
        includeRaw: true,
      });

      const response = (await structuredLlm.invoke(
        conversationMessages,
        Object.keys(configOptions).length > 0 ? configOptions : undefined,
      )) as unknown as StructuredOutputResponse<T>;

      // Extract token usage with type guard (includes tool iteration tokens)
      const raw = isValidRaw(response.raw) ? response.raw : undefined;
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
        console.warn(`[LLMService] High token usage detected: ${totalTokens} tokens in this call`);
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

        // Attempt fallback parsing
        try {
          console.warn("[LLMService] Attempting fallback JSON parsing");
          const manualParse = JSON.parse(rawContent);
          const validated = params.outputSchema.parse(manualParse);

          console.warn("[LLMService] Fallback parsing succeeded");

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

      return {
        ...(response.parsed as T),
        tokenUsage: {
          input,
          output,
        },
      };
    } catch (error) {
      console.error("[LLMService] Error calling LLM:", error);
      throw new Error(`LLM service error: ${error instanceof Error ? error.message : "Unknown error"}`);
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
