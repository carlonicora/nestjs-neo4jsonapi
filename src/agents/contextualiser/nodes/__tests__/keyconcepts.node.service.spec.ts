import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { KeyConceptsNodeService } from "../keyconcepts.node.service";
import { ContextualiserContextState } from "../../contexts/contextualiser.context";

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

describe("keyconcepts node", () => {
  it("no longer carries the unreachable metadata/ontology block", () => {
    const source = readFileSync(join(__dirname, "..", "keyconcepts.node.service.ts"), "utf8");
    expect(source).not.toMatch(/metadataList/);
    expect(source).not.toMatch(/isUsedAsSource/);
  });

  describe("KeyConceptsNodeService", () => {
    let llmService: { call: ReturnType<typeof vi.fn> };
    let keyConceptRepository: {
      findPotentialKeyConcepts: ReturnType<typeof vi.fn>;
      findNeighboursByKeyConcepts: ReturnType<typeof vi.fn>;
    };
    let webSocketService: { sendMessageToUser: ReturnType<typeof vi.fn> };
    let clsService: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> };
    let configService: { get: ReturnType<typeof vi.fn> };

    const buildKeyConceptsNodeUnderTest = () => {
      llmService = {
        call: vi.fn().mockResolvedValue({
          status: "s",
          keyConcepts: [{ keyConcept: "kc-1", score: 90, isUsedAsSource: false }],
          tokenUsage: { input: 1, output: 1 },
        }),
      };
      keyConceptRepository = {
        findPotentialKeyConcepts: vi.fn().mockResolvedValue([{ value: "kc-1" }]),
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

      return { node, keyConceptRepository };
    };

    beforeEach(() => {
      buildKeyConceptsNodeUnderTest();
    });

    it("passes the state's question embedding to retrieval instead of re-embedding", async () => {
      const { node, keyConceptRepository } = buildKeyConceptsNodeUnderTest();
      await node.execute({
        state: { ...baseState(), questionEmbedding: [0.4, 0.6], nextStep: "key_concepts" } as never,
      });
      expect(keyConceptRepository.findPotentialKeyConcepts).toHaveBeenCalledWith(
        expect.objectContaining({ queryEmbedding: [0.4, 0.6] }),
      );
    });
  });
});
