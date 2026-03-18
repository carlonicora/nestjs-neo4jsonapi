import { vi, describe, it, expect, beforeEach, afterEach, Mocked } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { PreconditionFailedException } from "@nestjs/common";
import { HowToController } from "./how-to.controller";
import { HowToService } from "../services/how-to.service";
import { HowToDescriptor } from "../entities/how-to";
import { AuditService, CacheService, AuthenticatedRequest, JwtAuthGuard } from "@carlonicora/nestjs-neo4jsonapi";
import { FastifyReply } from "fastify";

describe("HowToController", () => {
  let controller: HowToController;
  let howToService: Mocked<HowToService>;
  let cacheService: Mocked<CacheService>;
  let auditService: Mocked<AuditService>;

  const TEST_IDS = {
    howToId: "howto000-0001-4000-a000-0000000000001",
    companyId: "company0-0001-4000-a000-0000000000001",
    userId: "user0000-0001-4000-a000-0000000000001",
    authorId: "user0000-0001-4000-a000-0000000000001",
  };

  const MOCK_HOWTO = {
    id: TEST_IDS.howToId,
    name: "test-name",
    description: "test-description",
    pages: "test-pages",
    abstract: "test-abstract",
    tldr: "test-tldr",
    aiStatus: "test-aiStatus",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  };

  const MOCK_JSONAPI_RESPONSE = {
    data: {
      type: "howtos",
      id: TEST_IDS.howToId,
      attributes: MOCK_HOWTO,
    },
  };

  const MOCK_JSONAPI_LIST_RESPONSE = {
    data: [
      {
        type: "howtos",
        id: TEST_IDS.howToId,
        attributes: MOCK_HOWTO,
      },
    ],
    meta: {
      total: 1,
    },
  };

  const MOCK_POST_DTO = {
    data: {
      type: "howtos",
      attributes: {
        name: "test-name",
        description: "test-description",
      },
    },
  };

  const MOCK_PUT_DTO = {
    data: {
      type: "howtos",
      id: TEST_IDS.howToId,
      attributes: {
        name: "test-name",
        description: "test-description",
        pages: "test-pages",
        abstract: "test-abstract",
        tldr: "test-tldr",
        aiStatus: "test-aiStatus",
      },
    },
  };

  const mockRequest = {
    user: { id: TEST_IDS.userId, companyId: TEST_IDS.companyId },
  } as AuthenticatedRequest;

  const mockReply = {
    send: vi.fn(),
  } as unknown as FastifyReply;

  beforeEach(async () => {
    const mockHowToService = {
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
      controllers: [HowToController],
      providers: [
        {
          provide: HowToService,
          useValue: mockHowToService,
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

    controller = module.get<HowToController>(HowToController);
    howToService = module.get<HowToService>(HowToService) as Mocked<HowToService>;
    cacheService = module.get<CacheService>(CacheService) as Mocked<CacheService>;
    auditService = module.get<AuditService>(AuditService) as Mocked<AuditService>;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("findAll", () => {
    it("should return a list of howTo entities", async () => {
      howToService.find.mockResolvedValue(MOCK_JSONAPI_LIST_RESPONSE);

      await controller.findAll(mockReply, {}, undefined, undefined, undefined);

      expect(howToService.find).toHaveBeenCalledWith(expect.objectContaining({ query: {} }));
      expect(mockReply.send).toHaveBeenCalledWith(MOCK_JSONAPI_LIST_RESPONSE);
    });

    it("should pass search term to service", async () => {
      howToService.find.mockResolvedValue(MOCK_JSONAPI_LIST_RESPONSE);

      await controller.findAll(mockReply, {}, "search-term", undefined, undefined);

      expect(howToService.find).toHaveBeenCalledWith(expect.objectContaining({ term: "search-term" }));
    });

    it("should pass orderBy to service", async () => {
      howToService.find.mockResolvedValue(MOCK_JSONAPI_LIST_RESPONSE);

      await controller.findAll(mockReply, {}, undefined, undefined, "createdAt");

      expect(howToService.find).toHaveBeenCalledWith(expect.objectContaining({ orderBy: "createdAt" }));
    });
  });

  describe("findById", () => {
    it("should return a single howTo entity", async () => {
      howToService.findById.mockResolvedValue(MOCK_JSONAPI_RESPONSE);
      const requestWithParams = {
        ...mockRequest,
        params: { howToId: TEST_IDS.howToId },
      } as AuthenticatedRequest;

      await controller.findById(requestWithParams, mockReply, TEST_IDS.howToId);

      expect(howToService.findById).toHaveBeenCalledWith({ id: TEST_IDS.howToId });
      expect(mockReply.send).toHaveBeenCalledWith(MOCK_JSONAPI_RESPONSE);
      expect(auditService.createAuditEntry).toHaveBeenCalled();
    });
  });

  describe("create", () => {
    it("should create a new howTo entity", async () => {
      howToService.createFromDTO.mockResolvedValue(MOCK_JSONAPI_RESPONSE);

      await controller.create(mockReply, MOCK_POST_DTO as any);

      expect(howToService.createFromDTO).toHaveBeenCalled();
      expect(mockReply.send).toHaveBeenCalledWith(MOCK_JSONAPI_RESPONSE);
      expect(cacheService.invalidateByType).toHaveBeenCalledWith("howtos");
    });
  });

  describe("update", () => {
    it("should update an existing howTo entity", async () => {
      howToService.putFromDTO.mockResolvedValue(MOCK_JSONAPI_RESPONSE);
      const requestWithParams = {
        ...mockRequest,
        params: { howToId: TEST_IDS.howToId },
      } as AuthenticatedRequest;

      await controller.update(requestWithParams, mockReply, MOCK_PUT_DTO as any);

      expect(howToService.putFromDTO).toHaveBeenCalled();
      expect(mockReply.send).toHaveBeenCalledWith(MOCK_JSONAPI_RESPONSE);
      expect(cacheService.invalidateByElement).toHaveBeenCalledWith("howtos", TEST_IDS.howToId);
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
        params: { howToId: TEST_IDS.howToId },
      } as AuthenticatedRequest;

      await expect(controller.update(requestWithParams, mockReply, invalidDTO as any)).rejects.toThrow(
        PreconditionFailedException,
      );

      expect(howToService.putFromDTO).not.toHaveBeenCalled();
    });
  });

  describe("delete", () => {
    it("should delete an existing howTo entity", async () => {
      howToService.delete.mockResolvedValue(undefined);
      const requestWithParams = {
        ...mockRequest,
        params: { howToId: TEST_IDS.howToId },
      } as AuthenticatedRequest;

      await controller.delete(requestWithParams, mockReply, TEST_IDS.howToId);

      expect(howToService.delete).toHaveBeenCalledWith({ id: TEST_IDS.howToId });
      expect(mockReply.send).toHaveBeenCalled();
      expect(cacheService.invalidateByElement).toHaveBeenCalledWith("howtos", TEST_IDS.howToId);
    });
  });

  describe("findByAuthor", () => {
    it("should find howTo entities by author", async () => {
      howToService.findByRelated.mockResolvedValue(MOCK_JSONAPI_LIST_RESPONSE);

      await controller.findByAuthor(mockReply, TEST_IDS.authorId, {}, undefined, undefined, undefined);

      expect(howToService.findByRelated).toHaveBeenCalledWith(
        expect.objectContaining({
          relationship: HowToDescriptor.relationshipKeys.author,
          id: TEST_IDS.authorId,
        }),
      );
      expect(mockReply.send).toHaveBeenCalledWith(MOCK_JSONAPI_LIST_RESPONSE);
    });
  });
});
