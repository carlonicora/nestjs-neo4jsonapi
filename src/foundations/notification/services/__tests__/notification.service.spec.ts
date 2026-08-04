import { vi, describe, it, expect, beforeEach, afterEach, MockedObject } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ClsService } from "nestjs-cls";
import { NotificationServices } from "../notification.service";
import { NotificationRepository } from "../../repositories/notification.repository";
import { JsonApiService } from "../../../../core/jsonapi/services/jsonapi.service";

describe("NotificationServices", () => {
  let service: NotificationServices;
  let notificationRepository: MockedObject<NotificationRepository>;
  let jsonApiService: MockedObject<JsonApiService>;

  const TEST_IDS = {
    userId: "550e8400-e29b-41d4-a716-446655440000",
    notificationId1: "660e8400-e29b-41d4-a716-446655440001",
    notificationId2: "770e8400-e29b-41d4-a716-446655440002",
  };

  const MOCK_NOTIFICATIONS = [
    { id: TEST_IDS.notificationId1, message: "Notification 1", isRead: false },
    { id: TEST_IDS.notificationId2, message: "Notification 2", isRead: true },
  ];

  const createMockNotificationRepository = () => ({
    findForUser: vi.fn(),
    findByIdForUser: vi.fn(),
    markAsRead: vi.fn(),
    archive: vi.fn(),
    createNotification: vi.fn(),
    createIdempotent: vi.fn(),
    delete: vi.fn(),
  });

  const createMockJsonApiService = () => ({
    buildSingle: vi.fn(),
    buildList: vi.fn(),
    buildError: vi.fn(),
  });

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationServices,
        { provide: NotificationRepository, useValue: createMockNotificationRepository() },
        { provide: JsonApiService, useValue: createMockJsonApiService() },
        { provide: ClsService, useValue: { get: vi.fn(), set: vi.fn(), has: vi.fn().mockReturnValue(false) } },
      ],
    }).compile();

    service = module.get<NotificationServices>(NotificationServices);
    notificationRepository = module.get(NotificationRepository) as MockedObject<NotificationRepository>;
    jsonApiService = module.get(JsonApiService) as MockedObject<JsonApiService>;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create the service", () => {
      expect(service).toBeDefined();
    });
  });

  describe("findForUser", () => {
    it("should find notifications with pagination", async () => {
      // Arrange
      const mockJsonApiResponse = { data: MOCK_NOTIFICATIONS };
      notificationRepository.findForUser.mockResolvedValue(MOCK_NOTIFICATIONS);
      jsonApiService.buildList.mockReturnValue(mockJsonApiResponse);

      // Act
      const result = await service.findForUser({ query: {}, userId: TEST_IDS.userId });

      // Assert
      expect(notificationRepository.findForUser).toHaveBeenCalledWith({
        userId: TEST_IDS.userId,
        isArchived: undefined,
        cursor: expect.anything(),
      });
      expect(jsonApiService.buildList).toHaveBeenCalled();
      expect(result).toBe(mockJsonApiResponse);
    });

    it("should build the list with the descriptor model", async () => {
      notificationRepository.findForUser.mockResolvedValue([]);
      jsonApiService.buildList.mockReturnValue({ data: [] });

      await service.findForUser({ query: {}, userId: TEST_IDS.userId });

      expect(jsonApiService.buildList).toHaveBeenCalledWith(
        expect.objectContaining({ type: "notifications", nodeName: "notification" }),
        [],
        expect.anything(),
      );
    });

    it("should filter by isArchived when provided", async () => {
      // Arrange
      notificationRepository.findForUser.mockResolvedValue([]);
      jsonApiService.buildList.mockReturnValue({ data: [] });

      // Act
      await service.findForUser({ query: {}, userId: TEST_IDS.userId, isArchived: true });

      // Assert
      expect(notificationRepository.findForUser).toHaveBeenCalledWith(
        expect.objectContaining({
          isArchived: true,
        }),
      );
    });

    it("should handle pagination query parameters", async () => {
      // Arrange
      const query = { page: { size: 10, after: "cursor123" } };
      notificationRepository.findForUser.mockResolvedValue([]);
      jsonApiService.buildList.mockReturnValue({ data: [] });

      // Act
      await service.findForUser({ query, userId: TEST_IDS.userId });

      // Assert
      expect(notificationRepository.findForUser).toHaveBeenCalled();
    });

    it("should propagate errors from repository", async () => {
      // Arrange
      notificationRepository.findForUser.mockRejectedValue(new Error("Database error"));

      // Act & Assert
      await expect(service.findForUser({ query: {}, userId: TEST_IDS.userId })).rejects.toThrow("Database error");
    });
  });

  describe("findByIdForUser", () => {
    it("should find notification by ID", async () => {
      // Arrange
      const mockNotification = MOCK_NOTIFICATIONS[0];
      const mockJsonApiResponse = { data: mockNotification };
      notificationRepository.findByIdForUser.mockResolvedValue(mockNotification);
      jsonApiService.buildSingle.mockReturnValue(mockJsonApiResponse);

      // Act
      const result = await service.findByIdForUser({
        notificationId: TEST_IDS.notificationId1,
        userId: TEST_IDS.userId,
      });

      // Assert
      expect(notificationRepository.findByIdForUser).toHaveBeenCalledWith({
        notificationId: TEST_IDS.notificationId1,
        userId: TEST_IDS.userId,
      });
      expect(jsonApiService.buildSingle).toHaveBeenCalled();
      expect(result).toBe(mockJsonApiResponse);
    });

    it("should propagate errors from repository", async () => {
      // Arrange
      notificationRepository.findByIdForUser.mockRejectedValue(new Error("Not found"));

      // Act & Assert
      await expect(
        service.findByIdForUser({
          notificationId: TEST_IDS.notificationId1,
          userId: TEST_IDS.userId,
        }),
      ).rejects.toThrow("Not found");
    });
  });

  describe("markAsRead", () => {
    it("should mark notifications as read", async () => {
      // Arrange
      const notificationIds = [TEST_IDS.notificationId1, TEST_IDS.notificationId2];
      notificationRepository.markAsRead.mockResolvedValue({ updated: 2 });

      // Act
      const result = await service.markAsRead({
        userId: TEST_IDS.userId,
        notificationIds,
      });

      // Assert
      expect(notificationRepository.markAsRead).toHaveBeenCalledWith({
        userId: TEST_IDS.userId,
        notificationIds,
      });
      expect(result).toEqual({ updated: 2 });
    });

    it("should handle empty notification IDs array", async () => {
      // Arrange
      notificationRepository.markAsRead.mockResolvedValue({ updated: 0 });

      // Act
      const result = await service.markAsRead({
        userId: TEST_IDS.userId,
        notificationIds: [],
      });

      // Assert
      expect(result).toEqual({ updated: 0 });
    });

    it("should propagate errors from repository", async () => {
      // Arrange
      notificationRepository.markAsRead.mockRejectedValue(new Error("Update failed"));

      // Act & Assert
      await expect(
        service.markAsRead({
          userId: TEST_IDS.userId,
          notificationIds: [TEST_IDS.notificationId1],
        }),
      ).rejects.toThrow("Update failed");
    });
  });

  describe("archive", () => {
    it("should archive a notification", async () => {
      // Arrange
      notificationRepository.archive.mockResolvedValue(undefined);

      // Act
      await service.archive({ notificationId: TEST_IDS.notificationId1 });

      // Assert
      expect(notificationRepository.archive).toHaveBeenCalledWith({
        notificationId: TEST_IDS.notificationId1,
      });
    });

    it("should propagate errors from repository", async () => {
      // Arrange
      notificationRepository.archive.mockRejectedValue(new Error("Archive failed"));

      // Act & Assert
      await expect(service.archive({ notificationId: TEST_IDS.notificationId1 })).rejects.toThrow("Archive failed");
    });
  });
});
