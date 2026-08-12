import { vi, describe, it, expect, beforeEach, afterEach, MockedObject } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { KeyConceptService } from "../keyconcept.service";
import { KeyConceptRepository } from "../../repositories/keyconcept.repository";

describe("KeyConceptService", () => {
  let service: KeyConceptService;
  let keyConceptRepository: MockedObject<KeyConceptRepository>;

  const TEST_IDS = {
    atomicFactId: "550e8400-e29b-41d4-a716-446655440000",
    chunkId: "660e8400-e29b-41d4-a716-446655440001",
    companyId: "770e8400-e29b-41d4-a716-446655440002",
  };

  const createMockKeyConceptRepository = () => ({
    findKeyConceptsByValues: vi.fn(),
    findKeyConceptByValue: vi.fn(),
    createOrphanKeyConcepts: vi.fn(),
    createKeyConcept: vi.fn(),
    createKeyConceptRelation: vi.fn(),
    resizeKeyConceptRelationshipsWeightOnChunkDeletion: vi.fn(),
    createOrUpdateKeyConceptRelationships: vi.fn(),
    deleteDisconnectedKeyConcepts: vi.fn(),
    updateKeyConceptDescriptions: vi.fn(),
  });

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [KeyConceptService, { provide: KeyConceptRepository, useValue: createMockKeyConceptRepository() }],
    }).compile();

    service = module.get<KeyConceptService>(KeyConceptService);
    keyConceptRepository = module.get(KeyConceptRepository) as MockedObject<KeyConceptRepository>;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create the service", () => {
      expect(service).toBeDefined();
    });
  });

  describe("createOrphanKeyConcepts", () => {
    it("should create only missing key concepts", async () => {
      // Arrange
      const keyConceptValues = ["concept1", "concept2", "concept3"];
      keyConceptRepository.findKeyConceptsByValues.mockResolvedValue([{ id: "concept1" }, { id: "concept3" }]);
      keyConceptRepository.createOrphanKeyConcepts.mockResolvedValue(undefined);

      // Act
      await service.createOrphanKeyConcepts({ keyConceptValues });

      // Assert
      expect(keyConceptRepository.findKeyConceptsByValues).toHaveBeenCalledWith({
        keyConceptValues,
      });
      expect(keyConceptRepository.createOrphanKeyConcepts).toHaveBeenCalledWith({
        keyConceptValues: ["concept2"],
      });
    });

    it("should create all concepts when none exist", async () => {
      // Arrange
      const keyConceptValues = ["concept1", "concept2"];
      keyConceptRepository.findKeyConceptsByValues.mockResolvedValue([]);
      keyConceptRepository.createOrphanKeyConcepts.mockResolvedValue(undefined);

      // Act
      await service.createOrphanKeyConcepts({ keyConceptValues });

      // Assert
      expect(keyConceptRepository.createOrphanKeyConcepts).toHaveBeenCalledWith({
        keyConceptValues: ["concept1", "concept2"],
      });
    });

    it("should not create any concepts when all exist", async () => {
      // Arrange
      const keyConceptValues = ["concept1", "concept2"];
      keyConceptRepository.findKeyConceptsByValues.mockResolvedValue([{ id: "concept1" }, { id: "concept2" }]);
      keyConceptRepository.createOrphanKeyConcepts.mockResolvedValue(undefined);

      // Act
      await service.createOrphanKeyConcepts({ keyConceptValues });

      // Assert
      expect(keyConceptRepository.createOrphanKeyConcepts).toHaveBeenCalledWith({
        keyConceptValues: [],
      });
    });

    it("should propagate errors from repository", async () => {
      // Arrange
      keyConceptRepository.findKeyConceptsByValues.mockRejectedValue(new Error("Database error"));

      // Act & Assert
      await expect(service.createOrphanKeyConcepts({ keyConceptValues: ["concept1"] })).rejects.toThrow(
        "Database error",
      );
    });
  });

  describe("createKeyConcept", () => {
    it("should create new key concept when it does not exist", async () => {
      // Arrange
      keyConceptRepository.findKeyConceptByValue.mockResolvedValue(null);
      keyConceptRepository.createKeyConcept.mockResolvedValue(undefined);

      // Act
      await service.createKeyConcept({
        content: "new concept",
        atomicFactId: TEST_IDS.atomicFactId,
      });

      // Assert
      expect(keyConceptRepository.createKeyConcept).toHaveBeenCalledWith({
        keyConceptValue: "new concept",
        atomicFactId: TEST_IDS.atomicFactId,
      });
      expect(keyConceptRepository.createKeyConceptRelation).not.toHaveBeenCalled();
    });

    it("should create relation when key concept already exists", async () => {
      // Arrange
      keyConceptRepository.findKeyConceptByValue.mockResolvedValue({ id: "existing-concept" });
      keyConceptRepository.createKeyConceptRelation.mockResolvedValue(undefined);

      // Act
      await service.createKeyConcept({
        content: "existing concept",
        atomicFactId: TEST_IDS.atomicFactId,
      });

      // Assert
      expect(keyConceptRepository.createKeyConceptRelation).toHaveBeenCalledWith({
        keyConceptValue: "existing concept",
        atomicFactId: TEST_IDS.atomicFactId,
      });
      expect(keyConceptRepository.createKeyConcept).not.toHaveBeenCalled();
    });

    it("should propagate errors from findKeyConceptByValue", async () => {
      // Arrange
      keyConceptRepository.findKeyConceptByValue.mockRejectedValue(new Error("Find error"));

      // Act & Assert
      await expect(
        service.createKeyConcept({
          content: "concept",
          atomicFactId: TEST_IDS.atomicFactId,
        }),
      ).rejects.toThrow("Find error");
    });

    it("should propagate errors from createKeyConcept", async () => {
      // Arrange
      keyConceptRepository.findKeyConceptByValue.mockResolvedValue(null);
      keyConceptRepository.createKeyConcept.mockRejectedValue(new Error("Create error"));

      // Act & Assert
      await expect(
        service.createKeyConcept({
          content: "concept",
          atomicFactId: TEST_IDS.atomicFactId,
        }),
      ).rejects.toThrow("Create error");
    });
  });

  describe("resizeKeyConceptRelationshipsWeightOnChunkDeletion", () => {
    it("should call repository with chunkId", async () => {
      // Arrange
      keyConceptRepository.resizeKeyConceptRelationshipsWeightOnChunkDeletion.mockResolvedValue(undefined);

      // Act
      await service.resizeKeyConceptRelationshipsWeightOnChunkDeletion({
        chunkId: TEST_IDS.chunkId,
      });

      // Assert
      expect(keyConceptRepository.resizeKeyConceptRelationshipsWeightOnChunkDeletion).toHaveBeenCalledWith({
        chunkId: TEST_IDS.chunkId,
      });
    });

    it("should propagate errors from repository", async () => {
      // Arrange
      keyConceptRepository.resizeKeyConceptRelationshipsWeightOnChunkDeletion.mockRejectedValue(
        new Error("Resize error"),
      );

      // Act & Assert
      await expect(
        service.resizeKeyConceptRelationshipsWeightOnChunkDeletion({ chunkId: TEST_IDS.chunkId }),
      ).rejects.toThrow("Resize error");
    });
  });

  describe("addKeyConceptRelationships", () => {
    it("should create or update relationships", async () => {
      // Arrange
      const relationships = [
        { keyConcept1: "concept1", keyConcept2: "concept2", relationship: "relates_to" },
        { keyConcept1: "concept2", keyConcept2: "concept3", relationship: "depends_on" },
      ];
      keyConceptRepository.createOrUpdateKeyConceptRelationships.mockResolvedValue(undefined);

      // Act
      await service.addKeyConceptRelationships({
        companyId: TEST_IDS.companyId,
        chunkId: TEST_IDS.chunkId,
        relationships,
      });

      // Assert
      expect(keyConceptRepository.createOrUpdateKeyConceptRelationships).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
        chunkId: TEST_IDS.chunkId,
        relationships,
      });
    });

    it("should handle empty relationships array", async () => {
      // Arrange
      keyConceptRepository.createOrUpdateKeyConceptRelationships.mockResolvedValue(undefined);

      // Act
      await service.addKeyConceptRelationships({
        companyId: TEST_IDS.companyId,
        chunkId: TEST_IDS.chunkId,
        relationships: [],
      });

      // Assert
      expect(keyConceptRepository.createOrUpdateKeyConceptRelationships).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
        chunkId: TEST_IDS.chunkId,
        relationships: [],
      });
    });

    it("should propagate errors from repository", async () => {
      // Arrange
      keyConceptRepository.createOrUpdateKeyConceptRelationships.mockRejectedValue(new Error("Relationship error"));

      // Act & Assert
      await expect(
        service.addKeyConceptRelationships({
          companyId: TEST_IDS.companyId,
          chunkId: TEST_IDS.chunkId,
          relationships: [],
        }),
      ).rejects.toThrow("Relationship error");
    });
  });

  describe("deleteDisconnectedKeyConcepts", () => {
    it("should call repository to delete disconnected key concepts", async () => {
      // Arrange
      keyConceptRepository.deleteDisconnectedKeyConcepts.mockResolvedValue(undefined);

      // Act
      await service.deleteDisconnectedKeyConcepts();

      // Assert
      expect(keyConceptRepository.deleteDisconnectedKeyConcepts).toHaveBeenCalled();
    });

    it("should propagate errors from repository", async () => {
      // Arrange
      keyConceptRepository.deleteDisconnectedKeyConcepts.mockRejectedValue(new Error("Delete error"));

      // Act & Assert
      await expect(service.deleteDisconnectedKeyConcepts()).rejects.toThrow("Delete error");
    });
  });
  // Embedding cost attribution (Task 8): the service only FORWARDS what
  // ChunkService.generateGraph supplies — it never invents an attribution.
  describe("embedding cost attribution", () => {
    const ATTRIBUTION = { relationshipId: "npc-1", relationshipType: "Npc" };

    it("forwards the ingestion attribution to createOrphanKeyConcepts", async () => {
      keyConceptRepository.findKeyConceptsByValues.mockResolvedValue([]);

      await service.createOrphanKeyConcepts({ keyConceptValues: ["concept1"], attribution: ATTRIBUTION });

      expect(keyConceptRepository.createOrphanKeyConcepts).toHaveBeenCalledWith({
        keyConceptValues: ["concept1"],
        attribution: ATTRIBUTION,
      });
    });

    it("forwards the ingestion attribution to createKeyConcept", async () => {
      keyConceptRepository.findKeyConceptByValue.mockResolvedValue(null);

      await service.createKeyConcept({
        content: "concept1",
        atomicFactId: TEST_IDS.atomicFactId,
        attribution: ATTRIBUTION,
      });

      expect(keyConceptRepository.createKeyConcept).toHaveBeenCalledWith({
        keyConceptValue: "concept1",
        atomicFactId: TEST_IDS.atomicFactId,
        attribution: ATTRIBUTION,
      });
    });
  });
});
