import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Mock guards before imports
vi.mock("../../../common/guards/jwt.auth.guard", () => ({
  JwtAuthGuard: class MockJwtAuthGuard {
    canActivate = vi.fn().mockReturnValue(true);
  },
}));

// Mock contentMeta and user metas used in controller decorator
vi.mock("../entities/content.meta", () => ({
  contentMeta: {
    type: "contents",
    endpoint: "contents",
    nodeName: "content",
    labelName: "Content",
  },
}));

vi.mock("../../user/entities/user.meta", () => ({
  userMeta: {
    type: "users",
    endpoint: "users",
    nodeName: "user",
    labelName: "User",
  },
  ownerMeta: {
    type: "users",
    endpoint: "owners",
    nodeName: "owner",
    labelName: "User",
  },
  authorMeta: {
    type: "users",
    endpoint: "authors",
    nodeName: "author",
    labelName: "User",
  },
  assigneeMeta: {
    type: "users",
    endpoint: "assignees",
    nodeName: "assignee",
    labelName: "User",
  },
}));

// Mock content service to avoid complex dependency chain
vi.mock("../services/content.service", () => ({
  ContentService: vi.fn().mockImplementation(() => ({
    find: vi.fn(),
    findByIds: vi.fn(),
    findByOwner: vi.fn(),
  })),
}));

// Mock content cypher service
vi.mock("../services/content.cypher.service", () => ({
  ContentCypherService: vi.fn().mockImplementation(() => ({})),
}));

// Mock relevancy service
vi.mock("../../relevancy/services/relevancy.service", () => ({
  RelevancyService: vi.fn().mockImplementation(() => ({
    findRelevant: vi.fn(),
  })),
}));

// Mock ContentModel
vi.mock("../entities/content.model", () => ({
  ContentModel: {
    meta: {
      type: "contents",
      endpoint: "contents",
      nodeName: "content",
      labelName: "Content",
    },
  },
}));

import { Test, TestingModule } from "@nestjs/testing";
import { FastifyReply } from "fastify";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { AuthenticatedRequest } from "../../../common/interfaces/authenticated.request.interface";
import { JsonApiDataInterface } from "../../../core/jsonapi/interfaces/jsonapi.data.interface";
import { ContentModel } from "../entities/content.model";
import { ContentCypherService } from "../services/content.cypher.service";
import { ContentService } from "../services/content.service";
import { RelevancyService } from "../../relevancy/services/relevancy.service";
import { ContentController } from "./content.controller";

