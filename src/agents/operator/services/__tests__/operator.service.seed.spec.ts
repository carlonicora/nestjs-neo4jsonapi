import { AIMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";
import { AgentMessageType } from "../../../../common/enums/agentmessage.type";
import { OperatorService, renderSeedContexts } from "../operator.service";

describe("OperatorService seed contexts", () => {
  const buildService = () => {
    const callStep = vi.fn(async () => ({
      message: new AIMessage({ content: "done" }),
      tokenUsage: { input: 1, output: 1 },
    }));
    const llmCall = vi.fn(async () => ({ answer: "ok", questions: [], tokenUsage: { input: 1, output: 1 } }));
    const llm = { callStep, call: llmCall } as any;
    const toolRegistry = { build: vi.fn(() => []) } as any;
    const checkpointer = { getSaver: vi.fn(async () => new MemorySaver()) } as any;
    const configService = { get: vi.fn(() => undefined) } as any;
    return { service: new OperatorService(llm, toolRegistry, checkpointer, configService), callStep };
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
});
