import { vi, describe, it, expect, beforeEach, afterEach, MockedObject } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { GraphCreatorService } from "../graph.creator.service";
import { LLMService } from "../../../../core/llm/services/llm.service";
import { AppLoggingService } from "../../../../core/logging/services/logging.service";
import { TokenUsageType } from "../../../../foundations/tokenusage/enums/tokenusage.type";

describe("GraphCreatorService", () => {
  let service: GraphCreatorService;
  let llmService: MockedObject<LLMService>;
  let logger: MockedObject<AppLoggingService>;
  let configService: MockedObject<ConfigService>;

  const createMockLogger = () => ({
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    logWithContext: vi.fn(),
    errorWithContext: vi.fn(),
    setRequestContext: vi.fn(),
    getRequestContext: vi.fn(),
    clearRequestContext: vi.fn(),
    createChildLogger: vi.fn(),
    logHttpRequest: vi.fn(),
    logHttpError: vi.fn(),
    logBusinessEvent: vi.fn(),
    logSecurityEvent: vi.fn(),
  });

  const createMockLLMService = () => ({
    call: vi.fn(),
    chat: vi.fn(),
    embed: vi.fn(),
    getEmbeddingVector: vi.fn(),
  });

  const createMockConfigService = () => ({
    get: vi.fn().mockReturnValue(null),
  });

  const createValidLLMResponse = () => ({
    atomicFacts: [
      {
        atomicFact: "Joe Bauer was born in London on 03.04.1985",
        keyConcepts: ["joe bauer", "london", "03.04.1985"],
      },
      {
        atomicFact: "Joe Bauer studied computer science at MIT",
        keyConcepts: ["joe bauer", "computer science", "mit"],
      },
    ],
    keyConceptsRelationships: [
      {
        node_1: "joe bauer",
        node_2: "london",
        edge: "Joe Bauer was born in London",
      },
      {
        node_1: "joe bauer",
        node_2: "mit",
        edge: "Joe Bauer studied at MIT",
      },
    ],
    keyConceptDescriptions: [
      {
        keyConcept: "joe bauer",
        description: "A person who was born in London and studied at MIT",
      },
      {
        keyConcept: "london",
        description: "A major city in the United Kingdom",
      },
      {
        keyConcept: "mit",
        description: "Massachusetts Institute of Technology, a prestigious university",
      },
    ],
    tokenUsage: { input: 100, output: 50 },
  });

  beforeEach(async () => {
    vi.clearAllMocks();

    const mockLogger = createMockLogger();
    const mockLLMService = createMockLLMService();
    const mockConfigService = createMockConfigService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GraphCreatorService,
        { provide: AppLoggingService, useValue: mockLogger },
        { provide: LLMService, useValue: mockLLMService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<GraphCreatorService>(GraphCreatorService);
    logger = module.get(AppLoggingService) as MockedObject<AppLoggingService>;
    llmService = module.get(LLMService) as MockedObject<LLMService>;
    configService = module.get(ConfigService) as MockedObject<ConfigService>;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create the service", () => {
      expect(service).toBeDefined();
    });
  });

  describe("generateGraph", () => {
    describe("input validation", () => {
      it("should return null for empty content", async () => {
        // Act
        const result = await service.generateGraph({ content: "" });

        // Assert
        expect(result).toBeNull();
        expect(logger.warn).toHaveBeenCalledWith(
          "Chunk rejected: empty or invalid content",
          "GraphCreatorService",
          expect.any(Object),
        );
        expect(llmService.call).not.toHaveBeenCalled();
      });

      it("should return null for null content", async () => {
        // Act
        const result = await service.generateGraph({ content: null as any });

        // Assert
        expect(result).toBeNull();
        expect(llmService.call).not.toHaveBeenCalled();
      });

      it("should return null for whitespace-only content", async () => {
        // Act
        const result = await service.generateGraph({ content: "   \n\t   " });

        // Assert
        expect(result).toBeNull();
        expect(llmService.call).not.toHaveBeenCalled();
      });
    });

    describe("garbage text detection", () => {
      it("should return null for too short content", async () => {
        // Act
        const result = await service.generateGraph({ content: "Short text" });

        // Assert
        expect(result).toBeNull();
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining("Chunk rejected as garbage"),
          "GraphCreatorService",
        );
      });

      it("should return null for content with low alphanumeric ratio", async () => {
        // Arrange - content with mostly special characters
        const garbageContent = "!§Ydsv$%^&*(){}[]|\\:;<>?!@#$%^&*(){}[]|\\:;<>?!@#$%^&*(){}[]|\\:;<>?";

        // Act
        const result = await service.generateGraph({ content: garbageContent });

        // Assert
        expect(result).toBeNull();
      });

      it("should return null for content with high punctuation ratio", async () => {
        // Arrange - content with excessive punctuation
        const garbageContent = "....!!!!....!!!!....!!!!....!!!!....!!!!....!!!!....!!!!....!!!!....!!!!";

        // Act
        const result = await service.generateGraph({ content: garbageContent });

        // Assert
        expect(result).toBeNull();
      });

      it("should return null for content with high digit ratio", async () => {
        // Arrange - content that's mostly numbers
        const garbageContent = "1234567890123456789012345678901234567890123456789012345678901234567890";

        // Act
        const result = await service.generateGraph({ content: garbageContent });

        // Assert
        expect(result).toBeNull();
      });

      it("should return null for repetitive content", async () => {
        // Arrange - highly repetitive content
        const repetitiveContent = Array(50).fill("word").join(" ");

        // Act
        const result = await service.generateGraph({ content: repetitiveContent });

        // Assert
        expect(result).toBeNull();
      });
    });

    describe("successful graph generation", () => {
      it("should process valid content and return structured result", async () => {
        // Arrange
        const validContent = `Joe Bauer was born in London on 03.04.1985. He later studied computer science
          at MIT where he excelled in his studies and became a renowned researcher in the field.`;

        llmService.call.mockResolvedValue(createValidLLMResponse());

        // Act
        const result = await service.generateGraph({ content: validContent });

        // Assert
        expect(result).not.toBeNull();
        expect(result.atomicFacts).toHaveLength(2);
        expect(result.keyConceptsRelationships).toHaveLength(2);
        expect(result.tokens).toEqual({ input: 100, output: 50 });
      });

      it("should call LLM with correct parameters", async () => {
        // Arrange
        const content = `Joe Bauer was born in London on 03.04.1985. He studied computer science at a prestigious university.`;

        llmService.call.mockResolvedValue(createValidLLMResponse());

        // Act
        await service.generateGraph({ content });

        // Assert
        expect(llmService.call).toHaveBeenCalledWith(
          expect.objectContaining({
            inputParams: expect.objectContaining({
              content: content.trim(),
            }),
            temperature: 0.1,
          }),
        );
      });

      it("should thread GraphCreator attribution to the LLM call", async () => {
        // Arrange
        const content = `Joe Bauer was born in London on 03.04.1985. He studied computer science at a prestigious university.`;

        llmService.call.mockResolvedValue(createValidLLMResponse());

        // Act
        await service.generateGraph({
          content,
          relationshipId: "article-123",
          relationshipType: "Article",
        });

        // Assert - central persistUsage uses tokenUsageType + relationshipId/relationshipType
        // (top-level call params) to attribute the call as GraphCreator against the chunk's owning node.
        expect(llmService.call).toHaveBeenCalledWith(
          expect.objectContaining({
            tokenUsageType: TokenUsageType.GraphCreator,
            relationshipId: "article-123",
            relationshipType: "Article",
            metadata: expect.objectContaining({
              nodeName: "graph_creator",
              agentName: "graph",
            }),
          }),
        );
      });

      it("should log debug messages during processing", async () => {
        // Arrange
        const content = `Joe Bauer was born in London on 03.04.1985. He studied at MIT and became a successful researcher.`;

        llmService.call.mockResolvedValue(createValidLLMResponse());

        // Act
        await service.generateGraph({ content });

        // Assert
        expect(logger.debug).toHaveBeenCalledWith(
          "Starting graph generation",
          "GraphCreatorService",
          expect.any(Object),
        );
        expect(logger.debug).toHaveBeenCalledWith("LLM response received", "GraphCreatorService", expect.any(Object));
        expect(logger.debug).toHaveBeenCalledWith(
          "Graph generation completed successfully",
          "GraphCreatorService",
          expect.any(Object),
        );
      });
    });

    describe("post-LLM filtering", () => {
      it("should filter out invalid key concepts", async () => {
        // Arrange
        const content = `This is a valid document about Joe Bauer who was born in London. The document contains relevant information.`;

        const llmResponseWithInvalidConcepts = {
          atomicFacts: [
            {
              atomicFact: "Joe Bauer was born in London",
              keyConcepts: ["joe bauer", "london", "!", "12.40", "a"],
            },
          ],
          keyConceptsRelationships: [
            {
              node_1: "joe bauer",
              node_2: "london",
              edge: "was born in",
            },
          ],
          keyConceptDescriptions: [
            { keyConcept: "joe bauer", description: "A person" },
            { keyConcept: "london", description: "A city" },
            { keyConcept: "!", description: "Invalid concept" },
          ],
          tokenUsage: { input: 100, output: 50 },
        };

        llmService.call.mockResolvedValue(llmResponseWithInvalidConcepts);

        // Act
        const result = await service.generateGraph({ content });

        // Assert
        expect(result.atomicFacts[0].keyConcepts).not.toContain("!");
        expect(result.atomicFacts[0].keyConcepts).not.toContain("12.40");
        expect(result.atomicFacts[0].keyConcepts).not.toContain("a");
        expect(result.atomicFacts[0].keyConcepts).toContain("joe bauer");
        expect(result.atomicFacts[0].keyConcepts).toContain("london");
      });

      it("should filter out relationships with invalid key concepts", async () => {
        // Arrange
        const content = `This is a valid document with enough content to pass the garbage text detection algorithm.`;

        const llmResponseWithInvalidRelationships = {
          atomicFacts: [
            {
              atomicFact: "Joe Bauer was born in London",
              keyConcepts: ["joe bauer", "london"],
            },
          ],
          keyConceptsRelationships: [
            {
              node_1: "joe bauer",
              node_2: "london",
              edge: "was born in",
            },
            {
              node_1: "!",
              node_2: "london",
              edge: "invalid relationship",
            },
            {
              node_1: "joe bauer",
              node_2: "joe bauer",
              edge: "self-referencing relationship",
            },
          ],
          keyConceptDescriptions: [],
          tokenUsage: { input: 100, output: 50 },
        };

        llmService.call.mockResolvedValue(llmResponseWithInvalidRelationships);

        // Act
        const result = await service.generateGraph({ content });

        // Assert
        expect(result.keyConceptsRelationships).toHaveLength(1);
        expect(result.keyConceptsRelationships[0].keyConcept1).toBe("joe bauer");
        expect(result.keyConceptsRelationships[0].keyConcept2).toBe("london");
      });

      it("should normalize key concepts to lowercase", async () => {
        // Arrange
        const content = `This is a valid document about Joe Bauer who was born in London and studied computer science.`;

        const llmResponseWithMixedCase = {
          atomicFacts: [
            {
              atomicFact: "Joe Bauer was born in London",
              keyConcepts: ["Joe Bauer", "LONDON", "Computer Science"],
            },
          ],
          keyConceptsRelationships: [
            {
              node_1: "Joe Bauer",
              node_2: "LONDON",
              edge: "was born in",
            },
          ],
          keyConceptDescriptions: [{ keyConcept: "Joe Bauer", description: "A person" }],
          tokenUsage: { input: 100, output: 50 },
        };

        llmService.call.mockResolvedValue(llmResponseWithMixedCase);

        // Act
        const result = await service.generateGraph({ content });

        // Assert
        expect(result.atomicFacts[0].keyConcepts).toContain("joe bauer");
        expect(result.atomicFacts[0].keyConcepts).toContain("london");
        expect(result.atomicFacts[0].keyConcepts).toContain("computer science");
        expect(result.keyConceptsRelationships[0].keyConcept1).toBe("joe bauer");
        expect(result.keyConceptsRelationships[0].keyConcept2).toBe("london");
      });

      it("should return null when all content is filtered out", async () => {
        // Arrange
        const content = `This is a valid document with enough content to pass the initial garbage text detection check.`;

        const llmResponseAllInvalid = {
          atomicFacts: [
            {
              atomicFact: "Some fact",
              keyConcepts: ["!", "?", "...", "12.40"],
            },
          ],
          keyConceptsRelationships: [],
          keyConceptDescriptions: [],
          tokenUsage: { input: 100, output: 50 },
        };

        llmService.call.mockResolvedValue(llmResponseAllInvalid);

        // Act
        const result = await service.generateGraph({ content });

        // Assert
        expect(result).toBeNull();
        expect(logger.warn).toHaveBeenCalledWith(
          "Chunk rejected: all content filtered out after post-LLM validation",
          "GraphCreatorService",
          expect.any(Object),
        );
      });

      it("should filter out atomic facts with no valid key concepts", async () => {
        // Arrange
        const content = `This is a valid document about Joe Bauer and also contains some other information worth analyzing.`;

        const llmResponseMixedFacts = {
          atomicFacts: [
            {
              atomicFact: "Joe Bauer was born in London",
              keyConcepts: ["joe bauer", "london"],
            },
            {
              atomicFact: "Some garbage fact",
              keyConcepts: ["!", "?", "12.40"],
            },
          ],
          keyConceptsRelationships: [],
          keyConceptDescriptions: [],
          tokenUsage: { input: 100, output: 50 },
        };

        llmService.call.mockResolvedValue(llmResponseMixedFacts);

        // Act
        const result = await service.generateGraph({ content });

        // Assert
        expect(result.atomicFacts).toHaveLength(1);
        expect(result.atomicFacts[0].content).toBe("Joe Bauer was born in London");
      });
    });

    describe("key concept descriptions", () => {
      it("should only include descriptions for valid key concepts present in atomic facts", async () => {
        // Arrange
        const content = `This is a valid document about Joe Bauer who was born in London and has an interesting history.`;

        const llmResponseWithDescriptions = {
          atomicFacts: [
            {
              atomicFact: "Joe Bauer was born in London",
              keyConcepts: ["joe bauer", "london"],
            },
          ],
          keyConceptsRelationships: [],
          keyConceptDescriptions: [
            { keyConcept: "joe bauer", description: "A person born in London" },
            { keyConcept: "london", description: "A city in UK" },
            { keyConcept: "invalid concept", description: "Should be filtered" },
            { keyConcept: "!", description: "Should also be filtered" },
          ],
          tokenUsage: { input: 100, output: 50 },
        };

        llmService.call.mockResolvedValue(llmResponseWithDescriptions);

        // Act
        const result = await service.generateGraph({ content });

        // Assert
        expect(result.keyConceptDescriptions).toHaveLength(2);
        expect(result.keyConceptDescriptions.map((d) => d.keyConcept)).toContain("joe bauer");
        expect(result.keyConceptDescriptions.map((d) => d.keyConcept)).toContain("london");
      });
    });

    describe("custom prompts from config", () => {
      it("should use custom prompt from config if provided", async () => {
        // This is tested implicitly through the constructor
        // The config is accessed during instantiation
        expect(configService.get).toHaveBeenCalledWith("prompts");
      });
    });

    describe("edge cases", () => {
      it("should handle empty LLM response arrays", async () => {
        // Arrange
        const content = `This is a valid document with enough content to pass the garbage detection but yields empty results.`;

        const emptyLLMResponse = {
          atomicFacts: [],
          keyConceptsRelationships: [],
          keyConceptDescriptions: [],
          tokenUsage: { input: 50, output: 10 },
        };

        llmService.call.mockResolvedValue(emptyLLMResponse);

        // Act
        const result = await service.generateGraph({ content });

        // Assert
        expect(result).toBeNull();
      });

      it("should handle missing keyConceptDescriptions in LLM response", async () => {
        // Arrange
        const content = `This is a valid document about Joe Bauer who was born in London and lived there for years.`;

        const llmResponseNoDescriptions = {
          atomicFacts: [
            {
              atomicFact: "Joe Bauer was born in London",
              keyConcepts: ["joe bauer", "london"],
            },
          ],
          keyConceptsRelationships: [],
          tokenUsage: { input: 100, output: 50 },
        };

        llmService.call.mockResolvedValue(llmResponseNoDescriptions);

        // Act
        const result = await service.generateGraph({ content });

        // Assert
        expect(result.keyConceptDescriptions).toEqual([]);
      });

      it("should trim whitespace from content and key concepts", async () => {
        // Arrange
        const content = `   This is a valid document about Joe Bauer who was born in London with leading whitespace.   `;

        const llmResponseWithWhitespace = {
          atomicFacts: [
            {
              atomicFact: "  Joe Bauer was born in London  ",
              keyConcepts: ["  joe bauer  ", "  london  "],
            },
          ],
          keyConceptsRelationships: [
            {
              node_1: "  joe bauer  ",
              node_2: "  london  ",
              edge: "was born in",
            },
          ],
          keyConceptDescriptions: [],
          tokenUsage: { input: 100, output: 50 },
        };

        llmService.call.mockResolvedValue(llmResponseWithWhitespace);

        // Act
        const result = await service.generateGraph({ content });

        // Assert
        expect(result.atomicFacts[0].content).toBe("Joe Bauer was born in London");
        expect(result.atomicFacts[0].keyConcepts).toContain("joe bauer");
        expect(result.atomicFacts[0].keyConcepts).toContain("london");
      });
    });
  });
});