describe("ContentController", () => {
  let controller: ContentController;
  let contentService: vi.Mocked<ContentService>;
  let relevancyService: vi.Mocked<RelevancyService<any>>;
  let cypherService: vi.Mocked<ContentCypherService>;
  let mockReply: vi.Mocked<FastifyReply>;

  // Test data constants
  const MOCK_CONTENT_ID = "550e8400-e29b-41d4-a716-446655440000";
  const MOCK_CONTENT_ID_2 = "550e8400-e29b-41d4-a716-446655440001";
  const MOCK_USER_ID = "660e8400-e29b-41d4-a716-446655440002";
  const MOCK_COMPANY_ID = "770e8400-e29b-41d4-a716-446655440003";
  const MOCK_OWNER_ID = "880e8400-e29b-41d4-a716-446655440004";
  const MOCK_AUTHOR_ID = "990e8400-e29b-41d4-a716-446655440005";

  const mockUser = {
    userId: MOCK_USER_ID,
    companyId: MOCK_COMPANY_ID,
    roles: [],
    language: "en",
  };

  const mockServiceResponse: JsonApiDataInterface = {
    type: "contents",
    id: MOCK_CONTENT_ID,
    attributes: {
      title: "Test Content",
      description: "A test content item",
    },
  };

  const mockListResponse = {
    data: [mockServiceResponse],
    meta: { total: 1 },
  };

  beforeEach(async () => {
    const mockContentService = {
      find: vi.fn(),
      findByIds: vi.fn(),
      findByOwner: vi.fn(),
    };

    const mockRelevancyService = {
      findRelevant: vi.fn(),
    };

    const mockCypherService = {};

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ContentController],
      providers: [
        { provide: ContentService, useValue: mockContentService },
        { provide: RelevancyService, useValue: mockRelevancyService },
        { provide: ContentCypherService, useValue: mockCypherService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ContentController>(ContentController);
    contentService = module.get(ContentService);
    relevancyService = module.get(RelevancyService);
    cypherService = module.get(ContentCypherService);

    // Mock FastifyReply
    mockReply = {
      send: vi.fn(),
    } as any;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("findContents", () => {
    const mockRequest = { user: mockUser } as AuthenticatedRequest;
    const mockQuery = { page: { number: 1, size: 10 } };

    describe("when contentIds parameter is provided", () => {
      it("should fetch contents by IDs", async () => {
        const contentIds = `${MOCK_CONTENT_ID},${MOCK_CONTENT_ID_2}`;
        contentService.findByIds.mockResolvedValue(mockListResponse);

        await controller.findContents(mockRequest, mockReply, mockQuery, undefined, undefined, undefined, contentIds);

        expect(contentService.findByIds).toHaveBeenCalledWith({
          contentIds: [MOCK_CONTENT_ID, MOCK_CONTENT_ID_2],
        });
        expect(mockReply.send).toHaveBeenCalledWith(mockListResponse);
      });

      it("should handle single contentId", async () => {
        contentService.findByIds.mockResolvedValue(mockServiceResponse);

        await controller.findContents(
          mockRequest,
          mockReply,
          mockQuery,
          undefined,
          undefined,
          undefined,
          MOCK_CONTENT_ID,
        );

        expect(contentService.findByIds).toHaveBeenCalledWith({
          contentIds: [MOCK_CONTENT_ID],
        });
        expect(mockReply.send).toHaveBeenCalledWith(mockServiceResponse);
      });
    });

    describe("when contentIds parameter is NOT provided", () => {
      it("should fetch contents with search term and query parameters", async () => {
        const search = "test search";
        contentService.find.mockResolvedValue(mockListResponse);

        await controller.findContents(mockRequest, mockReply, mockQuery, search);

        expect(contentService.find).toHaveBeenCalledWith({
          term: search,
          query: mockQuery,
          fetchAll: undefined,
          orderBy: undefined,
        });
        expect(mockReply.send).toHaveBeenCalledWith(mockListResponse);
      });

      it("should fetch contents with fetchAll parameter", async () => {
        contentService.find.mockResolvedValue(mockListResponse);

        await controller.findContents(mockRequest, mockReply, mockQuery, undefined, true);

        expect(contentService.find).toHaveBeenCalledWith({
          term: undefined,
          query: mockQuery,
          fetchAll: true,
          orderBy: undefined,
        });
        expect(mockReply.send).toHaveBeenCalledWith(mockListResponse);
      });

      it("should fetch contents with orderBy parameter", async () => {
        const orderBy = "createdAt";
        contentService.find.mockResolvedValue(mockListResponse);

        await controller.findContents(mockRequest, mockReply, mockQuery, undefined, undefined, orderBy);

        expect(contentService.find).toHaveBeenCalledWith({
          term: undefined,
          query: mockQuery,
          fetchAll: undefined,
          orderBy: orderBy,
        });
        expect(mockReply.send).toHaveBeenCalledWith(mockListResponse);
      });

      it("should fetch contents with all parameters", async () => {
        const search = "test search";
        const fetchAll = true;
        const orderBy = "title";
        contentService.find.mockResolvedValue(mockListResponse);

        await controller.findContents(mockRequest, mockReply, mockQuery, search, fetchAll, orderBy);

        expect(contentService.find).toHaveBeenCalledWith({
          term: search,
          query: mockQuery,
          fetchAll: fetchAll,
          orderBy: orderBy,
        });
        expect(mockReply.send).toHaveBeenCalledWith(mockListResponse);
      });

      it("should fetch contents with empty query", async () => {
        const emptyQuery = {};
        contentService.find.mockResolvedValue(mockListResponse);

        await controller.findContents(mockRequest, mockReply, emptyQuery);

        expect(contentService.find).toHaveBeenCalledWith({
          term: undefined,
          query: emptyQuery,
          fetchAll: undefined,
          orderBy: undefined,
        });
        expect(mockReply.send).toHaveBeenCalledWith(mockListResponse);
      });
    });

    describe("error handling", () => {
      it("should handle service errors when finding by IDs", async () => {
        const serviceError = new Error("Service error");
        contentService.findByIds.mockRejectedValue(serviceError);

        await expect(
          controller.findContents(mockRequest, mockReply, mockQuery, undefined, undefined, undefined, MOCK_CONTENT_ID),
        ).rejects.toThrow("Service error");

        expect(contentService.findByIds).toHaveBeenCalled();
        expect(mockReply.send).not.toHaveBeenCalled();
      });

      it("should handle service errors when finding with search", async () => {
        const serviceError = new Error("Service error");
        contentService.find.mockRejectedValue(serviceError);

        await expect(controller.findContents(mockRequest, mockReply, mockQuery)).rejects.toThrow("Service error");

        expect(contentService.find).toHaveBeenCalled();
        expect(mockReply.send).not.toHaveBeenCalled();
      });
    });
  });

  describe("findByOwner", () => {
    const mockRequest = { user: mockUser } as AuthenticatedRequest;
    const mockQuery = { page: { number: 1, size: 10 } };

    it("should fetch contents by owner ID", async () => {
      contentService.findByOwner.mockResolvedValue(mockListResponse);

      await controller.findByOwner(mockRequest, mockReply, MOCK_OWNER_ID, mockQuery);

      expect(contentService.findByOwner).toHaveBeenCalledWith({
        ownerId: MOCK_OWNER_ID,
        term: undefined,
        query: mockQuery,
        fetchAll: undefined,
        orderBy: undefined,
      });
      expect(mockReply.send).toHaveBeenCalledWith(mockListResponse);
    });

    it("should fetch contents by owner with search term", async () => {
      const search = "test search";
      contentService.findByOwner.mockResolvedValue(mockListResponse);

      await controller.findByOwner(mockRequest, mockReply, MOCK_OWNER_ID, mockQuery, search);

      expect(contentService.findByOwner).toHaveBeenCalledWith({
        ownerId: MOCK_OWNER_ID,
        term: search,
        query: mockQuery,
        fetchAll: undefined,
        orderBy: undefined,
      });
      expect(mockReply.send).toHaveBeenCalledWith(mockListResponse);
    });

    it("should fetch contents by owner with fetchAll parameter", async () => {
      contentService.findByOwner.mockResolvedValue(mockListResponse);

      await controller.findByOwner(mockRequest, mockReply, MOCK_OWNER_ID, mockQuery, undefined, true);

      expect(contentService.findByOwner).toHaveBeenCalledWith({
        ownerId: MOCK_OWNER_ID,
        term: undefined,
        query: mockQuery,
        fetchAll: true,
        orderBy: undefined,
      });
      expect(mockReply.send).toHaveBeenCalledWith(mockListResponse);
    });

    it("should fetch contents by owner with orderBy parameter", async () => {
      const orderBy = "title";
      contentService.findByOwner.mockResolvedValue(mockListResponse);

      await controller.findByOwner(mockRequest, mockReply, MOCK_OWNER_ID, mockQuery, undefined, undefined, orderBy);

      expect(contentService.findByOwner).toHaveBeenCalledWith({
        ownerId: MOCK_OWNER_ID,
        term: undefined,
        query: mockQuery,
        fetchAll: undefined,
        orderBy: orderBy,
      });
      expect(mockReply.send).toHaveBeenCalledWith(mockListResponse);
    });

    it("should fetch contents by owner with all parameters", async () => {
      const search = "test search";
      const fetchAll = true;
      const orderBy = "createdAt";
      contentService.findByOwner.mockResolvedValue(mockListResponse);

      await controller.findByOwner(mockRequest, mockReply, MOCK_OWNER_ID, mockQuery, search, fetchAll, orderBy);

      expect(contentService.findByOwner).toHaveBeenCalledWith({
        ownerId: MOCK_OWNER_ID,
        term: search,
        query: mockQuery,
        fetchAll: fetchAll,
        orderBy: orderBy,
      });
      expect(mockReply.send).toHaveBeenCalledWith(mockListResponse);
    });

    it("should handle service errors", async () => {
      const serviceError = new Error("Service error");
      contentService.findByOwner.mockRejectedValue(serviceError);

      await expect(controller.findByOwner(mockRequest, mockReply, MOCK_OWNER_ID, mockQuery)).rejects.toThrow(
        "Service error",
      );

      expect(contentService.findByOwner).toHaveBeenCalled();
      expect(mockReply.send).not.toHaveBeenCalled();
    });
  });

  describe("findByAuthor", () => {
    const mockRequest = { user: mockUser } as AuthenticatedRequest;
    const mockQuery = { page: { number: 1, size: 10 } };

    it("should fetch contents by author ID (uses findByOwner internally)", async () => {
      contentService.findByOwner.mockResolvedValue(mockListResponse);

      await controller.findByAuthor(mockRequest, mockReply, MOCK_AUTHOR_ID, mockQuery);

      expect(contentService.findByOwner).toHaveBeenCalledWith({
        ownerId: MOCK_AUTHOR_ID,
        term: undefined,
        query: mockQuery,
        fetchAll: undefined,
        orderBy: undefined,
      });
      expect(mockReply.send).toHaveBeenCalledWith(mockListResponse);
    });

    it("should fetch contents by author with search term", async () => {
      const search = "test search";
      contentService.findByOwner.mockResolvedValue(mockListResponse);

      await controller.findByAuthor(mockRequest, mockReply, MOCK_AUTHOR_ID, mockQuery, search);

      expect(contentService.findByOwner).toHaveBeenCalledWith({
        ownerId: MOCK_AUTHOR_ID,
        term: search,
        query: mockQuery,
        fetchAll: undefined,
        orderBy: undefined,
      });
      expect(mockReply.send).toHaveBeenCalledWith(mockListResponse);
    });

    it("should fetch contents by author with fetchAll parameter", async () => {
      contentService.findByOwner.mockResolvedValue(mockListResponse);

      await controller.findByAuthor(mockRequest, mockReply, MOCK_AUTHOR_ID, mockQuery, undefined, true);

      expect(contentService.findByOwner).toHaveBeenCalledWith({
        ownerId: MOCK_AUTHOR_ID,
        term: undefined,
        query: mockQuery,
        fetchAll: true,
        orderBy: undefined,
      });
      expect(mockReply.send).toHaveBeenCalledWith(mockListResponse);
    });

    it("should fetch contents by author with orderBy parameter", async () => {
      const orderBy = "title";
      contentService.findByOwner.mockResolvedValue(mockListResponse);

      await controller.findByAuthor(mockRequest, mockReply, MOCK_AUTHOR_ID, mockQuery, undefined, undefined, orderBy);

      expect(contentService.findByOwner).toHaveBeenCalledWith({
        ownerId: MOCK_AUTHOR_ID,
        term: undefined,
        query: mockQuery,
        fetchAll: undefined,
        orderBy: orderBy,
      });
      expect(mockReply.send).toHaveBeenCalledWith(mockListResponse);
    });

    it("should fetch contents by author with all parameters", async () => {
      const search = "test search";
      const fetchAll = true;
      const orderBy = "createdAt";
      contentService.findByOwner.mockResolvedValue(mockListResponse);

      await controller.findByAuthor(mockRequest, mockReply, MOCK_AUTHOR_ID, mockQuery, search, fetchAll, orderBy);

      expect(contentService.findByOwner).toHaveBeenCalledWith({
        ownerId: MOCK_AUTHOR_ID,
        term: search,
        query: mockQuery,
        fetchAll: fetchAll,
        orderBy: orderBy,
      });
      expect(mockReply.send).toHaveBeenCalledWith(mockListResponse);
    });

    it("should handle service errors", async () => {
      const serviceError = new Error("Service error");
      contentService.findByOwner.mockRejectedValue(serviceError);

      await expect(controller.findByAuthor(mockRequest, mockReply, MOCK_AUTHOR_ID, mockQuery)).rejects.toThrow(
        "Service error",
      );

      expect(contentService.findByOwner).toHaveBeenCalled();
      expect(mockReply.send).not.toHaveBeenCalled();
    });
  });

  describe("findContentsRelevantForContent", () => {
    const mockQuery = { page: { number: 1, size: 10 } };
    const mockRelevantContents = {
      data: [mockServiceResponse],
      meta: { total: 1 },
    };

    it("should find relevant contents for a content ID", async () => {
      relevancyService.findRelevant.mockResolvedValue(mockRelevantContents);

      const result = await controller.findContentsRelevantForContent(mockQuery, MOCK_CONTENT_ID);

      expect(relevancyService.findRelevant).toHaveBeenCalledWith({
        model: ContentModel,
        cypherService: cypherService,
        id: MOCK_CONTENT_ID,
        query: mockQuery,
      });
      expect(result).toEqual(mockRelevantContents);
    });

    it("should handle empty query parameters", async () => {
      const emptyQuery = {};
      relevancyService.findRelevant.mockResolvedValue(mockRelevantContents);

      const result = await controller.findContentsRelevantForContent(emptyQuery, MOCK_CONTENT_ID);

      expect(relevancyService.findRelevant).toHaveBeenCalledWith({
        model: ContentModel,
        cypherService: cypherService,
        id: MOCK_CONTENT_ID,
        query: emptyQuery,
      });
      expect(result).toEqual(mockRelevantContents);
    });

    it("should handle service errors", async () => {
      const serviceError = new Error("Relevancy service error");
      relevancyService.findRelevant.mockRejectedValue(serviceError);

      await expect(controller.findContentsRelevantForContent(mockQuery, MOCK_CONTENT_ID)).rejects.toThrow(
        "Relevancy service error",
      );

      expect(relevancyService.findRelevant).toHaveBeenCalled();
    });

    it("should return empty results when no relevant content found", async () => {
      const emptyResponse = { data: [], meta: { total: 0 } };
      relevancyService.findRelevant.mockResolvedValue(emptyResponse);

      const result = await controller.findContentsRelevantForContent(mockQuery, MOCK_CONTENT_ID);

      expect(result).toEqual(emptyResponse);
    });
  });

  describe("Edge Cases and Additional Scenarios", () => {
    const mockRequest = { user: mockUser } as AuthenticatedRequest;
    const mockQuery = { page: { number: 1, size: 10 } };

    describe("Input Validation Edge Cases", () => {
      it("should handle empty string search parameter", async () => {
        const emptySearch = "";
        contentService.find.mockResolvedValue(mockListResponse);

        await controller.findContents(mockRequest, mockReply, mockQuery, emptySearch);

        expect(contentService.find).toHaveBeenCalledWith({
          term: emptySearch,
          query: mockQuery,
          fetchAll: undefined,
          orderBy: undefined,
        });
      });

      it("should handle special characters in content ID", async () => {
        const specialCharId = "content-with-dashes-123";
        contentService.findByIds.mockResolvedValue(mockServiceResponse);

        await controller.findContents(
          mockRequest,
          mockReply,
          mockQuery,
          undefined,
          undefined,
          undefined,
          specialCharId,
        );

        expect(contentService.findByIds).toHaveBeenCalledWith({
          contentIds: [specialCharId],
        });
      });

      it("should handle multiple content IDs with spaces", async () => {
        const contentIds = `${MOCK_CONTENT_ID}, ${MOCK_CONTENT_ID_2}`;
        contentService.findByIds.mockResolvedValue(mockListResponse);

        await controller.findContents(mockRequest, mockReply, mockQuery, undefined, undefined, undefined, contentIds);

        // Note: spaces are preserved when splitting
        expect(contentService.findByIds).toHaveBeenCalledWith({
          contentIds: [MOCK_CONTENT_ID, ` ${MOCK_CONTENT_ID_2}`],
        });
      });
    });

    describe("Service Response Edge Cases", () => {
      it("should handle null service response in findContents", async () => {
        contentService.find.mockResolvedValue(null);

        await controller.findContents(mockRequest, mockReply, mockQuery);

        expect(mockReply.send).toHaveBeenCalledWith(null);
      });

      it("should handle empty array response", async () => {
        const emptyResponse = { data: [], meta: { total: 0 } };
        contentService.find.mockResolvedValue(emptyResponse);

        await controller.findContents(mockRequest, mockReply, mockQuery);

        expect(mockReply.send).toHaveBeenCalledWith(emptyResponse);
      });

      it("should handle undefined response", async () => {
        contentService.find.mockResolvedValue(undefined);

        await controller.findContents(mockRequest, mockReply, mockQuery);

        expect(mockReply.send).toHaveBeenCalledWith(undefined);
      });
    });
  });

  describe("dependency injection", () => {
    it("should have contentService injected", () => {
      expect(controller["contentService"]).toBeDefined();
    });

    it("should have relevancyService injected", () => {
      expect(controller["relevancyService"]).toBeDefined();
    });

    it("should have cypherService injected", () => {
      expect(controller["cypherService"]).toBeDefined();
    });
  });
});
