import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Mock guards before imports
vi.mock("../../../common/guards/jwt.auth.guard", () => ({
  JwtAuthGuard: class MockJwtAuthGuard {
    canActivate = vi.fn().mockReturnValue(true);
  },
}));

// Mock notificationMeta used in controller decorator
vi.mock("../entities/notification.meta", () => ({
  notificationMeta: {
    type: "notifications",
    endpoint: "notifications",
    nodeName: "notification",
    labelName: "Notification",
  },
}));

// Mock notification service to avoid complex dependency chain
vi.mock("../services/notification.service", () => ({
  NotificationServices: vi.fn().mockImplementation(() => ({
    find: vi.fn(),
    findById: vi.fn(),
    markAsRead: vi.fn(),
    archive: vi.fn(),
  })),
}));

import { Test, TestingModule } from "@nestjs/testing";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { JsonApiDataInterface } from "../../../core/jsonapi/interfaces/jsonapi.data.interface";
import { NotificationPatchListDTO } from "../dtos/notification.patch.dto";
import { NotificationServices } from "../services/notification.service";
import { NotificationController } from "./notification.controller";

describe("NotificationController", () => {
  let controller: NotificationController;
  let notificationService: vi.Mocked<NotificationServices>;

  // Test data constants
  const MOCK_NOTIFICATION_ID = "550e8400-e29b-41d4-a716-446655440000";
  const MOCK_NOTIFICATION_ID_2 = "550e8400-e29b-41d4-a716-446655440001";
  const MOCK_USER_ID = "660e8400-e29b-41d4-a716-446655440002";

  const mockUser = {
    userId: MOCK_USER_ID,
    id: MOCK_USER_ID,
  };

  const mockRequest = { user: mockUser };

  const mockServiceResponse: JsonApiDataInterface = {
    type: "notifications",
    id: MOCK_NOTIFICATION_ID,
    attributes: {
      title: "Test Notification",
      message: "A test notification message",
      isRead: false,
      isArchived: false,
    },
  };

  const mockListResponse = {
    data: [mockServiceResponse],
    meta: { total: 1 },
  };

  beforeEach(async () => {
    const mockNotificationService = {
      find: vi.fn(),
      findById: vi.fn(),
      markAsRead: vi.fn(),
      archive: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationController],
      providers: [{ provide: NotificationServices, useValue: mockNotificationService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<NotificationController>(NotificationController);
    notificationService = module.get(NotificationServices);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("findList", () => {
    const mockQuery = { page: { number: 1, size: 10 } };

    it("should find notifications without isArchived filter", async () => {
      notificationService.find.mockResolvedValue(mockListResponse);

      const result = await controller.findList(mockRequest, mockQuery);

      expect(notificationService.find).toHaveBeenCalledWith({
        query: mockQuery,
        userId: MOCK_USER_ID,
        isArchived: undefined,
      });
      expect(result).toEqual(mockListResponse);
    });

    it("should find notifications with isArchived=true", async () => {
      notificationService.find.mockResolvedValue(mockListResponse);

      const result = await controller.findList(mockRequest, mockQuery, true);

      expect(notificationService.find).toHaveBeenCalledWith({
        query: mockQuery,
        userId: MOCK_USER_ID,
        isArchived: true,
      });
      expect(result).toEqual(mockListResponse);
    });

    it("should find notifications with isArchived=false", async () => {
      notificationService.find.mockResolvedValue(mockListResponse);

      const result = await controller.findList(mockRequest, mockQuery, false);

      expect(notificationService.find).toHaveBeenCalledWith({
        query: mockQuery,
        userId: MOCK_USER_ID,
        isArchived: false,
      });
      expect(result).toEqual(mockListResponse);
    });

    it("should find notifications with empty query", async () => {
      const emptyQuery = {};
      notificationService.find.mockResolvedValue(mockListResponse);

      const result = await controller.findList(mockRequest, emptyQuery);

      expect(notificationService.find).toHaveBeenCalledWith({
        query: emptyQuery,
        userId: MOCK_USER_ID,
        isArchived: undefined,
      });
      expect(result).toEqual(mockListResponse);
    });

    it("should handle service errors", async () => {
      const serviceError = new Error("Service error");
      notificationService.find.mockRejectedValue(serviceError);

      await expect(controller.findList(mockRequest, mockQuery)).rejects.toThrow("Service error");

      expect(notificationService.find).toHaveBeenCalled();
    });

    it("should return empty results when no notifications found", async () => {
      const emptyResponse = { data: [], meta: { total: 0 } };
      notificationService.find.mockResolvedValue(emptyResponse);

      const result = await controller.findList(mockRequest, mockQuery);

      expect(result).toEqual(emptyResponse);
    });
  });

  describe("findById", () => {
    it("should find notification by ID", async () => {
      notificationService.findById.mockResolvedValue(mockServiceResponse);

      const result = await controller.findById(mockRequest, MOCK_NOTIFICATION_ID);

      expect(notificationService.findById).toHaveBeenCalledWith({
        notificationId: MOCK_NOTIFICATION_ID,
        userId: MOCK_USER_ID,
      });
      expect(result).toEqual(mockServiceResponse);
    });

    it("should handle service errors", async () => {
      const serviceError = new Error("Notification not found");
      notificationService.findById.mockRejectedValue(serviceError);

      await expect(controller.findById(mockRequest, MOCK_NOTIFICATION_ID)).rejects.toThrow("Notification not found");

      expect(notificationService.findById).toHaveBeenCalled();
    });

    it("should handle non-existent notification", async () => {
      notificationService.findById.mockResolvedValue(null);

      const result = await controller.findById(mockRequest, "non-existent-id");

      expect(result).toBeNull();
    });
  });

  describe("markAsRead", () => {
    const mockQuery = {};

    it("should mark single notification as read", async () => {
      const body: NotificationPatchListDTO = {
        data: [
          {
            type: "notifications",
            id: MOCK_NOTIFICATION_ID,
            attributes: { isRead: true },
          },
        ],
      };
      notificationService.markAsRead.mockResolvedValue(undefined);

      await controller.markAsRead(mockRequest, mockQuery, body);

      expect(notificationService.markAsRead).toHaveBeenCalledWith({
        userId: MOCK_USER_ID,
        notificationIds: [MOCK_NOTIFICATION_ID],
      });
    });

    it("should mark multiple notifications as read", async () => {
      const body: NotificationPatchListDTO = {
        data: [
          {
            type: "notifications",
            id: MOCK_NOTIFICATION_ID,
            attributes: { isRead: true },
          },
          {
            type: "notifications",
            id: MOCK_NOTIFICATION_ID_2,
            attributes: { isRead: true },
          },
        ],
      };
      notificationService.markAsRead.mockResolvedValue(undefined);

      await controller.markAsRead(mockRequest, mockQuery, body);

      expect(notificationService.markAsRead).toHaveBeenCalledWith({
        userId: MOCK_USER_ID,
        notificationIds: [MOCK_NOTIFICATION_ID, MOCK_NOTIFICATION_ID_2],
      });
    });

    it("should handle empty notification list", async () => {
      const body: NotificationPatchListDTO = {
        data: [],
      };
      notificationService.markAsRead.mockResolvedValue(undefined);

      await controller.markAsRead(mockRequest, mockQuery, body);

      expect(notificationService.markAsRead).toHaveBeenCalledWith({
        userId: MOCK_USER_ID,
        notificationIds: [],
      });
    });

    it("should handle service errors", async () => {
      const body: NotificationPatchListDTO = {
        data: [
          {
            type: "notifications",
            id: MOCK_NOTIFICATION_ID,
            attributes: { isRead: true },
          },
        ],
      };
      const serviceError = new Error("Service error");
      notificationService.markAsRead.mockRejectedValue(serviceError);

      await expect(controller.markAsRead(mockRequest, mockQuery, body)).rejects.toThrow("Service error");

      expect(notificationService.markAsRead).toHaveBeenCalled();
    });
  });

  describe("archive", () => {
    const mockQuery = {};

    it("should archive notification", async () => {
      notificationService.archive.mockResolvedValue(undefined);

      await controller.archive(mockRequest, mockQuery, MOCK_NOTIFICATION_ID);

      expect(notificationService.archive).toHaveBeenCalledWith({
        notificationId: MOCK_NOTIFICATION_ID,
      });
    });

    it("should handle service errors", async () => {
      const serviceError = new Error("Archive failed");
      notificationService.archive.mockRejectedValue(serviceError);

      await expect(controller.archive(mockRequest, mockQuery, MOCK_NOTIFICATION_ID)).rejects.toThrow("Archive failed");

      expect(notificationService.archive).toHaveBeenCalled();
    });

    it("should handle non-existent notification", async () => {
      const notFoundError = new Error("Notification not found");
      notificationService.archive.mockRejectedValue(notFoundError);

      await expect(controller.archive(mockRequest, mockQuery, "non-existent-id")).rejects.toThrow(
        "Notification not found",
      );
    });
  });

  describe("dependency injection", () => {
    it("should have notificationService injected", () => {
      expect(controller["service"]).toBeDefined();
    });
  });
});
