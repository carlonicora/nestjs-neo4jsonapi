import { describe, it, expect, vi, type Mock } from "vitest";
import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import {
  ResponderAnswerNodeService,
  buildResponderOutputSchema,
  defaultResponderAnalyseDescription,
  defaultResponderFinalAnswerDescription,
} from "../responder.answer.node.service";
import { LLMService } from "../../../../core/llm/services/llm.service";

/**
 * Pins the neural-erp guarantee: with no config, the responder answer node's
 * output schema and temperature are byte-identical to the historical
 * hardcoded values; with config, only the overridden pieces change.
 */

function buildState(): any {
  return {
    companyId: "co-1",
    contentId: undefined,
    contentType: undefined,
    dataLimits: undefined,
    context: undefined,
    driftContext: undefined,
    graphContext: undefined,
    tokens: { input: 0, output: 0 },
    finalAnswer: undefined,
    sources: undefined,
    references: undefined,
    ontologies: undefined,
    userId: "user-1",
    userModuleIds: [],
    rawQuestion: "what?",
    question: "what?",
    chatHistory: [],
    branchPlan: { runGraph: false, runContextualiser: false, runDrift: false, reasoning: "" },
    plannerError: null,
    graphError: null,
    contextualiserError: null,
    driftError: null,
    trace: {
      planner: {
        reasoning: "",
        branchPlan: { runGraph: false, runContextualiser: false, runDrift: false },
        tokens: { input: 0, output: 0 },
      },
      answer: { branchesUsed: [], tokens: { input: 0, output: 0 } },
      totalTokens: { input: 0, output: 0 },
    },
  };
}

async function makeService(promptsConfig: unknown) {
  const llm = {
    call: vi.fn().mockResolvedValue({
      title: "t",
      analyse: "a",
      citations: [],
      references: [],
      questions: [],
      finalAnswer: "f",
      tokenUsage: { input: 1, output: 1 },
    }),
  } as unknown as LLMService;
  const config = { get: vi.fn().mockReturnValue(promptsConfig) } as unknown as ConfigService;
  const moduleRef = await Test.createTestingModule({
    providers: [
      ResponderAnswerNodeService,
      { provide: LLMService, useValue: llm },
      { provide: ConfigService, useValue: config },
    ],
  }).compile();
  return { service: moduleRef.get(ResponderAnswerNodeService), llm };
}

describe("buildResponderOutputSchema", () => {
  it("defaults are the historical hardcoded descriptions", () => {
    const schema = buildResponderOutputSchema();
    expect(schema.shape.analyse.description).toBe(defaultResponderAnalyseDescription);
    expect(schema.shape.finalAnswer.description).toBe(defaultResponderFinalAnswerDescription);
    // Sentinels pinning today's exact policy text (the neural-erp guarantee):
    // these phrases MUST remain in the library defaults.
    expect(defaultResponderAnalyseDescription).toContain("majority voting strategy");
    expect(defaultResponderFinalAnswerDescription).toContain("using only information from the notebook");
    expect(defaultResponderFinalAnswerDescription).toContain("not available in the company knowledge");
  });

  it("overrides replace only the overridden descriptions", () => {
    const schema = buildResponderOutputSchema({ finalAnswer: "CUSTOM FINAL" });
    expect(schema.shape.finalAnswer.description).toBe("CUSTOM FINAL");
    expect(schema.shape.analyse.description).toBe(defaultResponderAnalyseDescription);
    expect(schema.shape.title.description).toBe(buildResponderOutputSchema().shape.title.description);
  });
});

describe("ResponderAnswerNodeService config overrides", () => {
  it("passes configured temperature and schema descriptions to the LLM call", async () => {
    const { service, llm } = await makeService({
      responderTemperature: 0.9,
      responderSchemaDescriptions: { finalAnswer: "CUSTOM FINAL", analyse: "CUSTOM ANALYSE" },
    });
    await service.execute({ state: buildState() });
    const callArgs = (llm.call as unknown as Mock).mock.calls[0][0];
    expect(callArgs.temperature).toBe(0.9);
    expect(callArgs.outputSchema.shape.finalAnswer.description).toBe("CUSTOM FINAL");
    expect(callArgs.outputSchema.shape.analyse.description).toBe("CUSTOM ANALYSE");
  });

  it("defaults to temperature 0.1 and default descriptions when config is absent", async () => {
    const { service, llm } = await makeService(undefined);
    await service.execute({ state: buildState() });
    const callArgs = (llm.call as unknown as Mock).mock.calls[0][0];
    expect(callArgs.temperature).toBe(0.1);
    expect(callArgs.outputSchema.shape.finalAnswer.description).toBe(defaultResponderFinalAnswerDescription);
    expect(callArgs.outputSchema.shape.analyse.description).toBe(defaultResponderAnalyseDescription);
  });
});
