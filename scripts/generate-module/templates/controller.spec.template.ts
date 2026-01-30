/**
 * Controller Test Template
 *
 * Generates comprehensive unit tests for controllers.
 */

import { TemplateData } from "../types/template-data.interface";
import {
  generateTestIdsCode,
  generateMockEntityCode,
  generateMockJsonApiResponse,
  generateMockJsonApiListResponse,
  generateMockPostDTOCode,
  generateMockPutDTOCode,
  getMANYRelationships,
  toPascalCase,
} from "../utils/test-data-generator";

/**
 * Generate controller test file content
 *
 * @param data - Template data
 * @returns Generated TypeScript test code
 */
export function generateControllerSpecFile(data: TemplateData): string {
  const { names, targetDir, fields, relationships, endpoint, nestedRoutes } = data;
  const manyRelationships = getMANYRelationships(relationships);

  // Generate test data
  const testIdsCode = generateTestIdsCode(names.pascalCase, relationships);
  const mockEntityCode = generateMockEntityCode(names.pascalCase, fields);
  const mockJsonApiResponseCode = generateMockJsonApiResponse(names.pascalCase, endpoint);
  const mockJsonApiListResponseCode = generateMockJsonApiListResponse(names.pascalCase, endpoint);
  const mockPostDTOCode = generateMockPostDTOCode(names.pascalCase, fields, endpoint);
  const mockPutDTOCode = generateMockPutDTOCode(names.pascalCase, fields, endpoint);

  // Generate nested route tests
  const nestedRouteTests = nestedRoutes
    .map(
      (route) => `
  describe("${route.methodName}", () => {
    it("should find ${names.camelCase} entities by ${route.relationshipKey}", async () => {
      ${names.camelCase}Service.findByRelated.mockResolvedValue(MOCK_JSONAPI_LIST_RESPONSE);

      await controller.${route.methodName}(
        mockReply,
        TEST_IDS.${route.relationshipKey}Id,
        {},
        undefined,
        undefined,
        undefined,
      );

      expect(${names.camelCase}Service.findByRelated).toHaveBeenCalledWith(
        expect.objectContaining({
          relationship: ${names.pascalCase}Descriptor.relationshipKeys.${route.relationshipKey},
          id: TEST_IDS.${route.relationshipKey}Id,
        }),
      );
      expect(mockReply.send).toHaveBeenCalledWith(MOCK_JSONAPI_LIST_RESPONSE);
    });
  });`
    )
    .join("\n");

  // Generate relationship endpoint tests for MANY relationships
  const relationshipEndpointTests = manyRelationships
    .map((rel) => {
      const dtoKey = rel.dtoKey || rel.key;
      const pascalDtoKey = toPascalCase(dtoKey);
      const pascalKey = toPascalCase(rel.key);

      return `
  describe("add${pascalDtoKey}", () => {
    it("should add ${rel.key} items to ${names.camelCase}", async () => {
      ${names.camelCase}Service.addToRelationshipFromDTO.mockResolvedValue(MOCK_JSONAPI_RESPONSE);

      await controller.add${pascalDtoKey}(
        mockReply,
        TEST_IDS.${names.camelCase}Id,
        {
          data: [{ id: TEST_IDS.${rel.key}Id, type: "${rel.relatedEntity.kebabCase}" }],
        },
      );

      expect(${names.camelCase}Service.addToRelationshipFromDTO).toHaveBeenCalledWith(
        expect.objectContaining({
          id: TEST_IDS.${names.camelCase}Id,
          relationship: ${names.pascalCase}Descriptor.relationshipKeys.${rel.key},
        }),
      );
      expect(mockReply.send).toHaveBeenCalledWith(MOCK_JSONAPI_RESPONSE);
    });
  });

  describe("remove${pascalDtoKey}", () => {
    it("should remove ${rel.key} items from ${names.camelCase}", async () => {
      ${names.camelCase}Service.removeFromRelationshipFromDTO.mockResolvedValue(MOCK_JSONAPI_RESPONSE);

      await controller.remove${pascalDtoKey}(
        mockReply,
        TEST_IDS.${names.camelCase}Id,
        {
          data: [{ id: TEST_IDS.${rel.key}Id, type: "${rel.relatedEntity.kebabCase}" }],
        },
      );

      expect(${names.camelCase}Service.removeFromRelationshipFromDTO).toHaveBeenCalledWith(
        expect.objectContaining({
          id: TEST_IDS.${names.camelCase}Id,
          relationship: ${names.pascalCase}Descriptor.relationshipKeys.${rel.key},
        }),
      );
      expect(mockReply.send).toHaveBeenCalledWith(MOCK_JSONAPI_RESPONSE);
    });
  });

  describe("add${pascalKey} (single)", () => {
    it("should add single ${rel.key} to ${names.camelCase}", async () => {
      ${names.camelCase}Service.addToRelationshipFromDTO.mockResolvedValue(MOCK_JSONAPI_RESPONSE);

      await controller.add${pascalKey}(
        mockReply,
        TEST_IDS.${names.camelCase}Id,
        TEST_IDS.${rel.key}Id,
        { data: {} },
      );

      expect(${names.camelCase}Service.addToRelationshipFromDTO).toHaveBeenCalled();
      expect(mockReply.send).toHaveBeenCalledWith(MOCK_JSONAPI_RESPONSE);
    });
  });

  describe("remove${pascalKey} (single)", () => {
    it("should remove single ${rel.key} from ${names.camelCase}", async () => {
      ${names.camelCase}Service.removeFromRelationshipFromDTO.mockResolvedValue(MOCK_JSONAPI_RESPONSE);

      await controller.remove${pascalKey}(
        mockReply,
        TEST_IDS.${names.camelCase}Id,
        TEST_IDS.${rel.key}Id,
      );

      expect(${names.camelCase}Service.removeFromRelationshipFromDTO).toHaveBeenCalled();
      expect(mockReply.send).toHaveBeenCalled();
    });
  });`;
    })
    .join("\n");

  return `import { vi, describe, it, expect, beforeEach, afterEach, Mocked } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { PreconditionFailedException } from "@nestjs/common";
import { ${names.pascalCase}Controller } from "./${names.kebabCase}.controller";
import { ${names.pascalCase}Service } from "../services/${names.kebabCase}.service";
import { ${names.pascalCase}Descriptor } from "../entities/${names.kebabCase}";
import { AuditService, CacheService, AuthenticatedRequest, JwtAuthGuard } from "@carlonicora/nestjs-neo4jsonapi";
import { FastifyReply } from "fastify";

describe("${names.pascalCase}Controller", () => {
  let controller: ${names.pascalCase}Controller;
  let ${names.camelCase}Service: Mocked<${names.pascalCase}Service>;
  let cacheService: Mocked<CacheService>;
  let auditService: Mocked<AuditService>;

  ${testIdsCode}

  ${mockEntityCode}

  ${mockJsonApiResponseCode}

  ${mockJsonApiListResponseCode}

  ${mockPostDTOCode}

  ${mockPutDTOCode}

  const mockRequest = {
    user: { id: TEST_IDS.userId, companyId: TEST_IDS.companyId },
  } as AuthenticatedRequest;

  const mockReply = {
    send: vi.fn(),
  } as unknown as FastifyReply;

  beforeEach(async () => {
    const mock${names.pascalCase}Service = {
      find: vi.fn(),
      findById: vi.fn(),
      create: vi.fn(),
      createFromDTO: vi.fn(),
      put: vi.fn(),
      putFromDTO: vi.fn(),
      patch: vi.fn(),
      patchFromDTO: vi.fn(),
      delete: vi.fn(),
      findByRelated: vi.fn(),
      addToRelationshipFromDTO: vi.fn(),
      removeFromRelationshipFromDTO: vi.fn(),
    };

    const mockCacheService = {
      invalidateByType: vi.fn(),
      invalidateByElement: vi.fn(),
    };

    const mockAuditService = {
      createAuditEntry: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [${names.pascalCase}Controller],
      providers: [
        {
          provide: ${names.pascalCase}Service,
          useValue: mock${names.pascalCase}Service,
        },
        {
          provide: CacheService,
          useValue: mockCacheService,
        },
        {
          provide: AuditService,
          useValue: mockAuditService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<${names.pascalCase}Controller>(${names.pascalCase}Controller);
    ${names.camelCase}Service = module.get<${names.pascalCase}Service>(
      ${names.pascalCase}Service,
    ) as Mocked<${names.pascalCase}Service>;
    cacheService = module.get<CacheService>(CacheService) as Mocked<CacheService>;
    auditService = module.get<AuditService>(AuditService) as Mocked<AuditService>;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("findAll", () => {
    it("should return a list of ${names.camelCase} entities", async () => {
      ${names.camelCase}Service.find.mockResolvedValue(MOCK_JSONAPI_LIST_RESPONSE);

      await controller.findAll(mockReply, {}, undefined, undefined, undefined);

      expect(${names.camelCase}Service.find).toHaveBeenCalledWith(
        expect.objectContaining({ query: {} }),
      );
      expect(mockReply.send).toHaveBeenCalledWith(MOCK_JSONAPI_LIST_RESPONSE);
    });

    it("should pass search term to service", async () => {
      ${names.camelCase}Service.find.mockResolvedValue(MOCK_JSONAPI_LIST_RESPONSE);

      await controller.findAll(mockReply, {}, "search-term", undefined, undefined);

      expect(${names.camelCase}Service.find).toHaveBeenCalledWith(
        expect.objectContaining({ term: "search-term" }),
      );
    });

    it("should pass orderBy to service", async () => {
      ${names.camelCase}Service.find.mockResolvedValue(MOCK_JSONAPI_LIST_RESPONSE);

      await controller.findAll(mockReply, {}, undefined, undefined, "createdAt");

      expect(${names.camelCase}Service.find).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: "createdAt" }),
      );
    });
  });

  describe("findById", () => {
    it("should return a single ${names.camelCase} entity", async () => {
      ${names.camelCase}Service.findById.mockResolvedValue(MOCK_JSONAPI_RESPONSE);
      const requestWithParams = {
        ...mockRequest,
        params: { ${names.camelCase}Id: TEST_IDS.${names.camelCase}Id },
      } as AuthenticatedRequest;

      await controller.findById(requestWithParams, mockReply, TEST_IDS.${names.camelCase}Id);

      expect(${names.camelCase}Service.findById).toHaveBeenCalledWith({ id: TEST_IDS.${names.camelCase}Id });
      expect(mockReply.send).toHaveBeenCalledWith(MOCK_JSONAPI_RESPONSE);
      expect(auditService.createAuditEntry).toHaveBeenCalled();
    });
  });

  describe("create", () => {
    it("should create a new ${names.camelCase} entity", async () => {
      ${names.camelCase}Service.createFromDTO.mockResolvedValue(MOCK_JSONAPI_RESPONSE);

      await controller.create(mockReply, MOCK_POST_DTO as any);

      expect(${names.camelCase}Service.createFromDTO).toHaveBeenCalled();
      expect(mockReply.send).toHaveBeenCalledWith(MOCK_JSONAPI_RESPONSE);
      expect(cacheService.invalidateByType).toHaveBeenCalledWith("${endpoint}");
    });
  });

  describe("update", () => {
    it("should update an existing ${names.camelCase} entity", async () => {
      ${names.camelCase}Service.putFromDTO.mockResolvedValue(MOCK_JSONAPI_RESPONSE);
      const requestWithParams = {
        ...mockRequest,
        params: { ${names.camelCase}Id: TEST_IDS.${names.camelCase}Id },
      } as AuthenticatedRequest;

      await controller.update(requestWithParams, mockReply, MOCK_PUT_DTO as any);

      expect(${names.camelCase}Service.putFromDTO).toHaveBeenCalled();
      expect(mockReply.send).toHaveBeenCalledWith(MOCK_JSONAPI_RESPONSE);
      expect(cacheService.invalidateByElement).toHaveBeenCalledWith(
        "${endpoint}",
        TEST_IDS.${names.camelCase}Id,
      );
    });

    it("should throw PreconditionFailedException when ID in URL does not match ID in body", async () => {
      const invalidDTO = {
        data: {
          ...MOCK_PUT_DTO.data,
          id: "different-id",
        },
      };
      const requestWithParams = {
        ...mockRequest,
        params: { ${names.camelCase}Id: TEST_IDS.${names.camelCase}Id },
      } as AuthenticatedRequest;

      await expect(
        controller.update(requestWithParams, mockReply, invalidDTO as any),
      ).rejects.toThrow(PreconditionFailedException);

      expect(${names.camelCase}Service.putFromDTO).not.toHaveBeenCalled();
    });
  });

  describe("delete", () => {
    it("should delete an existing ${names.camelCase} entity", async () => {
      ${names.camelCase}Service.delete.mockResolvedValue(undefined);
      const requestWithParams = {
        ...mockRequest,
        params: { ${names.camelCase}Id: TEST_IDS.${names.camelCase}Id },
      } as AuthenticatedRequest;

      await controller.delete(requestWithParams, mockReply, TEST_IDS.${names.camelCase}Id);

      expect(${names.camelCase}Service.delete).toHaveBeenCalledWith({ id: TEST_IDS.${names.camelCase}Id });
      expect(mockReply.send).toHaveBeenCalled();
      expect(cacheService.invalidateByElement).toHaveBeenCalledWith(
        "${endpoint}",
        TEST_IDS.${names.camelCase}Id,
      );
    });
  });
${nestedRouteTests}
${relationshipEndpointTests}
});
`;
}
