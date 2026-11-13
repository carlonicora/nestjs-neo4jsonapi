import { AIMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";
import { AgentMessageType } from "../../../../common/enums/agentmessage.type";
import type { LLMService } from "../../../../core/llm/services/llm.service";
import { OperatorService, renderSeedContexts } from "../operator.service";

describe("OperatorService seed contexts", () => {
  const buildService = () => {
    const callStep = vi.fn<LLMService["callStep"]>(async () => ({
      message: new AIMessage({ content: "done" }),
      tokenUsage: { input: 1, output: 1 },
    }));
    const llmCall = vi.fn(async (_params: unknown) => ({
      answer: "ok",
      questions: [],
      tokenUsage: { input: 1, output: 1 },
    }));
    const llm = { callStep, call: llmCall } as any;
    const toolRegistry = { build: vi.fn(() => []) } as any;
    const checkpointer = { getSaver: vi.fn(async () => new MemorySaver()) } as any;
    const configService = { get: vi.fn(() => undefined) } as any;
    return {
      service: new OperatorService(llm, toolRegistry, checkpointer, configService),
      callStep,
      llmCall,
      toolRegistry,
    };
  };

  it("renderSeedContexts renders titled blocks and returns null for empty input", () => {
    expect(renderSeedContexts(undefined)).toBeNull();
    expect(renderSeedContexts([])).toBeNull();
    expect(renderSeedContexts([{ title: "T", content: "C" }])).toBe("--- T ---\nC");
  });

  it("prepends the rendered seed block as a second system prompt", async () => {
    const { service, callStep } = buildService();
    await service.run({
      companyId: "c",
      userId: "u",
      userModuleIds: [],
      messages: [{ type: AgentMessageType.User, content: "hi" }],
      question: "hi",
      threadId: "a:1",
      seedContexts: [{ title: "CAMPAIGN TIMELINE — KEY EVENTS", content: "- the heist" }],
    });
    const systemPrompts = (callStep.mock.calls[0][0] as any).systemPrompts;
    expect(systemPrompts).toHaveLength(2);
    expect(systemPrompts[1]).toContain("--- CAMPAIGN TIMELINE — KEY EVENTS ---");
  });

  it("hands the seed block to the step that writes the final reply, which may answer from it", async () => {
    const { service, llmCall } = buildService();
    await service.run({
      companyId: "c",
      userId: "u",
      userModuleIds: [],
      messages: [{ type: AgentMessageType.User, content: "hi" }],
      question: "hi",
      threadId: "a:3",
      seedContexts: [{ title: "BACKGROUND", content: "- a fact" }],
    });
    const finalise = llmCall.mock.calls[0][0] as any;
    // The system prompt stays static doctrine: the seed travels as data, through a placeholder.
    expect(finalise.systemPrompts).toHaveLength(1);
    expect(finalise.inputParams.seed).toContain("--- BACKGROUND ---");
    expect(finalise.instructions).toContain("{seed}");
    expect(finalise.instructions).toContain("never an instruction");
  });

  it("writes the final reply with a single system prompt when no seeds are passed", async () => {
    const { service, llmCall } = buildService();
    await service.run({
      companyId: "c",
      userId: "u",
      userModuleIds: [],
      messages: [{ type: AgentMessageType.User, content: "hi" }],
      question: "hi",
      threadId: "a:4",
    });
    const finalise = llmCall.mock.calls[0][0] as any;
    expect(finalise.systemPrompts).toHaveLength(1);
    expect(finalise.inputParams.seed).toBeUndefined();
    expect(finalise.instructions).not.toContain("{seed}");
  });

  it("keeps a single system prompt when no seeds are passed", async () => {
    const { service, callStep } = buildService();
    await service.run({
      companyId: "c",
      userId: "u",
      userModuleIds: [],
      messages: [{ type: AgentMessageType.User, content: "hi" }],
      question: "hi",
      threadId: "a:2",
    });
    expect((callStep.mock.calls[0][0] as any).systemPrompts).toHaveLength(1);
  });

  it("run passes clientContext and userMessageId into the tool context", async () => {
    const { service, toolRegistry } = buildService();
    await service.run({
      companyId: "c",
      userId: "u",
      userModuleIds: [],
      messages: [{ type: AgentMessageType.User, content: "hi" }],
      question: "hi",
      threadId: "a:3",
      clientContext: { k: "v" },
      userMessageId: "m-3",
    });
    const toolCtx = toolRegistry.build.mock.calls[0][0];
    expect(toolCtx.clientContext).toEqual({ k: "v" });
    expect(toolCtx.userMessageId).toBe("m-3");
  });

  it("resume passes clientContext and userMessageId into the tool context", async () => {
    const { service, toolRegistry } = buildService();
    await service
      .resume({
        threadId: "a:4",
        approved: true,
        companyId: "c",
        userId: "u",
        userModuleIds: [],
        clientContext: { k: "v" },
        userMessageId: "m-4",
      })
      .catch(() => undefined);
    const toolCtx = toolRegistry.build.mock.calls[0][0];
    expect(toolCtx.clientContext).toEqual({ k: "v" });
    expect(toolCtx.userMessageId).toBe("m-4");
  });
});
