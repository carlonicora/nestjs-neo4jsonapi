import { vi, describe, it, expect, beforeEach, afterEach, Mocked } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ClsService } from "nestjs-cls";
import { NotFoundException, ForbiddenException } from "@nestjs/common";
import { HowToService } from "./how-to.service";
import { HowToRepository } from "../repositories/how-to.repository";
import { HowToDescriptor } from "../entities/how-to";
import { JsonApiService } from "@carlonicora/nestjs-neo4jsonapi";

describe("HowToService", () => {
  let service: HowToService;
  let repository: Mocked<HowToRepository>;
  let jsonApiService: Mocked<JsonApiService>;
  let clsService: Mocked<ClsService>;

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
        HowToService,
        {
          provide: HowToRepository,
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

    service = module.get<HowToService>(HowToService);
    repository = module.get<HowToRepository>(HowToRepository) as Mocked<HowToRepository>;
    jsonApiService = module.get<JsonApiService>(JsonApiService) as Mocked<JsonApiService>;
    clsService = module.get<ClsService>(ClsService) as Mocked<ClsService>;

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
    it("should return a list of howTo entities", async () => {
      repository.find.mockResolvedValue({
        data: [MOCK_HOWTO],
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

      expect(repository.find).toHaveBeenCalledWith(expect.objectContaining({ term: "search-term" }));
    });

    it("should pass orderBy to repository", async () => {
      repository.find.mockResolvedValue({ data: [], meta: { total: 0 } });
      jsonApiService.buildList.mockReturnValue({ data: [], meta: { total: 0 } });

      await service.find({ query: {}, orderBy: "createdAt" });

      expect(repository.find).toHaveBeenCalledWith(expect.objectContaining({ orderBy: "createdAt" }));
    });
  });

  describe("findById", () => {
    it("should return a single howTo entity", async () => {
      repository.findById.mockResolvedValue(MOCK_HOWTO);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSONAPI_RESPONSE);

      const result = await service.findById({ id: TEST_IDS.howToId });

      expect(repository.findById).toHaveBeenCalledWith({ id: TEST_IDS.howToId });
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
    it("should create a new howTo entity", async () => {
      repository.create.mockResolvedValue(undefined);
      repository.findById.mockResolvedValue(MOCK_HOWTO);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSONAPI_RESPONSE);

      const result = await service.create({
        id: TEST_IDS.howToId,
      });

      expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ id: TEST_IDS.howToId }));
      expect(result).toEqual(MOCK_JSONAPI_RESPONSE);
    });
  });

  describe("createFromDTO", () => {
    it("should create entity from JSON:API DTO", async () => {
      repository.create.mockResolvedValue(undefined);
      repository.findById.mockResolvedValue(MOCK_HOWTO);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSONAPI_RESPONSE);

      const result = await service.createFromDTO({
        data: {
          id: TEST_IDS.howToId,
          type: "howtos",
          attributes: {},
        },
      });

      expect(repository.create).toHaveBeenCalled();
      expect(result).toEqual(MOCK_JSONAPI_RESPONSE);
    });
  });

  describe("put", () => {
    it("should update an existing howTo entity", async () => {
      repository.put.mockResolvedValue(undefined);
      repository.findById.mockResolvedValue(MOCK_HOWTO);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSONAPI_RESPONSE);

      const result = await service.put({
        id: TEST_IDS.howToId,
      });

      expect(repository.put).toHaveBeenCalledWith(expect.objectContaining({ id: TEST_IDS.howToId }));
      expect(result).toEqual(MOCK_JSONAPI_RESPONSE);
    });
  });

  describe("putFromDTO", () => {
    it("should update entity from JSON:API DTO", async () => {
      repository.put.mockResolvedValue(undefined);
      repository.findById.mockResolvedValue(MOCK_HOWTO);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSONAPI_RESPONSE);

      const result = await service.putFromDTO({
        data: {
          id: TEST_IDS.howToId,
          type: "howtos",
          attributes: {},
        },
      });

      expect(repository.put).toHaveBeenCalled();
      expect(result).toEqual(MOCK_JSONAPI_RESPONSE);
    });
  });

  describe("patch", () => {
    it("should partially update an existing howTo entity", async () => {
      repository.patch.mockResolvedValue(undefined);
      repository.findById.mockResolvedValue(MOCK_HOWTO);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSONAPI_RESPONSE);

      const result = await service.patch({
        id: TEST_IDS.howToId,
      });

      expect(repository.patch).toHaveBeenCalledWith(expect.objectContaining({ id: TEST_IDS.howToId }));
      expect(result).toEqual(MOCK_JSONAPI_RESPONSE);
    });
  });

  describe("patchFromDTO", () => {
    it("should partially update entity from JSON:API DTO", async () => {
      repository.patch.mockResolvedValue(undefined);
      repository.findById.mockResolvedValue(MOCK_HOWTO);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSONAPI_RESPONSE);

      const result = await service.patchFromDTO({
        data: {
          id: TEST_IDS.howToId,
          type: "howtos",
          attributes: {},
        },
      });

      expect(repository.patch).toHaveBeenCalled();
      expect(result).toEqual(MOCK_JSONAPI_RESPONSE);
    });
  });

  describe("delete", () => {
    it("should delete an existing howTo entity", async () => {
      repository.findById.mockResolvedValue({
        ...MOCK_HOWTO,
        company: { id: TEST_IDS.companyId },
      });
      repository.delete.mockResolvedValue(undefined);

      await service.delete({ id: TEST_IDS.howToId });

      expect(repository.findById).toHaveBeenCalledWith({ id: TEST_IDS.howToId });
      expect(repository.delete).toHaveBeenCalledWith({ id: TEST_IDS.howToId });
    });

    it("should throw NotFoundException when entity does not exist", async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.delete({ id: "non-existent-id" })).rejects.toThrow(NotFoundException);
      expect(repository.delete).not.toHaveBeenCalled();
    });

    it("should throw ForbiddenException when user does not have access", async () => {
      repository.findById.mockResolvedValue({
        ...MOCK_HOWTO,
        company: { id: "different-company-id" },
      });

      await expect(service.delete({ id: TEST_IDS.howToId })).rejects.toThrow(ForbiddenException);
      expect(repository.delete).not.toHaveBeenCalled();
    });
  });

  describe("findByRelated - author", () => {
    it("should find howTo entities by author ID", async () => {
      repository.findByRelated.mockResolvedValue({
        data: [MOCK_HOWTO],
        meta: { total: 1 },
      });
      jsonApiService.buildList.mockReturnValue(MOCK_JSONAPI_LIST_RESPONSE);

      const result = await service.findByRelated({
        relationship: HowToDescriptor.relationshipKeys.author,
        id: TEST_IDS.authorId,
        query: {},
      });

      expect(repository.findByRelated).toHaveBeenCalledWith(
        expect.objectContaining({
          relationship: HowToDescriptor.relationshipKeys.author,
          id: TEST_IDS.authorId,
        }),
      );
      expect(result).toEqual(MOCK_JSONAPI_LIST_RESPONSE);
    });

    it("should return empty list when no howTo entities found", async () => {
      repository.findByRelated.mockResolvedValue({
        data: [],
        meta: { total: 0 },
      });
      jsonApiService.buildList.mockReturnValue({ data: [], meta: { total: 0 } });

      const result = await service.findByRelated({
        relationship: HowToDescriptor.relationshipKeys.author,
        id: TEST_IDS.authorId,
        query: {},
      });

      expect(result).toEqual({ data: [], meta: { total: 0 } });
    });
  });
});
