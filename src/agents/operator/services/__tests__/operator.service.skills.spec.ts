import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { MemorySaver } from "@langchain/langgraph";
import { AIMessage, BaseMessage } from "@langchain/core/messages";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { OperatorService } from "../operator.service";
import { OperatorToolRegistry } from "../../tools/operator.tool.registry";
import { OperatorCheckpointerService } from "../operator.checkpointer.service";
import { LLMService } from "../../../../core/llm/services/llm.service";
import { ModelWeight } from "../../../../core/llm/enums/model.weight";
import { AgentMessageType } from "../../../../common/enums/agentmessage.type";
import {
  ASSISTANT_SKILL_PROVIDER,
  type AssistantLoadedSkill,
  type AssistantSkillProvider,
  type AssistantSkillSummary,
} from "../../../../common/interfaces/assistant.skill.interface";
import {
  OPERATOR_CAPABILITY_SELECTOR,
  type OperatorCapabilitySelector,
  type OperatorToolDefinition,
} from "../../interfaces/operator.tool.interface";
import { ToolFactory } from "../../../graph/tools/tool.factory";
import { LoadSkillTool } from "../../tools/load-skill.tool";
import { OPERATOR_SKILLS_LIST_FRAMING, OPERATOR_SKILLS_LOADED_FRAMING } from "../../prompts/operator.skills.prompt";

function aiToolCalls(calls: Array<{ name: string; args: Record<string, unknown>; id?: string }>): AIMessage {
  return new AIMessage({
    content: "",
    tool_calls: calls.map((c, i) => ({ id: c.id ?? `call_${i}`, name: c.name, args: c.args, type: "tool_call" })),
  });
}

const EMAIL: AssistantSkillSummary = { name: "email", description: "How we write emails" };
const HUMANIZER: AssistantSkillSummary = { name: "humanizer", description: "Plain words" };

const INSTRUCTIONS: Record<string, string> = {
  email: "Sign off with the team name.",
  humanizer: "Use short sentences.",
};

