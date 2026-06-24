import { AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { BaseCheckpointSaver, Command, END, START, StateGraph, interrupt } from "@langchain/langgraph";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { z } from "zod";
import { AgentMessageType } from "../../../common/enums/agentmessage.type";
import { MessageInterface } from "../../../common/interfaces/message.interface";
import { BaseConfigInterface, ConfigPromptsInterface } from "../../../config/interfaces";
import { LLMService } from "../../../core/llm/services/llm.service";
import type { ToolCallRecord } from "../../graph/tools/tool.factory";
import type { EntityReference } from "../../responder/interfaces/entity.reference.interface";
import { OperatorCitation, OperatorContext, OperatorContextState } from "../contexts/operator.context";
import type {
  OperatorRetrievalContext,
  OperatorToolCallRecord,
  OperatorToolDefinition,
} from "../interfaces/operator.tool.interface";
import { defaultOperatorSystemPrompt } from "../prompts/operator.system.prompt";
import { OperatorToolRegistry } from "../tools/operator.tool.registry";
import { OperatorCheckpointerService } from "./operator.checkpointer.service";

/** Max agent⇄tools iterations before the run is forced to finalise. */
const MAX_TOOL_ITERATIONS = 15;
/** Graph recursion limit sized for ~15 tool iterations (agent + tools per iteration). */
const RECURSION_LIMIT = 40;

const finalAnswerSchema = z.object({
  answer: z.string(),
  questions: z.array(z.string()),
});

/** Payload frozen into the checkpoint when a destructive tool requests approval. */
interface OperatorInterruptPayload {
  toolName: string;
  toolArgs: Record<string, unknown>;
  summary: string;
}

export type OperatorRunResult =
  | {
      kind: "completed";
      answer: string;
      questions: string[];
      references: EntityReference[];
      citations: OperatorCitation[];
      toolCalls: ToolCallRecord[];
      tokens: { input: number; output: number };
    }
  | { kind: "pending_approval"; toolName: string; toolArgs: Record<string, unknown>; summary: string };

/**
 * OperatorService - the operator agent graph (START → agent ⇄ tools → finalise → END).
 *
 * - `agent` node: exactly one model invocation with all tools bound (LLMService.callStep).
 * - `tools` node: executes the tool calls of the last AI message. Destructive
 *   calls are processed FIRST and freeze the run via `interrupt()` until the
 *   user approves or denies — at most ONE destructive call per pass (extra
 *   destructive calls get a "not executed" ToolMessage and must be re-issued);
 *   read-only tool errors become `Tool error: ...` ToolMessages so the model
 *   self-corrects (never thrown).
 * - `finalise` node: one structured LLMService.call() producing the final
 *   answer + suggested questions. References and citations are collected
 *   deterministically from the tool-call recorder, never from the LLM.
 *
 * The graph is compiled per turn (tools are per-request closures) with the
 * shared checkpoint saver; `resume()` recompiles identically and resumes the
 * frozen thread with `new Command({ resume: { approved } })`.
 */
@Injectable()
export class OperatorService {
  private readonly logger = new Logger(OperatorService.name);
  private readonly systemPrompt: string;

  constructor(
    private readonly llm: LLMService,
    private readonly toolRegistry: OperatorToolRegistry,
    private readonly checkpointer: OperatorCheckpointerService,
    private readonly configService: ConfigService<BaseConfigInterface>,
  ) {
    const prompts = this.configService.get<ConfigPromptsInterface>("prompts");
    this.systemPrompt = prompts?.operator ?? defaultOperatorSystemPrompt;
  }

  async run(params: {
    companyId: string;
    userId: string;
    userModuleIds: string[];
    contentId?: string;
    contentType?: string;
    messages: MessageInterface[];
    question: string;
    threadId: string;
  }): Promise<OperatorRunResult> {
    const app = await this.compileGraph({
      companyId: params.companyId,
      userId: params.userId,
      userModuleIds: params.userModuleIds,
      contentId: params.contentId,
      contentType: params.contentType,
      dataLimits: {},
      messages: params.messages,
    });

    const initialState: Partial<OperatorContextState> = {
      messages: this.buildInitialMessages(params.messages, params.question),
      companyId: params.companyId,
      userId: params.userId,
      userModuleIds: params.userModuleIds,
      contentId: params.contentId ?? null,
      contentType: params.contentType ?? null,
      question: params.question,
    };

    const finalState = (await app.invoke(initialState, {
      configurable: { thread_id: params.threadId },
      recursionLimit: RECURSION_LIMIT,
    })) as OperatorContextState;

    return this.mapResult(finalState);
  }

  async resume(params: {
    threadId: string;
    approved: boolean;
    companyId: string;
    userId: string;
    userModuleIds: string[];
    contentId?: string;
    contentType?: string;
    messages?: MessageInterface[];
  }): Promise<OperatorRunResult> {
    const app = await this.compileGraph({
      companyId: params.companyId,
      userId: params.userId,
      userModuleIds: params.userModuleIds,
      contentId: params.contentId,
      contentType: params.contentType,
      dataLimits: {},
      messages: params.messages ?? [],
    });

    const finalState = (await app.invoke(new Command({ resume: { approved: params.approved } }), {
      configurable: { thread_id: params.threadId },
      recursionLimit: RECURSION_LIMIT,
    })) as OperatorContextState;

    return this.mapResult(finalState);
  }

  private async compileGraph(ctx: OperatorRetrievalContext) {
    const saver: BaseCheckpointSaver = await this.checkpointer.getSaver();

    // Per-compile recorder: tool wrappers (registry-built closures) push
    // ToolCallRecords here. It accumulates for the lifetime of the compiled
    // graph — tools enforce cross-call contracts (e.g. describe-before-read)
    // by inspecting it, so the tools node must NEVER drain it; it only copies
    // the records new to each pass into checkpointed state. The array identity
    // is shared with the tool closures: push into it, never reassign it.
    const recorder: ToolCallRecord[] = [];
    const definitions = this.toolRegistry.build(ctx, recorder);
    const toolMap = new Map<string, OperatorToolDefinition>(definitions.map((d) => [d.tool.name, d]));
    const tools = definitions.map((d) => d.tool);

    const workflow = new StateGraph(OperatorContext)
      .addNode("agent", async (state) => {
        const response = await this.llm.callStep({
          systemPrompts: [this.systemPrompt],
          messages: state.messages,
          tools,
          // Deterministic tool-following: at the config-default temperature the
          // model intermittently relays recoverable tool errors to the user
          // instead of retrying (observed live with gemini-2.5-flash-lite).
          temperature: 0,
          metadata: { agent: "operator", node: "agent", companyId: state.companyId },
        });
        return {
          messages: [response.message],
          iterations: state.iterations + 1,
          tokens: response.tokenUsage,
        };
      })
      .addNode("tools", async (state) => {
        // Read the calls from the last AI message in checkpointed state so the
        // node is deterministic on replay after an interrupt.
        const last = state.messages[state.messages.length - 1] as AIMessage;
        const calls = last?.tool_calls ?? [];
        const isDestructive = (name: string) => toolMap.get(name)?.destructive === true;

        // Prime the recorder from checkpointed state. `resume()` recompiles the
        // graph with a fresh (empty) recorder, but state.toolCalls is the
        // durable superset of everything recorded so far — restoring the
        // missing records keeps cross-pass tool contracts (describe-before-read)
        // satisfied after an approval round-trip. Idempotent on node replays.
        if (recorder.length < state.toolCalls.length) {
          recorder.push(...state.toolCalls.slice(recorder.length));
        }
        // Everything pushed beyond this index during this pass is new and is
        // what gets emitted into state (the toolCalls reducer concats).
        const startIdx = recorder.length;

        // Ordering rule: destructive calls are processed BEFORE read-only
        // siblings, so no sibling effects are duplicated by node replay.
        // Exactly-once rule: at most ONE destructive call is interrupted and
        // executed per tools-node pass. LangGraph replays the whole node on
        // every resume — a second `interrupt()` after a side effect would
        // re-run that side effect on the next resume. Every destructive call
        // after the first gets a "not executed" ToolMessage so the model can
        // re-issue it on the next agent iteration.
        const ordered = [...calls.filter((c) => isDestructive(c.name)), ...calls.filter((c) => !isDestructive(c.name))];

        const toolMessages: ToolMessage[] = [];
        let destructiveHandled = false;
        for (const [index, call] of ordered.entries()) {
          const callId = call.id ?? `call_${index}`;
          const definition = toolMap.get(call.name);
          if (!definition) {
            toolMessages.push(
              new ToolMessage({ content: `Tool error: unknown tool "${call.name}".`, tool_call_id: callId }),
            );
            continue;
          }

          if (definition.destructive) {
            if (destructiveHandled) {
              toolMessages.push(
                new ToolMessage({
                  content: "Not executed — one action per step. Re-issue this action after the current one resolves.",
                  tool_call_id: callId,
                }),
              );
              continue;
            }
            destructiveHandled = true;
            const payload: OperatorInterruptPayload = {
              toolName: call.name,
              toolArgs: (call.args ?? {}) as Record<string, unknown>,
              summary: definition.summarise?.(call.args ?? {}) ?? `${call.name}(${JSON.stringify(call.args ?? {})})`,
            };
            const decision = interrupt(payload) as { approved: boolean };
            if (!decision?.approved) {
              toolMessages.push(new ToolMessage({ content: "Action denied by the user.", tool_call_id: callId }));
              continue;
            }
          }

          try {
            const result = await definition.tool.invoke(call.args ?? {});
            toolMessages.push(
              new ToolMessage({
                content: typeof result === "string" ? result : JSON.stringify(result),
                tool_call_id: callId,
              }),
            );
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.logger.warn(`operator tool "${call.name}" failed: ${message}`);
            toolMessages.push(new ToolMessage({ content: `Tool error: ${message}`, tool_call_id: callId }));
          }
        }

        // Only the records new to this pass go into state; re-deriving over
        // primed records would duplicate toolCalls/references/citations
        // because the state reducers concat.
        const newRecords = recorder.slice(startIdx) as OperatorToolCallRecord[];
        return {
          messages: toolMessages,
          toolCalls: newRecords,
          references: this.collectReferences(newRecords),
          citations: this.collectCitations(newRecords),
        };
      })
      .addNode("finalise", async (state) => {
        const transcript = state.messages
          .map((m) => {
            const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
            // AIMessages that only carry tool_calls stringify empty; surface the
            // requested calls so cap-terminated runs expose the unfinished intent.
            const toolCalls = (m as AIMessage).tool_calls;
            const requested =
              Array.isArray(toolCalls) && toolCalls.length > 0
                ? `${content ? " " : ""}[requested tools: ${toolCalls
                    .map((c) => `${c.name}(${JSON.stringify(c.args ?? {})})`)
                    .join(", ")}]`
                : "";
            return `${m.getType()}: ${content}${requested}`;
          })
          .join("\n");

        const result = await this.llm.call({
          inputParams: { question: state.question, conversation: transcript },
          outputSchema: finalAnswerSchema,
          systemPrompts: [this.systemPrompt],
          // LLMService.call() renders inputParams ONLY through {placeholder}
          // substitution in this template — params without a matching
          // placeholder are silently dropped and the model never sees them.
          instructions:
            "The user asked:\n{question}\n\n" +
            "This is the full conversation of the operator run that just finished (model turns, tool calls and tool results):\n\n{conversation}\n\n" +
            "Produce the final reply: `answer` is the message for the user (built only from facts in the conversation above), `questions` is up to three short follow-up questions the user might ask next. " +
            "If the conversation contains no tool results that answer the question, `answer` must say plainly that the information could not be found — do not guess and do not invent records. " +
            "Never state that an action was performed (created, updated, deleted, executed) unless a tool result in the conversation confirms that exact action.",
          metadata: { agent: "operator", node: "finalise", companyId: state.companyId },
        });

        return {
          finalAnswer: { answer: result.answer ?? "", questions: result.questions ?? [] },
          tokens: result.tokenUsage,
        };
      })
      .addEdge(START, "agent")
      .addConditionalEdges(
        "agent",
        (state) => {
          const last = state.messages[state.messages.length - 1] as AIMessage;
          const hasToolCalls = Array.isArray(last?.tool_calls) && last.tool_calls.length > 0;
          return hasToolCalls && state.iterations < MAX_TOOL_ITERATIONS ? "tools" : "finalise";
        },
        ["tools", "finalise"],
      )
      .addEdge("tools", "agent")
      .addEdge("finalise", END);

    return workflow.compile({ checkpointer: saver });
  }

  /** Entity references derived deterministically from the tool-call recorder (never from the LLM). */
  private collectReferences(records: OperatorToolCallRecord[]): EntityReference[] {
    const references: EntityReference[] = [];
    const seen = new Set<string>();
    const push = (type: unknown, id: unknown, reason: string) => {
      if (typeof type !== "string" || typeof id !== "string" || !type || !id) return;
      const key = `${type}:${id}`;
      if (seen.has(key)) return;
      seen.add(key);
      references.push({ type, id, relevance: 100, reason });
    };

    for (const record of records) {
      if (record.error) continue;
      if (record.tool === "read_entity") {
        push(record.input.type, record.input.id, "record read during the operator run");
      } else if (record.tool === "traverse") {
        push(record.input.fromType, record.input.fromId, "record traversed during the operator run");
      }
    }
    return references;
  }

  /** Chunk citations recorded by retrieval tool wrappers into the recorder. */
  private collectCitations(records: OperatorToolCallRecord[]): OperatorCitation[] {
    const citations: OperatorCitation[] = [];
    for (const record of records) {
      for (const citation of record.citations ?? []) {
        citations.push({
          chunkId: citation.chunkId,
          relevance: citation.relevance,
          reason: `retrieved by ${record.tool}`,
        });
      }
    }
    return citations;
  }

  private buildInitialMessages(messages: MessageInterface[], question: string): BaseMessage[] {
    const converted: BaseMessage[] = messages.map((m) => {
      switch (m.type) {
        case AgentMessageType.System:
          return new SystemMessage(m.content);
        case AgentMessageType.Assistant:
          return new AIMessage(m.content);
        default:
          return new HumanMessage(m.content);
      }
    });

    const last = converted[converted.length - 1];
    if (!last || last.getType() !== "human" || last.content !== question) {
      converted.push(new HumanMessage(question));
    }
    return converted;
  }

  private mapResult(finalState: OperatorContextState): OperatorRunResult {
    const interrupts = (finalState as unknown as Record<string, unknown>).__interrupt__ as
      | Array<{ value?: Partial<OperatorInterruptPayload> }>
      | undefined;

    if (interrupts && interrupts.length > 0) {
      const payload = interrupts[0]?.value ?? {};
      return {
        kind: "pending_approval",
        toolName: payload.toolName ?? "",
        toolArgs: payload.toolArgs ?? {},
        summary: payload.summary ?? "",
      };
    }

    return {
      kind: "completed",
      answer: finalState.finalAnswer?.answer ?? "",
      questions: finalState.finalAnswer?.questions ?? [],
      references: finalState.references ?? [],
      citations: finalState.citations ?? [],
      toolCalls: finalState.toolCalls ?? [],
      tokens: finalState.tokens ?? { input: 0, output: 0 },
    };
  }
}
