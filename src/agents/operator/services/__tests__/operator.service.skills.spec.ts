import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { MemorySaver } from "@langchain/langgraph";
import { AIMessage, BaseMessage, ToolMessage } from "@langchain/core/messages";
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
  type AssistantSkillSummary,
} from "../../../../common/interfaces/assistant.skill.interface";
import { OPERATOR_CAPABILITY_SELECTOR, type OperatorToolDefinition } from "../../interfaces/operator.tool.interface";
import { ToolFactory } from "../../../graph/tools/tool.factory";
import { LoadSkillTool } from "../../tools/load-skill.tool";
import { OPERATOR_SKILLS_LIST_FRAMING, renderLoadedSkillResult } from "../../prompts/operator.skills.prompt";

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

const loadedResult = (name: string) => renderLoadedSkillResult({ name, instructions: INSTRUCTIONS[name] });

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

  const questions = () =>
    llmCall.mockResolvedValueOnce({
      questions: [],
      tokenUsage: { input: 1, output: 1 },
      modelWeight: ModelWeight.Normal,
    });

  const answerDirectly = (text = "done") => {
    callStep.mockResolvedValueOnce({ message: new AIMessage(text), tokenUsage: { input: 1, output: 1 } });
    questions();
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
  const stepMessages = (callIndex = 0): BaseMessage[] => callStep.mock.calls[callIndex][0].messages;
  const stepPrompts = (callIndex = 0): string[] => callStep.mock.calls[callIndex][0].systemPrompts;
  /** The load_skill ToolMessages the agent step saw. */
  const skillResults = (callIndex = 0): string[] =>
    stepMessages(callIndex)
      .filter((m) => m.getType() === "tool" && String(m.content).startsWith("Skill "))
      .map((m) => String(m.content));

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

    expect(stepPrompts()).toHaveLength(1);
    expect(toolNames()).not.toContain("load_skill");
    expect(result.kind).toBe("completed");
    if (result.kind === "completed") expect(result.skillsUsed).toEqual([]);
  });

  it("lists the offered skills in one extra system prompt and offers load_skill", async () => {
    const service = await build({ withProvider: true });
    answerDirectly();

    await service.run({ ...baseParams, offeredSkills: [EMAIL, HUMANIZER] });

    const systemPrompts = stepPrompts();
    expect(systemPrompts).toHaveLength(2);
    expect(systemPrompts[1]).toBe(
      OPERATOR_SKILLS_LIST_FRAMING + "\n\n- email: How we write emails\n- humanizer: Plain words",
    );
    expect(toolNames()).toContain("load_skill");
    expect(provider.load).not.toHaveBeenCalled();
    expect(skillResults()).toEqual([]);
  });

  it("/name: exactly one load pair right after the user message, no skills SystemMessage", async () => {
    const service = await build({ withProvider: true });
    answerDirectly();

    const result = await service.run({ ...baseParams, offeredSkills: [EMAIL, HUMANIZER], namedSkillNames: ["email"] });

    expect(provider.load).toHaveBeenCalledTimes(1);
    expect(provider.load).toHaveBeenCalledWith({ names: ["email"] });
    expect(provider.load.mock.invocationCallOrder[0]).toBeLessThan(callStep.mock.invocationCallOrder[0]);

    const messages = stepMessages();
    expect(messages.map((m) => m.getType())).toEqual(["human", "ai", "tool"]);
    expect(messages.some((m) => m.getType() === "system")).toBe(false);
    const call = (messages[1] as AIMessage).tool_calls ?? [];
    expect(call).toHaveLength(1);
    expect(call[0]).toMatchObject({ name: "load_skill", args: { name: "email" } });
    expect((messages[2] as ToolMessage).tool_call_id).toBe(call[0].id);
    expect(messages[2].content).toBe(loadedResult("email"));
    expect(skillResults()).toEqual([loadedResult("email")]);

    // The named skill is not listed again; the others still are.
    expect(stepPrompts()[1]).not.toContain("- email:");
    expect(stepPrompts()[1]).toContain("- humanizer:");
    if (result.kind === "completed") expect(result.skillsUsed).toEqual(["email"]);
  });

  it("keeps the hydration system message first and adds no system message for the skill", async () => {
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

    const messages = stepMessages();
    expect(messages.map((m) => m.getType())).toEqual(["system", "human", "ai", "tool"]);
    expect(messages[0].content).toBe("hydration");
    // Nothing left to list: no skills system prompt at all.
    expect(stepPrompts()).toHaveLength(1);
  });

  it("a skill the model loads itself comes back as header + text, stops being listed, and joins skillsUsed", async () => {
    const service = await build({ withProvider: true });
    callStep.mockResolvedValueOnce({
      message: aiToolCalls([{ name: "load_skill", args: { name: "humanizer" } }]),
      tokenUsage: { input: 1, output: 1 },
    });
    answerDirectly();

    const result = await service.run({ ...baseParams, offeredSkills: [EMAIL, HUMANIZER], namedSkillNames: ["email"] });

    expect(skillResults(1)).toEqual([loadedResult("email"), loadedResult("humanizer")]);
    expect(stepPrompts(0)[1]).toContain("- humanizer:");
    expect(stepPrompts(1)).toHaveLength(1);
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
  });

  it("the agent's text written under a skill is the answer, byte for byte", async () => {
    const service = await build({ withProvider: true });
    answerDirectly("Cheers,\nThe Team");

    const result = await service.run({ ...baseParams, offeredSkills: [EMAIL], namedSkillNames: ["email"] });

    if (result.kind !== "completed") throw new Error("expected completed");
    expect(result.answer).toBe("Cheers,\nThe Team");
  });

  it("finalise only writes the questions, from the question and the answer, with no skill text", async () => {
    const service = await build({ withProvider: true });
    answerDirectly("Cheers");

    await service.run({ ...baseParams, offeredSkills: [EMAIL], namedSkillNames: ["email"] });

    expect(llmCall).toHaveBeenCalledTimes(1);
    const args = llmCall.mock.calls[0][0];
    expect(args.inputParams).toEqual({ question: "do the thing", answer: "Cheers" });
    expect(JSON.stringify(args)).not.toContain(INSTRUCTIONS.email);
    expect(args.instructions).not.toContain("{skills}");
    expect(args.instructions).not.toContain("{conversation}");
  });

  it("the fallback answer reads the skill only from the transcript, never from a skills block", async () => {
    const service = await build({ withProvider: true });
    callStep.mockResolvedValueOnce({ message: new AIMessage(""), tokenUsage: { input: 1, output: 1 } });
    llmCall.mockResolvedValueOnce({ answer: "fallback", questions: [], tokenUsage: { input: 1, output: 1 } });

    const result = await service.run({ ...baseParams, offeredSkills: [EMAIL], namedSkillNames: ["email"] });

    if (result.kind !== "completed") throw new Error("expected completed");
    expect(result.answer).toBe("fallback");
    const args = llmCall.mock.calls[0][0];
    expect(args.inputParams).not.toHaveProperty("skills");
    expect(args.instructions).not.toContain("{skills}");
    expect(args.inputParams.conversation).toContain(loadedResult("email"));
    expect(result.skillsUsed).toEqual(["email"]);
  });

  it("keeps braces, backticks and dollar-brace in the instructions unchanged", async () => {
    const tricky = "Use {a} and } then a ` and $" + "{x} here.";
    provider.load.mockImplementation(async ({ names }: { names: string[] }) =>
      names.map((name) => ({ name, instructions: tricky })),
    );
    const service = await build({ withProvider: true });
    answerDirectly();

    await service.run({ ...baseParams, offeredSkills: [EMAIL], namedSkillNames: ["email"] });

    expect(skillResults()).toEqual([renderLoadedSkillResult({ name: "email", instructions: tricky })]);
  });

  it("carries skills from earlier answers as load pairs, before the named ones", async () => {
    const service = await build({ withProvider: true });
    answerDirectly();

    const result = await service.run({
      ...baseParams,
      offeredSkills: [EMAIL, HUMANIZER],
      carriedSkillNames: ["humanizer"],
      namedSkillNames: ["email"],
    });

    expect(provider.load).toHaveBeenCalledTimes(1);
    expect(provider.load).toHaveBeenCalledWith({ names: ["humanizer", "email"] });
    expect(stepMessages().map((m) => m.getType())).toEqual(["human", "ai", "tool", "ai", "tool"]);
    expect(skillResults()).toEqual([loadedResult("humanizer"), loadedResult("email")]);
    // Both already loaded: nothing is listed.
    expect(stepPrompts()).toHaveLength(1);
    if (result.kind !== "completed") throw new Error("expected completed");
    expect(result.skillsUsed).toEqual(["humanizer", "email"]);
  });

  it("a carried skill named again is loaded once", async () => {
    const service = await build({ withProvider: true });
    answerDirectly();

    const result = await service.run({
      ...baseParams,
      offeredSkills: [EMAIL, HUMANIZER],
      carriedSkillNames: ["email"],
      namedSkillNames: ["email"],
    });

    expect(provider.load).toHaveBeenCalledWith({ names: ["email"] });
    expect(skillResults()).toEqual([loadedResult("email")]);
    if (result.kind === "completed") expect(result.skillsUsed).toEqual(["email"]);
  });

  it("a carried skill no longer active is simply not reloaded", async () => {
    const service = await build({ withProvider: true });
    answerDirectly();

    const result = await service.run({
      ...baseParams,
      offeredSkills: [EMAIL],
      carriedSkillNames: ["removed-skill", "email"],
    });

    expect(provider.load).toHaveBeenCalledWith({ names: ["removed-skill", "email"] });
    expect(skillResults()).toEqual([loadedResult("email")]);
    if (result.kind !== "completed") throw new Error("expected completed");
    expect(result.skillsUsed).toEqual(["email"]);
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
    const systemPrompts = stepPrompts();
    expect(systemPrompts[1]).toContain("- email:");
    expect(systemPrompts[1]).not.toContain("- humanizer:");
    expect(provider.load).toHaveBeenCalledWith({ names: ["humanizer"] });
    expect(skillResults()).toEqual([loadedResult("humanizer")]);
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

    expect(stepPrompts()).toHaveLength(1);
    expect(toolNames()).not.toContain("load_skill");
  });

  it("after an approval pause the skill messages are still in the conversation, without reading them again", async () => {
    const service = await build({ withProvider: true });
    callStep.mockResolvedValueOnce({
      message: aiToolCalls([{ name: "load_skill", args: { name: "humanizer" }, id: "self" }]),
      tokenUsage: { input: 1, output: 1 },
    });
    callStep.mockResolvedValueOnce({
      message: aiToolCalls([{ name: "operator_test_action", args: { note: "x" } }]),
      tokenUsage: { input: 1, output: 1 },
    });

    const first = await service.run({
      ...baseParams,
      offeredSkills: [EMAIL, HUMANIZER],
      carriedSkillNames: ["email"],
    });
    expect(first.kind).toBe("pending_approval");
    expect(provider.load).toHaveBeenCalledTimes(2);

    // The skills were edited or deleted meanwhile: the provider now returns nothing.
    provider.load.mockReset();
    provider.load.mockResolvedValue([]);
    answerDirectly("approved and done");

    const second = await service.resume({
      threadId: baseParams.threadId,
      approved: true,
      companyId: baseParams.companyId,
      userId: baseParams.userId,
      userModuleIds: baseParams.userModuleIds,
      offeredSkills: [EMAIL, HUMANIZER],
    });

    expect(provider.load).not.toHaveBeenCalled();
    // The resumed agent step still sees both skill texts, and lists neither.
    expect(skillResults(2)).toEqual([loadedResult("email"), loadedResult("humanizer")]);
    expect(stepPrompts(2)).toHaveLength(1);
    if (second.kind !== "completed") throw new Error("expected completed");
    expect(second.answer).toBe("approved and done");
    expect(second.skillsUsed).toEqual(["email", "humanizer"]);
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
