import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { MemorySaver } from "@langchain/langgraph";
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { OperatorService } from "../operator.service";
import { OperatorToolRegistry } from "../../tools/operator.tool.registry";
import { OperatorCheckpointerService } from "../operator.checkpointer.service";
import { LLMService } from "../../../../core/llm/services/llm.service";
import { ModelWeight } from "../../../../core/llm/enums/model.weight";
import { AgentMessageType } from "../../../../common/enums/agentmessage.type";
import type { OperatorToolCallRecord, OperatorToolDefinition } from "../../interfaces/operator.tool.interface";
import type { ToolCallRecord } from "../../../graph/tools/tool.factory";

function aiMessageWithToolCall(name: string, args: Record<string, unknown>, id = "call_1"): AIMessage {
  return new AIMessage({
    content: "",
    tool_calls: [{ id, name, args, type: "tool_call" }],
  });
}

describe("OperatorService", () => {
  let service: OperatorService;
  let callStep: Mock;
  let llmCall: Mock;
  let registryBuild: Mock;
  let testToolExecutions: Array<Record<string, unknown>>;
  let readToolExecutions: number;
  let guardObservations: Array<"satisfied" | "blocked">;

  const baseParams = {
    companyId: "550e8400-e29b-41d4-a716-446655440000",
    userId: "660e8400-e29b-41d4-a716-446655440001",
    userModuleIds: ["mod-1"],
    messages: [{ type: AgentMessageType.User, content: "do the thing" }],
    question: "do the thing",
    threadId: "assistant-1:msg-1",
  };

  beforeEach(async () => {
    callStep = vi.fn();
    llmCall = vi.fn();
    testToolExecutions = [];
    readToolExecutions = 0;
    guardObservations = [];

    const destructiveTool = new DynamicStructuredTool({
      name: "operator_test_action",
      description: "Test-only destructive action.",
      schema: z.object({ note: z.string() }),
      func: async (input: { note: string }) => {
        testToolExecutions.push(input);
        return JSON.stringify({ executed: true, note: input.note });
      },
    });

    const throwingReadTool = new DynamicStructuredTool({
      name: "operator_failing_read",
      description: "Read-only tool that always throws.",
      schema: z.object({ query: z.string().optional() }),
      func: async () => {
        readToolExecutions += 1;
        throw new Error("boom");
      },
    });

    const definitions: OperatorToolDefinition[] = [
      {
        tool: destructiveTool,
        destructive: true,
        summarise: (args: Record<string, unknown>) => `Test action: ${String(args.note)}`,
      },
      { tool: throwingReadTool, destructive: false },
    ];

    // Like the real registry: tools are closures over the per-compile recorder.
    registryBuild = vi.fn((_ctx: unknown, recorder: ToolCallRecord[]) => {
      const recordingTool = new DynamicStructuredTool({
        name: "recorder_dependency",
        description: "Read-only tool that records its call into the recorder.",
        schema: z.object({ note: z.string().optional() }),
        func: async (input: { note?: string }) => {
          const record: OperatorToolCallRecord = {
            tool: "recorder_dependency",
            input: input as Record<string, unknown>,
            durationMs: 1,
            citations: [{ chunkId: "chunk-1", relevance: 90 }],
          };
          recorder.push(record);
          recorder.push({ tool: "read_entity", input: { type: "documents", id: "doc-1" }, durationMs: 1 });
          return JSON.stringify({ recorded: true });
        },
      });

      // Mirrors the describe-before-read guard in read-entity.tool.ts: succeeds
      // only if the recorder still contains the recorder_dependency record.
      const guardedReadTool = new DynamicStructuredTool({
        name: "guarded_read",
        description: "Read-only tool gated on a prior recorder_dependency record.",
        schema: z.object({}),
        func: async () => {
          const satisfied = recorder.some((c) => c.tool === "recorder_dependency");
          guardObservations.push(satisfied ? "satisfied" : "blocked");
          if (!satisfied) return "You must call recorder_dependency first.";
          recorder.push({ tool: "guarded_read", input: {}, durationMs: 1 });
          return JSON.stringify({ ok: true });
        },
      });

      return [
        ...definitions,
        { tool: recordingTool, destructive: false },
        { tool: guardedReadTool, destructive: false },
      ];
    });
    const registry = { build: registryBuild };
    const saver = new MemorySaver();
    const checkpointer = { getSaver: vi.fn(async () => saver) };
    const llm = { callStep, call: llmCall };
    const configService = { get: vi.fn(() => ({})) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OperatorService,
        { provide: LLMService, useValue: llm },
        { provide: OperatorToolRegistry, useValue: registry },
        { provide: OperatorCheckpointerService, useValue: checkpointer },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = moduleRef.get(OperatorService);
  });

  it("completes when the model answers without tool calls", async () => {
    callStep.mockResolvedValueOnce({ message: new AIMessage("done"), tokenUsage: { input: 10, output: 5 } });
    llmCall.mockResolvedValueOnce({
      answer: "done",
      questions: [],
      tokenUsage: { input: 5, output: 5 },
      modelWeight: ModelWeight.Normal,
    });

    const result = await service.run(baseParams);

    expect(result.kind).toBe("completed");
    if (result.kind === "completed") {
      expect(result.answer).toBe("done");
      expect(result.questions).toEqual([]);
      expect(result.tokens).toEqual({ input: 15, output: 10 });
    }
    expect(callStep).toHaveBeenCalledTimes(1);
    expect(llmCall).toHaveBeenCalledTimes(1);

    // LLMService.call() renders inputParams ONLY via {placeholder} substitution
    // in the instructions template; without these placeholders the model never
    // sees the question/conversation and fabricates an answer (seen live in dev).
    const finaliseArgs = llmCall.mock.calls[0][0];
    expect(finaliseArgs.instructions).toContain("{question}");
    expect(finaliseArgs.instructions).toContain("{conversation}");
    expect(finaliseArgs.inputParams).toHaveProperty("question");
    expect(finaliseArgs.inputParams).toHaveProperty("conversation");
  });

  it("freezes on a destructive tool and resumes approved, executing it exactly once", async () => {
    callStep.mockResolvedValueOnce({
      message: aiMessageWithToolCall("operator_test_action", { note: "x" }),
      tokenUsage: { input: 1, output: 1 },
    });

    const first = await service.run(baseParams);

    expect(first).toMatchObject({ kind: "pending_approval", toolName: "operator_test_action" });
    if (first.kind === "pending_approval") {
      expect(first.toolArgs).toEqual({ note: "x" });
      expect(first.summary).toBe("Test action: x");
    }
    expect(testToolExecutions).toHaveLength(0);

    callStep.mockResolvedValueOnce({ message: new AIMessage("finished"), tokenUsage: { input: 1, output: 1 } });
    llmCall.mockResolvedValueOnce({
      answer: "finished",
      questions: [],
      tokenUsage: { input: 1, output: 1 },
      modelWeight: ModelWeight.Normal,
    });

    const second = await service.resume({
      threadId: baseParams.threadId,
      approved: true,
      companyId: baseParams.companyId,
      userId: baseParams.userId,
      userModuleIds: baseParams.userModuleIds,
    });

    expect(second.kind).toBe("completed");
    expect(testToolExecutions).toHaveLength(1);
    expect(testToolExecutions[0]).toEqual({ note: "x" });
  });

  it("resume denied: tool not executed, model wraps up", async () => {
    callStep.mockResolvedValueOnce({
      message: aiMessageWithToolCall("operator_test_action", { note: "x" }),
      tokenUsage: { input: 1, output: 1 },
    });

    const first = await service.run(baseParams);
    expect(first).toMatchObject({ kind: "pending_approval", toolName: "operator_test_action" });

    callStep.mockResolvedValueOnce({ message: new AIMessage("understood"), tokenUsage: { input: 1, output: 1 } });
    llmCall.mockResolvedValueOnce({
      answer: "The action was not performed.",
      questions: [],
      tokenUsage: { input: 1, output: 1 },
      modelWeight: ModelWeight.Normal,
    });

    const second = await service.resume({
      threadId: baseParams.threadId,
      approved: false,
      companyId: baseParams.companyId,
      userId: baseParams.userId,
      userModuleIds: baseParams.userModuleIds,
    });

    expect(second.kind).toBe("completed");
    expect(testToolExecutions).toHaveLength(0);

    // The denial is surfaced to the model as a ToolMessage.
    const secondStepMessages = callStep.mock.calls[1][0].messages;
    const denialMessage = secondStepMessages.find(
      (m: unknown) => m instanceof ToolMessage && String(m.content).includes("Action denied by the user."),
    );
    expect(denialMessage).toBeDefined();
  });

  it("executes each destructive call exactly once when one AIMessage requests two", async () => {
    // Step 1: the model issues TWO destructive calls in a single message.
    callStep.mockResolvedValueOnce({
      message: new AIMessage({
        content: "",
        tool_calls: [
          { id: "call_a", name: "operator_test_action", args: { note: "first" }, type: "tool_call" },
          { id: "call_b", name: "operator_test_action", args: { note: "second" }, type: "tool_call" },
        ],
      }),
      tokenUsage: { input: 1, output: 1 },
    });

    const first = await service.run(baseParams);

    expect(first).toMatchObject({ kind: "pending_approval", summary: "Test action: first" });
    expect(testToolExecutions).toHaveLength(0);

    // Step 2: approve the first action. On replay the first call executes
    // exactly once; the second is deferred (NOT executed, NOT interrupted)
    // and the model re-issues it on the next agent iteration.
    callStep.mockResolvedValueOnce({
      message: aiMessageWithToolCall("operator_test_action", { note: "second" }, "call_c"),
      tokenUsage: { input: 1, output: 1 },
    });

    const second = await service.resume({
      threadId: baseParams.threadId,
      approved: true,
      companyId: baseParams.companyId,
      userId: baseParams.userId,
      userModuleIds: baseParams.userModuleIds,
      contentId: "content-1",
      contentType: "documents",
      messages: baseParams.messages,
    });

    expect(second).toMatchObject({ kind: "pending_approval", summary: "Test action: second" });
    expect(testToolExecutions).toEqual([{ note: "first" }]);

    // The deferred call got the "not executed" ToolMessage with its own id,
    // and the model received it on the next callStep.
    const secondStepMessages = callStep.mock.calls[1][0].messages;
    const deferred = secondStepMessages.find(
      (m: unknown) => m instanceof ToolMessage && String(m.content).includes("Not executed"),
    ) as ToolMessage | undefined;
    expect(deferred).toBeDefined();
    expect(deferred?.tool_call_id).toBe("call_b");
    expect(String(deferred?.content)).toContain("Re-issue this action");

    // resume() rebuilt the tools with full context (content scope + history).
    const resumeCtx = registryBuild.mock.calls[1][0];
    expect(resumeCtx).toMatchObject({ contentId: "content-1", contentType: "documents" });
    expect(resumeCtx.messages).toEqual(baseParams.messages);

    // Step 3: approve the re-issued second action; the run completes.
    callStep.mockResolvedValueOnce({ message: new AIMessage("all done"), tokenUsage: { input: 1, output: 1 } });
    llmCall.mockResolvedValueOnce({
      answer: "all done",
      questions: [],
      tokenUsage: { input: 1, output: 1 },
      modelWeight: ModelWeight.Normal,
    });

    const third = await service.resume({
      threadId: baseParams.threadId,
      approved: true,
      companyId: baseParams.companyId,
      userId: baseParams.userId,
      userModuleIds: baseParams.userModuleIds,
    });

    expect(third.kind).toBe("completed");
    // Across the full run/resume sequence: each destructive call ran exactly once.
    expect(testToolExecutions).toEqual([{ note: "first" }, { note: "second" }]);

    // The finalise transcript surfaces tool_calls carried by AIMessages.
    const conversation = llmCall.mock.calls[0][0].inputParams.conversation;
    expect(conversation).toContain('[requested tools: operator_test_action({"note":"first"})');
  });

  it("tool errors become ToolMessages, not thrown", async () => {
    callStep.mockResolvedValueOnce({
      message: aiMessageWithToolCall("operator_failing_read", { query: "q" }),
      tokenUsage: { input: 1, output: 1 },
    });
    callStep.mockResolvedValueOnce({ message: new AIMessage("recovered"), tokenUsage: { input: 1, output: 1 } });
    llmCall.mockResolvedValueOnce({
      answer: "recovered",
      questions: [],
      tokenUsage: { input: 1, output: 1 },
      modelWeight: ModelWeight.Normal,
    });

    const result = await service.run(baseParams);

    expect(result.kind).toBe("completed");
    expect(readToolExecutions).toBe(1);
    expect(callStep).toHaveBeenCalledTimes(2);

    const secondStepMessages = callStep.mock.calls[1][0].messages;
    const errorMessage = secondStepMessages.find(
      (m: unknown) => m instanceof ToolMessage && String(m.content).includes("Tool error:"),
    );
    expect(errorMessage).toBeDefined();
    expect(String(errorMessage.content)).toContain("boom");
  });

  it("recorder persists across tool passes within one run (describe-before-read contract)", async () => {
    // Pass 1: the recording tool pushes its record into the recorder.
    callStep.mockResolvedValueOnce({
      message: aiMessageWithToolCall("recorder_dependency", { note: "first" }, "call_1"),
      tokenUsage: { input: 1, output: 1 },
    });
    // Pass 2 (NEXT iteration): the guard tool must still see that record.
    callStep.mockResolvedValueOnce({
      message: aiMessageWithToolCall("guarded_read", {}, "call_2"),
      tokenUsage: { input: 1, output: 1 },
    });
    callStep.mockResolvedValueOnce({ message: new AIMessage("done"), tokenUsage: { input: 1, output: 1 } });
    llmCall.mockResolvedValueOnce({
      answer: "done",
      questions: [],
      tokenUsage: { input: 1, output: 1 },
      modelWeight: ModelWeight.Normal,
    });

    const result = await service.run(baseParams);

    expect(result.kind).toBe("completed");
    // The guard's own observation: the pass-1 record was still in the recorder
    // at pass-2 time. Under drain semantics this would have been ["blocked"].
    expect(guardObservations).toEqual(["satisfied"]);

    const thirdStepMessages = callStep.mock.calls[2][0].messages;
    const guardResult = thirdStepMessages.find(
      (m: unknown) => m instanceof ToolMessage && m.tool_call_id === "call_2",
    ) as ToolMessage;
    expect(String(guardResult.content)).not.toContain("You must call recorder_dependency first.");
    expect(String(guardResult.content)).toContain('"ok":true');
  });

  it("resume primes the recorder from checkpointed toolCalls", async () => {
    // Pass 1: recorded read-only call.
    callStep.mockResolvedValueOnce({
      message: aiMessageWithToolCall("recorder_dependency", { note: "first" }, "call_1"),
      tokenUsage: { input: 1, output: 1 },
    });
    // Pass 2: destructive call freezes the run.
    callStep.mockResolvedValueOnce({
      message: aiMessageWithToolCall("operator_test_action", { note: "x" }, "call_2"),
      tokenUsage: { input: 1, output: 1 },
    });

    const first = await service.run(baseParams);
    expect(first).toMatchObject({ kind: "pending_approval", toolName: "operator_test_action" });
    expect(guardObservations).toEqual([]);

    // Post-resume pass: resume() recompiles with a FRESH (empty) recorder; the
    // guard succeeds only if the node primed it from checkpointed state.toolCalls.
    callStep.mockResolvedValueOnce({
      message: aiMessageWithToolCall("guarded_read", {}, "call_3"),
      tokenUsage: { input: 1, output: 1 },
    });
    callStep.mockResolvedValueOnce({ message: new AIMessage("done"), tokenUsage: { input: 1, output: 1 } });
    llmCall.mockResolvedValueOnce({
      answer: "done",
      questions: [],
      tokenUsage: { input: 1, output: 1 },
      modelWeight: ModelWeight.Normal,
    });

    const second = await service.resume({
      threadId: baseParams.threadId,
      approved: true,
      companyId: baseParams.companyId,
      userId: baseParams.userId,
      userModuleIds: baseParams.userModuleIds,
    });

    expect(second.kind).toBe("completed");
    expect(testToolExecutions).toEqual([{ note: "x" }]);
    expect(guardObservations).toEqual(["satisfied"]);
  });

  it("priming does not duplicate toolCalls, references or citations across run/resume", async () => {
    callStep.mockResolvedValueOnce({
      message: aiMessageWithToolCall("recorder_dependency", { note: "first" }, "call_1"),
      tokenUsage: { input: 1, output: 1 },
    });
    callStep.mockResolvedValueOnce({
      message: aiMessageWithToolCall("operator_test_action", { note: "x" }, "call_2"),
      tokenUsage: { input: 1, output: 1 },
    });

    const first = await service.run(baseParams);
    expect(first).toMatchObject({ kind: "pending_approval" });

    callStep.mockResolvedValueOnce({
      message: aiMessageWithToolCall("guarded_read", {}, "call_3"),
      tokenUsage: { input: 1, output: 1 },
    });
    callStep.mockResolvedValueOnce({ message: new AIMessage("done"), tokenUsage: { input: 1, output: 1 } });
    llmCall.mockResolvedValueOnce({
      answer: "done",
      questions: [],
      tokenUsage: { input: 1, output: 1 },
      modelWeight: ModelWeight.Normal,
    });

    const second = await service.resume({
      threadId: baseParams.threadId,
      approved: true,
      companyId: baseParams.companyId,
      userId: baseParams.userId,
      userModuleIds: baseParams.userModuleIds,
    });

    expect(second.kind).toBe("completed");
    if (second.kind !== "completed") return;

    // Each record emitted into checkpointed state exactly once, even though the
    // post-resume pass primed the recorder with the pre-interrupt records.
    expect(second.toolCalls.filter((c) => c.tool === "recorder_dependency")).toHaveLength(1);
    expect(second.toolCalls.filter((c) => c.tool === "read_entity")).toHaveLength(1);
    expect(second.toolCalls.filter((c) => c.tool === "guarded_read")).toHaveLength(1);
    expect(second.toolCalls).toHaveLength(3);

    // References/citations derived from new records only — no re-derivation
    // over primed records (state reducers concat, so duplicates would stick).
    expect(second.references).toHaveLength(1);
    expect(second.references[0]).toMatchObject({ type: "documents", id: "doc-1" });
    expect(second.citations).toHaveLength(1);
    expect(second.citations[0]).toMatchObject({ chunkId: "chunk-1", relevance: 90 });
  });
});
