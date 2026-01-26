/**
 * Service Test Template
 *
 * Generates comprehensive unit tests for services extending AbstractService.
 */

import { TemplateData } from "../types/template-data.interface";
import {
  generateTestIdsCode,
  generateMockEntityCode,
  generateMockJsonApiResponse,
  generateMockJsonApiListResponse,
  getMANYRelationships,
  toPascalCase,
} from "../utils/test-data-generator";

/**
 * Generate service test file content
 *
 * @param data - Template data
 * @returns Generated TypeScript test code
 */
export function generateServiceSpecFile(data: TemplateData): string {
  const { names, targetDir, fields, relationships, endpoint } = data;
  const manyRelationships = getMANYRelationships(relationships);

  // Generate test data
  const testIdsCode = generateTestIdsCode(names.pascalCase, relationships);
  const mockEntityCode = generateMockEntityCode(names.pascalCase, fields);
  const mockJsonApiResponseCode = generateMockJsonApiResponse(names.pascalCase, endpoint);
  const mockJsonApiListResponseCode = generateMockJsonApiListResponse(names.pascalCase, endpoint);

  // Generate findByRelated tests for each relationship
  const findByRelatedTests = relationships
    .filter((rel) => !rel.contextKey)
    .map(
      (rel) => `
  describe("findByRelated - ${rel.key}", () => {
    it("should find ${names.camelCase} entities by ${rel.key} ID", async () => {
      repository.findByRelated.mockResolvedValue({
        data: [MOCK_${names.pascalCase.toUpperCase()}],
        meta: { total: 1 },
      });
      jsonApiService.buildList.mockReturnValue(MOCK_JSONAPI_LIST_RESPONSE);

      const result = await service.findByRelated({
        relationship: ${names.pascalCase}Descriptor.relationshipKeys.${rel.key},
        id: TEST_IDS.${rel.key}Id,
        query: {},
      });

      expect(repository.findByRelated).toHaveBeenCalledWith(
        expect.objectContaining({
          relationship: ${names.pascalCase}Descriptor.relationshipKeys.${rel.key},
          id: TEST_IDS.${rel.key}Id,
        }),
      );
      expect(result).toEqual(MOCK_JSONAPI_LIST_RESPONSE);
    });

    it("should return empty list when no ${names.camelCase} entities found", async () => {
      repository.findByRelated.mockResolvedValue({
        data: [],
        meta: { total: 0 },
      });
      jsonApiService.buildList.mockReturnValue({ data: [], meta: { total: 0 } });

      const result = await service.findByRelated({
        relationship: ${names.pascalCase}Descriptor.relationshipKeys.${rel.key},
        id: TEST_IDS.${rel.key}Id,
        query: {},
      });

      expect(result).toEqual({ data: [], meta: { total: 0 } });
    });
  });`
    )
    .join("\n");

  // Generate addToRelationship tests for MANY relationships
  const addToRelationshipTests = manyRelationships
    .map(
      (rel) => `
  describe("addToRelationshipFromDTO - ${rel.key}", () => {
    it("should add ${rel.key} items to ${names.camelCase}", async () => {
      repository.addToRelationship.mockResolvedValue(undefined);
      repository.findById.mockResolvedValue(MOCK_${names.pascalCase.toUpperCase()});
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSONAPI_RESPONSE);

      const result = await service.addToRelationshipFromDTO({
        id: TEST_IDS.${names.camelCase}Id,
        relationship: ${names.pascalCase}Descriptor.relationshipKeys.${rel.key},
        data: [{ id: TEST_IDS.${rel.key}Id, type: "${rel.relatedEntity.kebabCase}" }],
      });

      expect(repository.addToRelationship).toHaveBeenCalledWith(
        expect.objectContaining({
          id: TEST_IDS.${names.camelCase}Id,
          relationship: ${names.pascalCase}Descriptor.relationshipKeys.${rel.key},
        }),
      );
      expect(result).toEqual(MOCK_JSONAPI_RESPONSE);
    });
  });`
    )
    .join("\n");

  // Generate removeFromRelationship tests for MANY relationships
  const removeFromRelationshipTests = manyRelationships
    .map(
      (rel) => `
  describe("removeFromRelationshipFromDTO - ${rel.key}", () => {
    it("should remove ${rel.key} items from ${names.camelCase}", async () => {
      repository.removeFromRelationship.mockResolvedValue(undefined);
      repository.findById.mockResolvedValue(MOCK_${names.pascalCase.toUpperCase()});
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSONAPI_RESPONSE);

      const result = await service.removeFromRelationshipFromDTO({
        id: TEST_IDS.${names.camelCase}Id,
        relationship: ${names.pascalCase}Descriptor.relationshipKeys.${rel.key},
        data: [{ id: TEST_IDS.${rel.key}Id, type: "${rel.relatedEntity.kebabCase}" }],
      });

      expect(repository.removeFromRelationship).toHaveBeenCalledWith(
        expect.objectContaining({
          id: TEST_IDS.${names.camelCase}Id,
          relationship: ${names.pascalCase}Descriptor.relationshipKeys.${rel.key},
          itemIds: [TEST_IDS.${rel.key}Id],
        }),
      );
      expect(result).toEqual(MOCK_JSONAPI_RESPONSE);
    });
  });`
    )
    .join("\n");

  return `import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ClsService } from "nestjs-cls";
import { NotFoundException, ForbiddenException } from "@nestjs/common";
import { ${names.pascalCase}Service } from "./${names.kebabCase}.service";
import { ${names.pascalCase}Repository } from "../repositories/${names.kebabCase}.repository";
import { ${names.pascalCase}Descriptor } from "../entities/${names.kebabCase}";
import { JsonApiService } from "@carlonicora/nestjs-neo4jsonapi";

describe("${names.pascalCase}Service", () => {
  let service: ${names.pascalCase}Service;
  let repository: vi.Mocked<${names.pascalCase}Repository>;
  let jsonApiService: vi.Mocked<JsonApiService>;
  let clsService: vi.Mocked<ClsService>;

  ${testIdsCode}

  ${mockEntityCode}

  ${mockJsonApiResponseCode}

  ${mockJsonApiListResponseCode}

  beforeEach(async () => {
    const mockRepository = {
      find: vi.fn(),
      findById: vi.fn(),
      create: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      findByRelated: vi.fn(),
      addToRelationship: vi.fn(),
      removeFromRelationship: vi.fn(),
    };

    const mockJsonApiService = {
      buildSingle: vi.fn(),
      buildList: vi.fn(),
    };

    const mockClsService = {
      get: vi.fn(),
      set: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ${names.pascalCase}Service,
        {
          provide: ${names.pascalCase}Repository,
          useValue: mockRepository,
        },
        {
          provide: JsonApiService,
          useValue: mockJsonApiService,
        },
        {
          provide: ClsService,
          useValue: mockClsService,
        },
      ],
    }).compile();

    service = module.get<${names.pascalCase}Service>(${names.pascalCase}Service);
    repository = module.get<${names.pascalCase}Repository>(
      ${names.pascalCase}Repository,
    ) as vi.Mocked<${names.pascalCase}Repository>;
    jsonApiService = module.get<JsonApiService>(JsonApiService) as vi.Mocked<JsonApiService>;
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

  describe("find", () => {
    it("should return a list of ${names.camelCase} entities", async () => {
      repository.find.mockResolvedValue({
        data: [MOCK_${names.pascalCase.toUpperCase()}],
        meta: { total: 1 },
      });
      jsonApiService.buildList.mockReturnValue(MOCK_JSONAPI_LIST_RESPONSE);

      const result = await service.find({ query: {} });

      expect(repository.find).toHaveBeenCalled();
      expect(jsonApiService.buildList).toHaveBeenCalled();
      expect(result).toEqual(MOCK_JSONAPI_LIST_RESPONSE);
    });

    it("should pass search term to repository", async () => {
      repository.find.mockResolvedValue({ data: [], meta: { total: 0 } });
      jsonApiService.buildList.mockReturnValue({ data: [], meta: { total: 0 } });

      await service.find({ query: {}, term: "search-term" });

      expect(repository.find).toHaveBeenCalledWith(
        expect.objectContaining({ term: "search-term" }),
      );
    });

    it("should pass orderBy to repository", async () => {
      repository.find.mockResolvedValue({ data: [], meta: { total: 0 } });
      jsonApiService.buildList.mockReturnValue({ data: [], meta: { total: 0 } });

      await service.find({ query: {}, orderBy: "createdAt" });

      expect(repository.find).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: "createdAt" }),
      );
    });
  });

  describe("findById", () => {
    it("should return a single ${names.camelCase} entity", async () => {
      repository.findById.mockResolvedValue(MOCK_${names.pascalCase.toUpperCase()});
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSONAPI_RESPONSE);

      const result = await service.findById({ id: TEST_IDS.${names.camelCase}Id });

      expect(repository.findById).toHaveBeenCalledWith({ id: TEST_IDS.${names.camelCase}Id });
      expect(jsonApiService.buildSingle).toHaveBeenCalled();
      expect(result).toEqual(MOCK_JSONAPI_RESPONSE);
    });

    it("should throw NotFoundException when entity not found", async () => {
      repository.findById.mockResolvedValue(null);
      jsonApiService.buildSingle.mockImplementation(() => {
        throw new NotFoundException();
      });

      await expect(service.findById({ id: "non-existent-id" })).rejects.toThrow(NotFoundException);
    });
  });

  describe("create", () => {
    it("should create a new ${names.camelCase} entity", async () => {
      repository.create.mockResolvedValue(undefined);
      repository.findById.mockResolvedValue(MOCK_${names.pascalCase.toUpperCase()});
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSONAPI_RESPONSE);

      const result = await service.create({
        id: TEST_IDS.${names.camelCase}Id,
      });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ id: TEST_IDS.${names.camelCase}Id }),
      );
      expect(result).toEqual(MOCK_JSONAPI_RESPONSE);
    });
  });

  describe("createFromDTO", () => {
    it("should create entity from JSON:API DTO", async () => {
      repository.create.mockResolvedValue(undefined);
      repository.findById.mockResolvedValue(MOCK_${names.pascalCase.toUpperCase()});
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSONAPI_RESPONSE);

      const result = await service.createFromDTO({
        data: {
          id: TEST_IDS.${names.camelCase}Id,
          type: "${endpoint}",
          attributes: {},
        },
      });

      expect(repository.create).toHaveBeenCalled();
      expect(result).toEqual(MOCK_JSONAPI_RESPONSE);
    });
  });

  describe("put", () => {
    it("should update an existing ${names.camelCase} entity", async () => {
      repository.put.mockResolvedValue(undefined);
      repository.findById.mockResolvedValue(MOCK_${names.pascalCase.toUpperCase()});
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSONAPI_RESPONSE);

      const result = await service.put({
        id: TEST_IDS.${names.camelCase}Id,
      });

      expect(repository.put).toHaveBeenCalledWith(
        expect.objectContaining({ id: TEST_IDS.${names.camelCase}Id }),
      );
      expect(result).toEqual(MOCK_JSONAPI_RESPONSE);
    });
  });

  describe("putFromDTO", () => {
    it("should update entity from JSON:API DTO", async () => {
      repository.put.mockResolvedValue(undefined);
      repository.findById.mockResolvedValue(MOCK_${names.pascalCase.toUpperCase()});
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSONAPI_RESPONSE);

      const result = await service.putFromDTO({
        data: {
          id: TEST_IDS.${names.camelCase}Id,
          type: "${endpoint}",
          attributes: {},
        },
      });

      expect(repository.put).toHaveBeenCalled();
      expect(result).toEqual(MOCK_JSONAPI_RESPONSE);
    });
  });

  describe("patch", () => {
    it("should partially update an existing ${names.camelCase} entity", async () => {
      repository.patch.mockResolvedValue(undefined);
      repository.findById.mockResolvedValue(MOCK_${names.pascalCase.toUpperCase()});
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSONAPI_RESPONSE);

      const result = await service.patch({
        id: TEST_IDS.${names.camelCase}Id,
      });

      expect(repository.patch).toHaveBeenCalledWith(
        expect.objectContaining({ id: TEST_IDS.${names.camelCase}Id }),
      );
      expect(result).toEqual(MOCK_JSONAPI_RESPONSE);
    });
  });

  describe("patchFromDTO", () => {
    it("should partially update entity from JSON:API DTO", async () => {
      repository.patch.mockResolvedValue(undefined);
      repository.findById.mockResolvedValue(MOCK_${names.pascalCase.toUpperCase()});
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSONAPI_RESPONSE);

      const result = await service.patchFromDTO({
        data: {
          id: TEST_IDS.${names.camelCase}Id,
          type: "${endpoint}",
          attributes: {},
        },
      });

      expect(repository.patch).toHaveBeenCalled();
      expect(result).toEqual(MOCK_JSONAPI_RESPONSE);
    });
  });

  describe("delete", () => {
    it("should delete an existing ${names.camelCase} entity", async () => {
      repository.findById.mockResolvedValue({
        ...MOCK_${names.pascalCase.toUpperCase()},
        company: { id: TEST_IDS.companyId },
      });
      repository.delete.mockResolvedValue(undefined);

      await service.delete({ id: TEST_IDS.${names.camelCase}Id });

      expect(repository.findById).toHaveBeenCalledWith({ id: TEST_IDS.${names.camelCase}Id });
      expect(repository.delete).toHaveBeenCalledWith({ id: TEST_IDS.${names.camelCase}Id });
    });

    it("should throw NotFoundException when entity does not exist", async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.delete({ id: "non-existent-id" })).rejects.toThrow(NotFoundException);
      expect(repository.delete).not.toHaveBeenCalled();
    });

    it("should throw ForbiddenException when user does not have access", async () => {
      repository.findById.mockResolvedValue({
        ...MOCK_${names.pascalCase.toUpperCase()},
        company: { id: "different-company-id" },
      });

      await expect(service.delete({ id: TEST_IDS.${names.camelCase}Id })).rejects.toThrow(ForbiddenException);
      expect(repository.delete).not.toHaveBeenCalled();
    });
  });
${findByRelatedTests}
${addToRelationshipTests}
${removeFromRelationshipTests}
});
`;
}