describe("OperatorService skills", () => {
  let callStep: Mock;
  let llmCall: Mock;
  let provider: { listActive: Mock; load: Mock };
  let selector: { select: Mock };
  let definitions: OperatorToolDefinition[];

  const baseParams = {
    companyId: "550e8400-e29b-41d4-a716-446655440000",
    userId: "660e8400-e29b-41d4-a716-446655440001",
    userModuleIds: ["mod-1"],
    messages: [{ type: AgentMessageType.User, content: "do the thing" }],
    question: "do the thing",
    threadId: "assistant-1:msg-1",
  };

  const readTool = (name: string) =>
    new DynamicStructuredTool({
      name,
      description: `Read tool ${name}.`,
      schema: z.object({}),
      func: async () => JSON.stringify({ ok: name }),
    });

  const finalAnswer = () =>
    llmCall.mockResolvedValueOnce({
      answer: "done",
      questions: [],
      tokenUsage: { input: 1, output: 1 },
      modelWeight: ModelWeight.Normal,
    });

  const answerDirectly = () => {
    callStep.mockResolvedValueOnce({ message: new AIMessage("done"), tokenUsage: { input: 1, output: 1 } });
    finalAnswer();
  };

  const build = async (opts: { withProvider?: boolean; withSelector?: boolean } = {}): Promise<OperatorService> => {
    const saver = new MemorySaver();
    const providers: any[] = [
      OperatorService,
      { provide: LLMService, useValue: { callStep, call: llmCall } },
      { provide: OperatorToolRegistry, useValue: { build: vi.fn(() => definitions) } },
      { provide: OperatorCheckpointerService, useValue: { getSaver: vi.fn(async () => saver) } },
      { provide: ConfigService, useValue: { get: vi.fn(() => ({})) } },
      { provide: LoadSkillTool, useValue: new LoadSkillTool(new ToolFactory({} as any, {} as any)) },
    ];
    if (opts.withProvider) providers.push({ provide: ASSISTANT_SKILL_PROVIDER, useValue: provider });
    if (opts.withSelector) providers.push({ provide: OPERATOR_CAPABILITY_SELECTOR, useValue: selector });
    const moduleRef = await Test.createTestingModule({ providers }).compile();
    return moduleRef.get(OperatorService);
  };

  const toolNames = (callIndex = 0): string[] =>
    (callStep.mock.calls[callIndex][0].tools as Array<{ name: string }>).map((t) => t.name);

  beforeEach(() => {
    callStep = vi.fn();
    llmCall = vi.fn();
    provider = {
      listActive: vi.fn(async () => [EMAIL, HUMANIZER]),
      load: vi.fn(async ({ names }: { names: string[] }): Promise<AssistantLoadedSkill[]> =>
        names.filter((n) => INSTRUCTIONS[n]).map((name) => ({ name, instructions: INSTRUCTIONS[name] })),
      ),
    };
    selector = { select: vi.fn() };
    definitions = [
      {
        tool: new DynamicStructuredTool({
          name: "operator_test_action",
          description: "Test-only destructive action.",
          schema: z.object({ note: z.string() }),
          func: async () => JSON.stringify({ executed: true }),
        }),
        destructive: true,
        summarise: (args) => `Test action: ${String(args.note)}`,
      },
      { tool: readTool("read_a"), destructive: false },
      { tool: readTool("read_b"), destructive: false },
    ];
  });

  it("without a provider: same system prompts, no load_skill, no skills used", async () => {
    const service = await build();
    answerDirectly();

    const result = await service.run(baseParams);

    expect(callStep.mock.calls[0][0].systemPrompts).toHaveLength(1);
    expect(toolNames()).not.toContain("load_skill");
    expect(result.kind).toBe("completed");
    if (result.kind === "completed") expect(result.skillsUsed).toEqual([]);
  });

  it("lists the offered skills in one extra system prompt and offers load_skill", async () => {
    const service = await build({ withProvider: true });
    answerDirectly();

    await service.run({ ...baseParams, offeredSkills: [EMAIL, HUMANIZER] });

    const systemPrompts: string[] = callStep.mock.calls[0][0].systemPrompts;
    expect(systemPrompts).toHaveLength(2);
    expect(systemPrompts[1].startsWith(OPERATOR_SKILLS_LIST_FRAMING)).toBe(true);
    expect(systemPrompts[1]).toContain("- email:");
    expect(systemPrompts[1]).toContain("- humanizer:");
    expect(toolNames()).toContain("load_skill");
    expect(provider.load).not.toHaveBeenCalled();
  });

  it("loads a named skill up front, first when there is no hydration message", async () => {
    const service = await build({ withProvider: true });
    answerDirectly();

    const result = await service.run({ ...baseParams, offeredSkills: [EMAIL, HUMANIZER], namedSkillNames: ["email"] });

    expect(provider.load).toHaveBeenCalledTimes(1);
    expect(provider.load).toHaveBeenCalledWith({ names: ["email"] });
    expect(provider.load.mock.invocationCallOrder[0]).toBeLessThan(callStep.mock.invocationCallOrder[0]);
    const messages: BaseMessage[] = callStep.mock.calls[0][0].messages;
    expect(messages[0].getType()).toBe("system");
    expect(String(messages[0].content)).toContain("--- skill: email ---");
    expect(String(messages[0].content)).toContain(INSTRUCTIONS.email);
    if (result.kind === "completed") expect(result.skillsUsed).toEqual(["email"]);
  });

  it("places the loaded skills directly after the hydration system message", async () => {
    const service = await build({ withProvider: true });
    answerDirectly();

    await service.run({
      ...baseParams,
      messages: [
        { type: AgentMessageType.System, content: "hydration" },
        { type: AgentMessageType.User, content: "do the thing" },
      ],
      offeredSkills: [EMAIL],
      namedSkillNames: ["email"],
    });

    const messages: BaseMessage[] = callStep.mock.calls[0][0].messages;
    expect(messages[0].getType()).toBe("system");
    expect(messages[0].content).toBe("hydration");
    expect(messages[1].getType()).toBe("system");
    expect(String(messages[1].content)).toContain("--- skill: email ---");
    expect(messages[2].getType()).toBe("human");
  });

  it("adds a skill the model loads itself after the named one", async () => {
    const service = await build({ withProvider: true });
    callStep.mockResolvedValueOnce({
      message: aiToolCalls([{ name: "load_skill", args: { name: "humanizer" } }]),
      tokenUsage: { input: 1, output: 1 },
    });
    answerDirectly();

    const result = await service.run({ ...baseParams, offeredSkills: [EMAIL, HUMANIZER], namedSkillNames: ["email"] });

    if (result.kind !== "completed") throw new Error("expected completed");
    expect(result.skillsUsed).toEqual(["email", "humanizer"]);
  });

  it("records a skill loaded twice only once", async () => {
    const service = await build({ withProvider: true });
    callStep.mockResolvedValueOnce({
      message: aiToolCalls([
        { name: "load_skill", args: { name: "humanizer" }, id: "c1" },
        { name: "load_skill", args: { name: "humanizer" }, id: "c2" },
      ]),
      tokenUsage: { input: 1, output: 1 },
    });
    callStep.mockResolvedValueOnce({
      message: aiToolCalls([{ name: "load_skill", args: { name: "humanizer" }, id: "c3" }]),
      tokenUsage: { input: 1, output: 1 },
    });
    answerDirectly();

    const result = await service.run({ ...baseParams, offeredSkills: [EMAIL, HUMANIZER] });

    if (result.kind !== "completed") throw new Error("expected completed");
    expect(result.skillsUsed).toEqual(["humanizer"]);
  });

  it("does not record a refused load_skill call", async () => {
    const service = await build({ withProvider: true });
    callStep.mockResolvedValueOnce({
      message: aiToolCalls([{ name: "load_skill", args: { name: "nope" } }]),
      tokenUsage: { input: 1, output: 1 },
    });
    answerDirectly();

    const result = await service.run({ ...baseParams, offeredSkills: [EMAIL] });

    if (result.kind !== "completed") throw new Error("expected completed");
    expect(result.skillsUsed).toEqual([]);
    expect(llmCall.mock.calls[0][0].inputParams).not.toHaveProperty("skills");
  });

  it("hands the loaded skills to finalise with the framing", async () => {
    const service = await build({ withProvider: true });
    answerDirectly();

    await service.run({ ...baseParams, offeredSkills: [EMAIL], namedSkillNames: ["email"] });

    const args = llmCall.mock.calls[0][0];
    expect(args.inputParams.skills).toContain(INSTRUCTIONS.email);
    expect(args.inputParams.skills).toContain("--- skill: email ---");
    expect(args.instructions).toContain(OPERATOR_SKILLS_LOADED_FRAMING);
    expect(args.instructions).toContain("{skills}");
  });

  it("with nothing loaded, finalise has no skills key and no framing", async () => {
    const service = await build({ withProvider: true });
    answerDirectly();

    await service.run({ ...baseParams, offeredSkills: [EMAIL] });

    const args = llmCall.mock.calls[0][0];
    expect(args.inputParams).not.toHaveProperty("skills");
    expect(args.instructions).not.toContain(OPERATOR_SKILLS_LOADED_FRAMING);
    expect(args.instructions).not.toContain("{skills}");
  });

  it("keeps braces, backticks and dollar-brace in the instructions unchanged", async () => {
    const tricky = "Use {a} and } then a ` and $" + "{x} here.";
    provider.load.mockImplementation(async ({ names }: { names: string[] }) =>
      names.map((name) => ({ name, instructions: tricky })),
    );
    const service = await build({ withProvider: true });
    answerDirectly();

    await service.run({ ...baseParams, offeredSkills: [EMAIL], namedSkillNames: ["email"] });

    expect(llmCall.mock.calls[0][0].inputParams.skills).toContain(tricky);
  });

  it("with nothing loaded, the finalise call is exactly the one built without skills", async () => {
    const plain = await build();
    answerDirectly();
    await plain.run({ ...baseParams, threadId: "t-plain" });
    const before = llmCall.mock.calls[0][0];

    const withSkills = await build({ withProvider: true });
    answerDirectly();
    await withSkills.run({ ...baseParams, threadId: "t-skills", offeredSkills: [EMAIL, HUMANIZER] });
    const after = llmCall.mock.calls[1][0];

    expect(after).toEqual(before);
    expect(after).not.toHaveProperty("inputSchema");
    expect(Object.keys(after.inputParams).sort()).toEqual(Object.keys(before.inputParams).sort());
    expect(after.instructions).toBe(before.instructions);
    expect(after.metadata).toEqual(before.metadata);
  });

  it("follows the selector: listed skills, preloaded skills and selected tools", async () => {
    selector.select.mockImplementation(async ({ tools }: { tools: OperatorToolDefinition[] }) => ({
      skills: [EMAIL],
      preload: ["humanizer"],
      tools: tools.slice(0, 2),
    }));
    const service = await build({ withProvider: true, withSelector: true });
    answerDirectly();

    const result = await service.run({ ...baseParams, offeredSkills: [EMAIL, HUMANIZER] });

    expect(selector.select).toHaveBeenCalledWith(
      expect.objectContaining({ question: baseParams.question, skills: [EMAIL, HUMANIZER] }),
    );
    const systemPrompts: string[] = callStep.mock.calls[0][0].systemPrompts;
    expect(systemPrompts[1]).toContain("- email:");
    expect(systemPrompts[1]).not.toContain("- humanizer:");
    expect(provider.load).toHaveBeenCalledWith({ names: ["humanizer"] });
    expect(toolNames()).toEqual(["operator_test_action", "read_a", "load_skill"]);
    if (result.kind !== "completed") throw new Error("expected completed");
    expect(result.skillsUsed).toEqual(["humanizer"]);
  });

  it("with a selector returning no skills and nothing named: no list, no load_skill", async () => {
    selector.select.mockImplementation(async ({ tools }: { tools: OperatorToolDefinition[] }) => ({
      skills: [],
      preload: [],
      tools,
    }));
    const service = await build({ withProvider: true, withSelector: true });
    answerDirectly();

    await service.run({ ...baseParams, offeredSkills: [EMAIL, HUMANIZER] });

    expect(callStep.mock.calls[0][0].systemPrompts).toHaveLength(1);
    expect(toolNames()).not.toContain("load_skill");
  });

  it("keeps the skills loaded before an approval pause, without reading them again", async () => {
    const service = await build({ withProvider: true });
    callStep.mockResolvedValueOnce({
      message: aiToolCalls([{ name: "operator_test_action", args: { note: "x" } }]),
      tokenUsage: { input: 1, output: 1 },
    });

    const first = await service.run({ ...baseParams, offeredSkills: [EMAIL], namedSkillNames: ["email"] });
    expect(first.kind).toBe("pending_approval");
    expect(provider.load).toHaveBeenCalledTimes(1);

    // The skill was edited or deleted meanwhile: the provider now returns nothing.
    provider.load.mockReset();
    provider.load.mockResolvedValue([]);
    answerDirectly();

    const second = await service.resume({
      threadId: baseParams.threadId,
      approved: true,
      companyId: baseParams.companyId,
      userId: baseParams.userId,
      userModuleIds: baseParams.userModuleIds,
      offeredSkills: [],
    });

    expect(provider.load).not.toHaveBeenCalled();
    expect(llmCall.mock.calls[0][0].inputParams.skills).toContain(INSTRUCTIONS.email);
    if (second.kind !== "completed") throw new Error("expected completed");
    expect(second.skillsUsed).toEqual(["email"]);
  });

  it("hands the resume question to the selector", async () => {
    selector.select.mockImplementation(async ({ skills, tools }: any) => ({ skills, preload: [], tools }));
    const service = await build({ withProvider: true, withSelector: true });
    callStep.mockResolvedValueOnce({
      message: aiToolCalls([{ name: "operator_test_action", args: { note: "x" } }]),
      tokenUsage: { input: 1, output: 1 },
    });
    await service.run({ ...baseParams, offeredSkills: [EMAIL] });
    selector.select.mockClear();
    answerDirectly();

    await service.resume({
      threadId: baseParams.threadId,
      approved: true,
      companyId: baseParams.companyId,
      userId: baseParams.userId,
      userModuleIds: baseParams.userModuleIds,
      offeredSkills: [EMAIL],
      question: "the stored question",
    });

    expect(selector.select).toHaveBeenCalledTimes(1);
    expect(selector.select.mock.calls[0][0].question).toBe("the stored question");
  });
});
