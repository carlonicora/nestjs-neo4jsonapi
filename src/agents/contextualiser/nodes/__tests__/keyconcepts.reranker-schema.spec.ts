import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ContextualiserContextState } from "../../contexts/contextualiser.context";
import { KeyConceptsNodeService } from "../keyconcepts.node.service";

const MOCK_COMPANY_ID = "550e8400-e29b-41d4-a716-446655440000";
const MOCK_CONTENT_ID = "660e8400-e29b-41d4-a716-446655440001";

const baseState = (overrides?: Partial<ContextualiserContextState>): ContextualiserContextState =>
  ({
    companyId: MOCK_COMPANY_ID,
    contentId: MOCK_CONTENT_ID,
    contentType: "HowTo",
    hops: 0,
    limits: {},
    question: "Test question",
    rationalPlan: "Test rational plan",
    notebook: [],
    status: [],
    processedKeyConcepts: [],
    queuedKeyConcepts: [],
    ontology: [],
    nextStep: "key_concepts",
    tokens: { input: 0, output: 0 },
    ...overrides,
  }) as ContextualiserContextState;

describe("keyconcepts reranker wire format", () => {
  let llmService: { call: ReturnType<typeof vi.fn> };
  let keyConceptRepository: {
    findPotentialKeyConcepts: ReturnType<typeof vi.fn>;
    findNeighboursByKeyConcepts: ReturnType<typeof vi.fn>;
  };
  let webSocketService: { sendMessageToUser: ReturnType<typeof vi.fn> };
  let clsService: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> };
  let configService: { get: ReturnType<typeof vi.fn> };

  const buildKeyConceptsNodeUnderTest = (options?: { concepts?: string[]; llmResponse?: Record<string, unknown> }) => {
    llmService = {
      call: vi.fn().mockResolvedValue({
        status: "s",
        keyConcepts: [],
        tokenUsage: { input: 1, output: 1 },
        ...(options?.llmResponse ?? {}),
      }),
    };
    keyConceptRepository = {
      findPotentialKeyConcepts: vi.fn().mockResolvedValue((options?.concepts ?? ["kc-1"]).map((value) => ({ value }))),
      findNeighboursByKeyConcepts: vi.fn().mockResolvedValue([]),
    };
    webSocketService = { sendMessageToUser: vi.fn() };
    clsService = { get: vi.fn(), set: vi.fn() };
    configService = { get: vi.fn().mockReturnValue({}) };

    const node = new KeyConceptsNodeService(
      llmService as never,
      keyConceptRepository as never,
      webSocketService as never,
      clsService as never,
      configService as never,
    );

    return { node, llmService, keyConceptRepository };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("asks the model for indices, not echoed concept text", async () => {
    const { node, llmService: llm } = buildKeyConceptsNodeUnderTest({ concepts: ["alpha", "beta"] });

    await node.execute({ state: baseState() as never });

    expect(llm.call).toHaveBeenCalledTimes(1);
    const outputSchema = llm.call.mock.calls[0][0].outputSchema as z.ZodObject<{
      keyConcepts: z.ZodArray<z.ZodObject<Record<string, z.ZodTypeAny>>>;
    }>;

    const elementShape = (outputSchema.shape.keyConcepts as any).element.shape as Record<string, unknown>;
    const keys = Object.keys(elementShape);

    expect(keys).toContain("index");
    expect(keys).toContain("score");
    expect(keys).not.toContain("keyConcept");
    // The label is the model's restatement, not an identifier. It must be
    // declared BEFORE the score: the fields are generated in schema order, and
    // restating the concept before judging it is what anchors the score.
    expect(keys).toContain("label");
    expect(keys.indexOf("label")).toBeLessThan(keys.indexOf("score"));
    expect(keys.indexOf("index")).toBeLessThan(keys.indexOf("label"));
  });

  it("numbers the concepts it sends so the model can refer to them by position", async () => {
    const { node, llmService: llm } = buildKeyConceptsNodeUnderTest({ concepts: ["alpha", "beta", "gamma"] });

    await node.execute({ state: baseState() as never });

    expect(llm.call.mock.calls[0][0].inputParams.keyConcepts).toEqual([
      { index: 0, keyConcept: "alpha" },
      { index: 1, keyConcept: "beta" },
      { index: 2, keyConcept: "gamma" },
    ]);
  });

  it("maps indices back to concepts, drops out-of-range ones, and orders by score", async () => {
    const { node } = buildKeyConceptsNodeUnderTest({
      concepts: ["alpha", "beta", "gamma"],
      llmResponse: {
        keyConcepts: [
          { index: 2, score: 90 },
          { index: 0, score: 70 },
          { index: 99, score: 100 },
          { index: -1, score: 100 },
        ],
      },
    });

    const result = await node.execute({ state: baseState() as never });

    expect(result.queuedKeyConcepts).toEqual(["gamma", "alpha"]);
  });

  it("identifies concepts by index even when the model's label contradicts it", async () => {
    // Index says gamma, label says something else entirely. The index wins —
    // a mismatched label is no evidence about which of the two is wrong.
    const { node } = buildKeyConceptsNodeUnderTest({
      concepts: ["alpha", "beta", "gamma"],
      llmResponse: { keyConcepts: [{ index: 2, label: "totally wrong", score: 90 }] },
    });

    const result = await node.execute({ state: baseState() as never });

    expect(result.queuedKeyConcepts).toEqual(["gamma"]);
  });

  it("does not crash when the model omits the label", async () => {
    const { node } = buildKeyConceptsNodeUnderTest({
      concepts: ["alpha", "beta", "gamma"],
      llmResponse: { keyConcepts: [{ index: 1, score: 80 }] },
    });

    const result = await node.execute({ state: baseState() as never });

    expect(result.queuedKeyConcepts).toEqual(["beta"]);
  });

  it("labels the call for telemetry without overwriting the inherited attribution", async () => {
    const { node, llmService: llm } = buildKeyConceptsNodeUnderTest({ concepts: ["alpha"] });

    await node.execute({ state: baseState() as never });

    expect(llm.call.mock.calls[0][0].metadata).toEqual({
      agentName: "contextualiser",
      nodeName: "key_concepts",
    });
    expect(llm.call.mock.calls[0][0].tokenUsageType).toBeDefined();
  });
});
