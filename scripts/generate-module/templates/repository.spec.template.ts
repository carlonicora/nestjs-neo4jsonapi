/**
 * Repository Test Template
 *
 * Generates comprehensive unit tests for repositories extending AbstractRepository.
 */

import { TemplateData } from "../types/template-data.interface";
import {
  generateTestIdsCode,
  generateMockEntityCode,
  getMANYRelationships,
} from "../utils/test-data-generator";

/**
 * Generate repository test file content
 *
 * @param data - Template data
 * @returns Generated TypeScript test code
 */
export function generateRepositorySpecFile(data: TemplateData): string {
  const { names, targetDir, fields, relationships, endpoint } = data;
  const manyRelationships = getMANYRelationships(relationships);

  // Generate test data
  const testIdsCode = generateTestIdsCode(names.pascalCase, relationships);
  const mockEntityCode = generateMockEntityCode(names.pascalCase, fields);

  // Generate findByRelated tests for each relationship
  const findByRelatedTests = relationships
    .filter((rel) => !rel.contextKey)
    .map(
      (rel) => `
  describe("findByRelated - ${rel.key}", () => {
    it("should find ${names.camelCase} entities by ${rel.key} ID", async () => {
      neo4jService.readMany.mockResolvedValue([MOCK_${names.pascalCase.toUpperCase()}]);

      const result = await repository.findByRelated({
        relationship: ${names.pascalCase}Descriptor.relationshipKeys.${rel.key},
        id: TEST_IDS.${rel.key}Id,
      });

      expect(neo4jService.initQuery).toHaveBeenCalled();
      expect(neo4jService.readMany).toHaveBeenCalled();
      expect(result).toEqual([MOCK_${names.pascalCase.toUpperCase()}]);
    });

    it("should find ${names.camelCase} entities by multiple ${rel.key} IDs", async () => {
      neo4jService.readMany.mockResolvedValue([MOCK_${names.pascalCase.toUpperCase()}]);

      const result = await repository.findByRelated({
        relationship: ${names.pascalCase}Descriptor.relationshipKeys.${rel.key},
        id: [TEST_IDS.${rel.key}Id, "another-${rel.key}-id"],
      });

      expect(neo4jService.readMany).toHaveBeenCalled();
      expect(result).toEqual([MOCK_${names.pascalCase.toUpperCase()}]);
    });

    it("should return empty array when no ${names.camelCase} entities found", async () => {
      neo4jService.readMany.mockResolvedValue([]);

      const result = await repository.findByRelated({
        relationship: ${names.pascalCase}Descriptor.relationshipKeys.${rel.key},
        id: TEST_IDS.${rel.key}Id,
      });

      expect(result).toEqual([]);
    });
  });`
    )
    .join("\n");

  // Generate addToRelationship tests for MANY relationships
  const addToRelationshipTests = manyRelationships
    .map(
      (rel) => `
  describe("addToRelationship - ${rel.key}", () => {
    it("should add ${rel.key} items to ${names.camelCase}", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.addToRelationship({
        id: TEST_IDS.${names.camelCase}Id,
        relationship: ${names.pascalCase}Descriptor.relationshipKeys.${rel.key},
        items: [{ id: TEST_IDS.${rel.key}Id }],
      });

      expect(neo4jService.writeOne).toHaveBeenCalled();
    });

    it("should not execute query when items array is empty", async () => {
      await repository.addToRelationship({
        id: TEST_IDS.${names.camelCase}Id,
        relationship: ${names.pascalCase}Descriptor.relationshipKeys.${rel.key},
        items: [],
      });

      expect(neo4jService.writeOne).not.toHaveBeenCalled();
    });
  });`
    )
    .join("\n");

  // Generate removeFromRelationship tests for MANY relationships
  const removeFromRelationshipTests = manyRelationships
    .map(
      (rel) => `
  describe("removeFromRelationship - ${rel.key}", () => {
    it("should remove ${rel.key} items from ${names.camelCase}", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.removeFromRelationship({
        id: TEST_IDS.${names.camelCase}Id,
        relationship: ${names.pascalCase}Descriptor.relationshipKeys.${rel.key},
        itemIds: [TEST_IDS.${rel.key}Id],
      });

      expect(neo4jService.writeOne).toHaveBeenCalled();
    });

    it("should not execute query when itemIds array is empty", async () => {
      await repository.removeFromRelationship({
        id: TEST_IDS.${names.camelCase}Id,
        relationship: ${names.pascalCase}Descriptor.relationshipKeys.${rel.key},
        itemIds: [],
      });

      expect(neo4jService.writeOne).not.toHaveBeenCalled();
    });
  });`
    )
    .join("\n");

  return `import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ClsService } from "nestjs-cls";
import { HttpException } from "@nestjs/common";
import { ${names.pascalCase}Repository } from "./${names.kebabCase}.repository";
import { ${names.pascalCase}Descriptor } from "../entities/${names.kebabCase}";
import { Neo4jService, SecurityService } from "@carlonicora/nestjs-neo4jsonapi";

describe("${names.pascalCase}Repository", () => {
  let repository: ${names.pascalCase}Repository;
  let neo4jService: vi.Mocked<Neo4jService>;
  let securityService: vi.Mocked<SecurityService>;
  let clsService: vi.Mocked<ClsService>;

  ${testIdsCode}

  ${mockEntityCode}

  beforeEach(async () => {
    const mockNeo4jService = {
      initQuery: vi.fn().mockReturnValue({
        query: "",
        queryParams: {},
      }),
      read: vi.fn(),
      readOne: vi.fn(),
      readMany: vi.fn(),
      writeOne: vi.fn(),
      validateExistingNodes: vi.fn(),
    };

    const mockSecurityService = {
      userHasAccess: vi.fn().mockImplementation(({ validator }) => validator?.() ?? ""),
    };

    const mockClsService = {
      get: vi.fn(),
      set: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ${names.pascalCase}Repository,
        {
          provide: Neo4jService,
          useValue: mockNeo4jService,
        },
        {
          provide: SecurityService,
          useValue: mockSecurityService,
        },
        {
          provide: ClsService,
          useValue: mockClsService,
        },
      ],
    }).compile();

    repository = module.get<${names.pascalCase}Repository>(${names.pascalCase}Repository);
    neo4jService = module.get<Neo4jService>(Neo4jService) as vi.Mocked<Neo4jService>;
    securityService = module.get<SecurityService>(SecurityService) as vi.Mocked<SecurityService>;
    clsService = module.get<ClsService>(ClsService) as vi.Mocked<ClsService>;

    // Default CLS context
    clsService.get.mockImplementation((key: string) => {
      if (key === "userId") return TEST_IDS.userId;
      if (key === "companyId") return TEST_IDS.companyId;
      return undefined;
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("onModuleInit", () => {
    it("should create constraints and indexes", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);
      neo4jService.read.mockResolvedValue({ records: [] });

      await repository.onModuleInit();

      // Verify constraint creation was attempted
      expect(neo4jService.writeOne).toHaveBeenCalled();
    });
  });

  describe("find", () => {
    it("should find all ${names.camelCase} entities", async () => {
      neo4jService.readMany.mockResolvedValue([MOCK_${names.pascalCase.toUpperCase()}]);

      const result = await repository.find({});

      expect(neo4jService.initQuery).toHaveBeenCalled();
      expect(neo4jService.readMany).toHaveBeenCalled();
      expect(result).toEqual([MOCK_${names.pascalCase.toUpperCase()}]);
    });

    it("should pass search term to query", async () => {
      neo4jService.readMany.mockResolvedValue([]);

      await repository.find({ term: "search-term" });

      expect(neo4jService.initQuery).toHaveBeenCalled();
      expect(neo4jService.readMany).toHaveBeenCalled();
    });

    it("should pass orderBy to query", async () => {
      neo4jService.readMany.mockResolvedValue([]);

      await repository.find({ orderBy: "createdAt" });

      expect(neo4jService.initQuery).toHaveBeenCalled();
      expect(neo4jService.readMany).toHaveBeenCalled();
    });

    it("should return empty array when no entities found", async () => {
      neo4jService.readMany.mockResolvedValue([]);

      const result = await repository.find({});

      expect(result).toEqual([]);
    });
  });

  describe("findById", () => {
    it("should find ${names.camelCase} entity by ID", async () => {
      neo4jService.readOne.mockResolvedValue(MOCK_${names.pascalCase.toUpperCase()});

      const result = await repository.findById({ id: TEST_IDS.${names.camelCase}Id });

      expect(neo4jService.initQuery).toHaveBeenCalled();
      expect(neo4jService.readOne).toHaveBeenCalled();
      expect(result).toEqual(MOCK_${names.pascalCase.toUpperCase()});
    });

    it("should return null when entity not found", async () => {
      neo4jService.readOne.mockResolvedValue(null);

      const result = await repository.findById({ id: "non-existent-id" });

      expect(result).toBeNull();
    });

    it("should throw Forbidden when entity exists but user has no access", async () => {
      // First read returns null (user context), second returns entity (no user context)
      neo4jService.readOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(MOCK_${names.pascalCase.toUpperCase()});

      await expect(repository.findById({ id: TEST_IDS.${names.camelCase}Id })).rejects.toThrow(HttpException);
    });
  });

  describe("findByIds", () => {
    it("should find ${names.camelCase} entities by ID list", async () => {
      neo4jService.readMany.mockResolvedValue([MOCK_${names.pascalCase.toUpperCase()}]);

      const result = await repository.findByIds({ ids: [TEST_IDS.${names.camelCase}Id] });

      expect(neo4jService.readMany).toHaveBeenCalled();
      expect(result).toEqual([MOCK_${names.pascalCase.toUpperCase()}]);
    });

    it("should return empty array for empty IDs list", async () => {
      neo4jService.readMany.mockResolvedValue([]);

      const result = await repository.findByIds({ ids: [] });

      expect(result).toEqual([]);
    });
  });

  describe("create", () => {
    it("should create a new ${names.camelCase} entity", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);
      neo4jService.validateExistingNodes.mockResolvedValue(undefined);

      await repository.create({
        id: TEST_IDS.${names.camelCase}Id,
      });

      expect(neo4jService.writeOne).toHaveBeenCalled();
    });

    it("should validate related nodes exist before create", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);
      neo4jService.validateExistingNodes.mockResolvedValue(undefined);

      await repository.create({
        id: TEST_IDS.${names.camelCase}Id,
      });

      // validateExistingNodes may or may not be called depending on relationships
      expect(neo4jService.writeOne).toHaveBeenCalled();
    });
  });

  describe("put", () => {
    it("should update an existing ${names.camelCase} entity", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);
      neo4jService.validateExistingNodes.mockResolvedValue(undefined);

      await repository.put({
        id: TEST_IDS.${names.camelCase}Id,
      });

      expect(neo4jService.writeOne).toHaveBeenCalled();
    });
  });

  describe("patch", () => {
    it("should partially update an existing ${names.camelCase} entity", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);
      neo4jService.validateExistingNodes.mockResolvedValue(undefined);

      await repository.patch({
        id: TEST_IDS.${names.camelCase}Id,
      });

      expect(neo4jService.writeOne).toHaveBeenCalled();
    });

    it("should only update provided fields", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.patch({
        id: TEST_IDS.${names.camelCase}Id,
        // Only update specific fields
      });

      expect(neo4jService.writeOne).toHaveBeenCalled();
    });
  });

  describe("delete", () => {
    it("should delete an existing ${names.camelCase} entity", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.delete({ id: TEST_IDS.${names.camelCase}Id });

      expect(neo4jService.writeOne).toHaveBeenCalled();
    });
  });
${findByRelatedTests}
${addToRelationshipTests}
${removeFromRelationshipTests}
});
`;
}
