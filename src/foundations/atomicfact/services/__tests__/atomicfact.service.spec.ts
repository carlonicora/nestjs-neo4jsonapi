import { vi, describe, it, expect, beforeEach, afterEach, MockedObject } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { createHash } from "crypto";
import { AtomicFactService } from "../atomicfact.service";
import { AtomicFactRepository } from "../../repositories/atomicfact.repository";
import { KeyConceptService } from "../../../keyconcept/services/keyconcept.service";

describe("AtomicFactService", () => {
  let service: AtomicFactService;
  let atomicFactRepository: MockedObject<AtomicFactRepository>;
  let keyConceptService: MockedObject<KeyConceptService>;

  const TEST_DATA = {
    chunkId: "550e8400-e29b-41d4-a716-446655440000",
    content: "This is an atomic fact about the solar system.",
    keyConcepts: ["solar system", "astronomy"],
  };

  const createMockAtomicFactRepository = () => ({
    createAtomicFact: vi.fn(),
    deleteDisconnectedAtomicFacts: vi.fn(),
    findByChunkId: vi.fn(),
    deleteByChunkId: vi.fn(),
  });

  const createMockKeyConceptService = () => ({
    createKeyConcept: vi.fn(),
    deleteDisconnectedKeyConcepts: vi.fn(),
    findByAtomicFactId: vi.fn(),
  });

  beforeEach(async () => {
    vi.clearAllMocks();

    const mockAtomicFactRepository = createMockAtomicFactRepository();
    const mockKeyConceptService = createMockKeyConceptService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AtomicFactService,
        { provide: AtomicFactRepository, useValue: mockAtomicFactRepository },
        { provide: KeyConceptService, useValue: mockKeyConceptService },
      ],
    }).compile();

    service = module.get<AtomicFactService>(AtomicFactService);
    atomicFactRepository = module.get(AtomicFactRepository) as MockedObject<AtomicFactRepository>;
    keyConceptService = module.get(KeyConceptService) as MockedObject<KeyConceptService>;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create the service", () => {
      expect(service).toBeDefined();
    });
  });

  describe("createAtomicFact", () => {
    it("should create an atomic fact with MD5 hash ID", async () => {
      // Arrange
      const expectedAtomicFactId = createHash("md5").update(TEST_DATA.content).digest("hex");
      atomicFactRepository.createAtomicFact.mockResolvedValue(undefined);
      keyConceptService.createKeyConcept.mockResolvedValue(undefined);

      // Act
      await service.createAtomicFact({
        chunkId: TEST_DATA.chunkId,
        content: TEST_DATA.content,
        keyConcepts: TEST_DATA.keyConcepts,
      });

      // Assert
      expect(atomicFactRepository.createAtomicFact).toHaveBeenCalledWith({
        atomicFactId: expectedAtomicFactId,
        chunkId: TEST_DATA.chunkId,
        content: TEST_DATA.content,
      });
    });

    it("should create key concepts for each provided key concept", async () => {
      // Arrange
      const expectedAtomicFactId = createHash("md5").update(TEST_DATA.content).digest("hex");
      atomicFactRepository.createAtomicFact.mockResolvedValue(undefined);
      keyConceptService.createKeyConcept.mockResolvedValue(undefined);

      // Act
      await service.createAtomicFact({
        chunkId: TEST_DATA.chunkId,
        content: TEST_DATA.content,
        keyConcepts: TEST_DATA.keyConcepts,
      });

      // Assert
      expect(keyConceptService.createKeyConcept).toHaveBeenCalledTimes(2);
      expect(keyConceptService.createKeyConcept).toHaveBeenCalledWith({
        content: "solar system",
        atomicFactId: expectedAtomicFactId,
      });
      expect(keyConceptService.createKeyConcept).toHaveBeenCalledWith({
        content: "astronomy",
        atomicFactId: expectedAtomicFactId,
      });
    });

    it("should handle empty keyConcepts array", async () => {
      // Arrange
      atomicFactRepository.createAtomicFact.mockResolvedValue(undefined);

      // Act
      await service.createAtomicFact({
        chunkId: TEST_DATA.chunkId,
        content: TEST_DATA.content,
        keyConcepts: [],
      });

      // Assert
      expect(atomicFactRepository.createAtomicFact).toHaveBeenCalled();
      expect(keyConceptService.createKeyConcept).not.toHaveBeenCalled();
    });

    it("should generate consistent MD5 hash for same content", async () => {
      // Arrange
      atomicFactRepository.createAtomicFact.mockResolvedValue(undefined);
      keyConceptService.createKeyConcept.mockResolvedValue(undefined);

      // Act
      await service.createAtomicFact({
        chunkId: TEST_DATA.chunkId,
        content: "test content",
        keyConcepts: [],
      });

      await service.createAtomicFact({
        chunkId: "different-chunk-id",
        content: "test content",
        keyConcepts: [],
      });

      // Assert - same content should produce same atomicFactId
      const firstCall = atomicFactRepository.createAtomicFact.mock.calls[0][0];
      const secondCall = atomicFactRepository.createAtomicFact.mock.calls[1][0];
      expect(firstCall.atomicFactId).toBe(secondCall.atomicFactId);
    });

    it("should generate different MD5 hashes for different content", async () => {
      // Arrange
      atomicFactRepository.createAtomicFact.mockResolvedValue(undefined);
      keyConceptService.createKeyConcept.mockResolvedValue(undefined);

      // Act
      await service.createAtomicFact({
        chunkId: TEST_DATA.chunkId,
        content: "content one",
        keyConcepts: [],
      });

      await service.createAtomicFact({
        chunkId: TEST_DATA.chunkId,
        content: "content two",
        keyConcepts: [],
      });

      // Assert - different content should produce different atomicFactId
      const firstCall = atomicFactRepository.createAtomicFact.mock.calls[0][0];
      const secondCall = atomicFactRepository.createAtomicFact.mock.calls[1][0];
      expect(firstCall.atomicFactId).not.toBe(secondCall.atomicFactId);
    });

    it("should propagate errors from repository", async () => {
      // Arrange
      atomicFactRepository.createAtomicFact.mockRejectedValue(new Error("Database error"));

      // Act & Assert
      await expect(
        service.createAtomicFact({
          chunkId: TEST_DATA.chunkId,
          content: TEST_DATA.content,
          keyConcepts: [],
        }),
      ).rejects.toThrow("Database error");
    });

    it("should propagate errors from keyConceptService", async () => {
      // Arrange
      atomicFactRepository.createAtomicFact.mockResolvedValue(undefined);
      keyConceptService.createKeyConcept.mockRejectedValue(new Error("KeyConcept error"));

      // Act & Assert
      await expect(
        service.createAtomicFact({
          chunkId: TEST_DATA.chunkId,
          content: TEST_DATA.content,
          keyConcepts: ["concept"],
        }),
      ).rejects.toThrow("KeyConcept error");
    });
  });

  describe("deleteDisconnectedAtomicFacts", () => {
    it("should delete disconnected atomic facts", async () => {
      // Arrange
      atomicFactRepository.deleteDisconnectedAtomicFacts.mockResolvedValue(undefined);
      keyConceptService.deleteDisconnectedKeyConcepts.mockResolvedValue(undefined);

      // Act
      await service.deleteDisconnectedAtomicFacts();

      // Assert
      expect(atomicFactRepository.deleteDisconnectedAtomicFacts).toHaveBeenCalled();
    });

    it("should delete disconnected key concepts after deleting atomic facts", async () => {
      // Arrange
      atomicFactRepository.deleteDisconnectedAtomicFacts.mockResolvedValue(undefined);
      keyConceptService.deleteDisconnectedKeyConcepts.mockResolvedValue(undefined);

      // Act
      await service.deleteDisconnectedAtomicFacts();

      // Assert
      expect(keyConceptService.deleteDisconnectedKeyConcepts).toHaveBeenCalled();
    });

    it("should call repository before keyConceptService", async () => {
      // Arrange
      const callOrder: string[] = [];
      atomicFactRepository.deleteDisconnectedAtomicFacts.mockImplementation(async () => {
        callOrder.push("repository");
      });
      keyConceptService.deleteDisconnectedKeyConcepts.mockImplementation(async () => {
        callOrder.push("keyConceptService");
      });

      // Act
      await service.deleteDisconnectedAtomicFacts();

      // Assert
      expect(callOrder).toEqual(["repository", "keyConceptService"]);
    });

    it("should propagate errors from repository", async () => {
      // Arrange
      atomicFactRepository.deleteDisconnectedAtomicFacts.mockRejectedValue(new Error("Delete failed"));

      // Act & Assert
      await expect(service.deleteDisconnectedAtomicFacts()).rejects.toThrow("Delete failed");
    });

    it("should propagate errors from keyConceptService", async () => {
      // Arrange
      atomicFactRepository.deleteDisconnectedAtomicFacts.mockResolvedValue(undefined);
      keyConceptService.deleteDisconnectedKeyConcepts.mockRejectedValue(new Error("KeyConcept delete failed"));

      // Act & Assert
      await expect(service.deleteDisconnectedAtomicFacts()).rejects.toThrow("KeyConcept delete failed");
    });
  });
  // Embedding cost attribution (Task 8): creating an atomic fact costs nothing,
  // but each key concept it introduces is embedded — that spend belongs to the
  // entity whose ingestion produced the fact, so the attribution is forwarded.
  describe("embedding cost attribution", () => {
    it("forwards the ingestion attribution to every key concept it creates", async () => {
      const attribution = { relationshipId: "npc-1", relationshipType: "Npc" };

      await service.createAtomicFact({ ...TEST_DATA, attribution });

      expect(keyConceptService.createKeyConcept).toHaveBeenCalledTimes(TEST_DATA.keyConcepts.length);
      for (const call of keyConceptService.createKeyConcept.mock.calls) {
        expect(call[0]).toEqual(expect.objectContaining({ attribution }));
      }
    });
  });
});
