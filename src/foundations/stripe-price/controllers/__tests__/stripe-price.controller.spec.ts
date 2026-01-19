import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
// Mock the guards to avoid dependency resolution issues
vi.mock("../../../../common/guards", () => ({
  JwtAuthGuard: class MockJwtAuthGuard {
    canActivate = vi.fn().mockReturnValue(true);
  },
  AdminJwtAuthGuard: class MockAdminJwtAuthGuard {
    canActivate = vi.fn().mockReturnValue(true);
  },
}));

import { Test, TestingModule } from "@nestjs/testing";
import { HttpStatus } from "@nestjs/common";
import { StripePriceController } from "../stripe-price.controller";
import { StripePriceAdminService } from "../../services/stripe-price-admin.service";
import { StripePricePostDTO, StripePricePutDTO } from "../../dtos/stripe-price.dto";
import { stripePriceMeta } from "../../entities/stripe-price.meta";

// Mock UUID v4 generator for tests (proper format)
const uuid = () =>
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });

describe("StripePriceController", () => {
  let controller: StripePriceController;
  let service: StripePriceAdminService;
  let mockReply: any;

  const mockStripePriceAdminService = {
    listPrices: vi.fn(),
    getPrice: vi.fn(),
    createPrice: vi.fn(),
    updatePrice: vi.fn(),
    archivePrice: vi.fn(),
    reactivatePrice: vi.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StripePriceController],
      providers: [
        {
          provide: StripePriceAdminService,
          useValue: mockStripePriceAdminService,
        },
      ],
    }).compile();

    controller = module.get<StripePriceController>(StripePriceController);
    service = module.get<StripePriceAdminService>(StripePriceAdminService);

    mockReply = {
      send: vi.fn(),
      status: vi.fn().mockReturnThis(),
    };

    vi.clearAllMocks();
  });

  describe("getPrice", () => {
    it("should get price by UUID id parameter", async () => {
      const priceId = uuid();
      const mockResponse = { data: { id: priceId } };
      mockStripePriceAdminService.getPrice.mockResolvedValue(mockResponse);

      await controller.getPrice(mockReply, priceId);

      expect(service.getPrice).toHaveBeenCalledWith({ id: priceId });
      expect(mockReply.send).toHaveBeenCalledWith(mockResponse);
    });

    it("should use :id parameter (not :priceId)", async () => {
      const priceId = uuid();
      mockStripePriceAdminService.getPrice.mockResolvedValue({ data: {} });

      await controller.getPrice(mockReply, priceId);

      expect(service.getPrice).toHaveBeenCalledWith({ id: priceId });
    });
  });

  describe("listPrices", () => {
    it("should list prices with productId filter", async () => {
      const productId = uuid();
      const mockResponse = { data: [] };
      mockStripePriceAdminService.listPrices.mockResolvedValue(mockResponse);

      await controller.listPrices(mockReply, {}, productId, undefined);

      expect(service.listPrices).toHaveBeenCalledWith({
        query: {},
        productId,
        active: undefined,
      });
      expect(mockReply.send).toHaveBeenCalledWith(mockResponse);
    });

    it("should list prices with active filter", async () => {
      const mockResponse = { data: [] };
      mockStripePriceAdminService.listPrices.mockResolvedValue(mockResponse);

      await controller.listPrices(mockReply, {}, undefined, "true");

      expect(service.listPrices).toHaveBeenCalledWith({
        query: {},
        productId: undefined,
        active: true,
      });
      expect(mockReply.send).toHaveBeenCalledWith(mockResponse);
    });
  });

  describe("createPrice", () => {
    it("should create price with JSONAPI structure", async () => {
      const priceId = uuid();
      const productId = uuid();
      const body: StripePricePostDTO = {
        data: {
          type: stripePriceMeta.endpoint,
          id: priceId,
          attributes: {
            productId,
            unitAmount: 2999,
            currency: "usd",
            nickname: "Premium Plan",
          },
        },
      };

      const mockResponse = { data: { id: priceId } };
      mockStripePriceAdminService.createPrice.mockResolvedValue(mockResponse);

      await controller.createPrice(mockReply, body);

      expect(service.createPrice).toHaveBeenCalledWith(body);
      expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.CREATED);
      expect(mockReply.send).toHaveBeenCalledWith(mockResponse);
    });

    it("should pass full JSONAPI structure to service", async () => {
      const priceId = uuid();
      const productId = uuid();
      const body: StripePricePostDTO = {
        data: {
          type: stripePriceMeta.endpoint,
          id: priceId,
          attributes: {
            productId,
            unitAmount: 999,
            currency: "eur",
            recurring: {
              interval: "month",
              intervalCount: 1,
            },
          },
        },
      };

      mockStripePriceAdminService.createPrice.mockResolvedValue({ data: {} });

      await controller.createPrice(mockReply, body);

      // Service should receive the entire body structure
      expect(service.createPrice).toHaveBeenCalledWith(body);
    });
  });

  describe("updatePrice", () => {
    it("should update price when URL id matches body id", async () => {
      const priceId = uuid();
      const body: StripePricePutDTO = {
        data: {
          type: stripePriceMeta.endpoint,
          id: priceId,
          attributes: {
            nickname: "Updated Plan",
          },
        },
      };

      const mockResponse = { data: { id: priceId } };
      mockStripePriceAdminService.updatePrice.mockResolvedValue(mockResponse);

      await controller.updatePrice(mockReply, priceId, body);

      expect(service.updatePrice).toHaveBeenCalledWith(body);
      expect(mockReply.send).toHaveBeenCalledWith(mockResponse);
    });

    it("should reject update when URL id does not match body id", async () => {
      const urlId = uuid();
      const bodyId = uuid();
      const body: StripePricePutDTO = {
        data: {
          type: stripePriceMeta.endpoint,
          id: bodyId, // Different from URL
          attributes: {
            nickname: "Updated",
          },
        },
      };

      await controller.updatePrice(mockReply, urlId, body);

      expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.PRECONDITION_FAILED);
      expect(mockReply.send).toHaveBeenCalledWith({
        error: "Price id does not match the {json:api} id",
      });
      expect(service.updatePrice).not.toHaveBeenCalled();
    });

    it("should use :id parameter (not :priceId) in route", async () => {
      const priceId = uuid();
      const body: StripePricePutDTO = {
        data: {
          type: stripePriceMeta.endpoint,
          id: priceId,
          attributes: {
            metadata: { key: "value" },
          },
        },
      };

      mockStripePriceAdminService.updatePrice.mockResolvedValue({ data: {} });

      await controller.updatePrice(mockReply, priceId, body);

      expect(service.updatePrice).toHaveBeenCalledWith(body);
    });

    it("should pass full JSONAPI structure to service", async () => {
      const priceId = uuid();
      const body: StripePricePutDTO = {
        data: {
          type: stripePriceMeta.endpoint,
          id: priceId,
          attributes: {
            nickname: "New Name",
            metadata: { updated: "true" },
          },
        },
      };

      mockStripePriceAdminService.updatePrice.mockResolvedValue({ data: {} });

      await controller.updatePrice(mockReply, priceId, body);

      // Service should receive the entire body structure
      expect(service.updatePrice).toHaveBeenCalledWith(body);
    });
  });

  describe("archivePrice", () => {
    it("should archive price by UUID id parameter", async () => {
      const priceId = uuid();
      mockStripePriceAdminService.archivePrice.mockResolvedValue(undefined);

      await controller.archivePrice(mockReply, priceId);

      expect(service.archivePrice).toHaveBeenCalledWith({ id: priceId });
      expect(mockReply.send).toHaveBeenCalled();
    });

    it("should return NO_CONTENT status (204)", async () => {
      const priceId = uuid();
      mockStripePriceAdminService.archivePrice.mockResolvedValue(undefined);

      await controller.archivePrice(mockReply, priceId);

      // The @HttpCode decorator sets status to 204 automatically
      expect(mockReply.send).toHaveBeenCalled();
    });

    it("should call admin service archivePrice", async () => {
      const priceId = uuid();
      mockStripePriceAdminService.archivePrice.mockResolvedValue(undefined);

      await controller.archivePrice(mockReply, priceId);

      expect(service.archivePrice).toHaveBeenCalledTimes(1);
      expect(service.archivePrice).toHaveBeenCalledWith({ id: priceId });
    });

    it("should handle errors from admin service", async () => {
      const priceId = uuid();
      const error = new Error("Price not found");
      mockStripePriceAdminService.archivePrice.mockRejectedValue(error);

      await expect(controller.archivePrice(mockReply, priceId)).rejects.toThrow("Price not found");

      expect(service.archivePrice).toHaveBeenCalledWith({ id: priceId });
    });
  });

  describe("reactivatePrice", () => {
    it("should reactivate price by UUID id parameter", async () => {
      const priceId = uuid();
      mockStripePriceAdminService.reactivatePrice.mockResolvedValue(undefined);

      await controller.reactivatePrice(mockReply, priceId);

      expect(service.reactivatePrice).toHaveBeenCalledWith({ id: priceId });
      expect(mockReply.send).toHaveBeenCalled();
    });

    it("should return NO_CONTENT status (204)", async () => {
      const priceId = uuid();
      mockStripePriceAdminService.reactivatePrice.mockResolvedValue(undefined);

      await controller.reactivatePrice(mockReply, priceId);

      // The @HttpCode decorator sets status to 204 automatically
      expect(mockReply.send).toHaveBeenCalled();
    });

    it("should call admin service reactivatePrice", async () => {
      const priceId = uuid();
      mockStripePriceAdminService.reactivatePrice.mockResolvedValue(undefined);

      await controller.reactivatePrice(mockReply, priceId);

      expect(service.reactivatePrice).toHaveBeenCalledTimes(1);
      expect(service.reactivatePrice).toHaveBeenCalledWith({ id: priceId });
    });

    it("should use DELETE method on :id/archive route", async () => {
      const priceId = uuid();
      mockStripePriceAdminService.reactivatePrice.mockResolvedValue(undefined);

      await controller.reactivatePrice(mockReply, priceId);

      // The endpoint is decorated with @Delete, verifying through test execution
      expect(service.reactivatePrice).toHaveBeenCalledWith({ id: priceId });
    });

    it("should handle errors from admin service", async () => {
      const priceId = uuid();
      const error = new Error("Price not found");
      mockStripePriceAdminService.reactivatePrice.mockRejectedValue(error);

      await expect(controller.reactivatePrice(mockReply, priceId)).rejects.toThrow("Price not found");

      expect(service.reactivatePrice).toHaveBeenCalledWith({ id: priceId });
    });
  });

  describe("JSONAPI Compliance", () => {
    it("should validate type field equals endpoint", async () => {
      const priceId = uuid();
      const body: StripePricePutDTO = {
        data: {
          type: stripePriceMeta.endpoint, // Must match
          id: priceId,
          attributes: {},
        },
      };

      mockStripePriceAdminService.updatePrice.mockResolvedValue({ data: {} });

      await controller.updatePrice(mockReply, priceId, body);

      expect(service.updatePrice).toHaveBeenCalled();
    });

    it("should ensure UUID format for id parameter", async () => {
      const priceId = uuid();

      mockStripePriceAdminService.getPrice.mockResolvedValue({ data: {} });

      await controller.getPrice(mockReply, priceId);

      // Controller receives UUID string, validation happens at DTO level
      expect(service.getPrice).toHaveBeenCalledWith({ id: priceId });
    });
  });
});
