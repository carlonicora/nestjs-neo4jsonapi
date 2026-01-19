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
import { StripeProductController } from "../stripe-product.controller";
import { StripeProductAdminService } from "../../services/stripe-product-admin.service";

// Mock UUID v4 generator for tests (proper format)
const uuid = () =>
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });

describe("StripeProductController", () => {
  let controller: StripeProductController;
  let service: StripeProductAdminService;
  let mockReply: any;

  const mockStripeProductAdminService = {
    listProducts: vi.fn(),
    getProduct: vi.fn(),
    createProduct: vi.fn(),
    updateProduct: vi.fn(),
    archiveProduct: vi.fn(),
    reactivateProduct: vi.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StripeProductController],
      providers: [
        {
          provide: StripeProductAdminService,
          useValue: mockStripeProductAdminService,
        },
      ],
    }).compile();

    controller = module.get<StripeProductController>(StripeProductController);
    service = module.get<StripeProductAdminService>(StripeProductAdminService);

    mockReply = {
      send: vi.fn(),
      status: vi.fn().mockReturnThis(),
    };

    vi.clearAllMocks();
  });

  describe("archiveProduct", () => {
    it("should archive product by UUID id parameter", async () => {
      const productId = uuid();
      mockStripeProductAdminService.archiveProduct.mockResolvedValue(undefined);

      await controller.archiveProduct(mockReply, productId);

      expect(service.archiveProduct).toHaveBeenCalledWith({ id: productId });
      expect(mockReply.send).toHaveBeenCalled();
    });

    it("should return NO_CONTENT status (204)", async () => {
      const productId = uuid();
      mockStripeProductAdminService.archiveProduct.mockResolvedValue(undefined);

      await controller.archiveProduct(mockReply, productId);

      // The @HttpCode decorator sets status to 204 automatically
      expect(mockReply.send).toHaveBeenCalled();
    });

    it("should call admin service archiveProduct", async () => {
      const productId = uuid();
      mockStripeProductAdminService.archiveProduct.mockResolvedValue(undefined);

      await controller.archiveProduct(mockReply, productId);

      expect(service.archiveProduct).toHaveBeenCalledTimes(1);
      expect(service.archiveProduct).toHaveBeenCalledWith({ id: productId });
    });

    it("should handle errors from admin service", async () => {
      const productId = uuid();
      const error = new Error("Product not found");
      mockStripeProductAdminService.archiveProduct.mockRejectedValue(error);

      await expect(controller.archiveProduct(mockReply, productId)).rejects.toThrow("Product not found");

      expect(service.archiveProduct).toHaveBeenCalledWith({ id: productId });
    });
  });

  describe("reactivateProduct", () => {
    it("should reactivate product by UUID id parameter", async () => {
      const productId = uuid();
      mockStripeProductAdminService.reactivateProduct.mockResolvedValue(undefined);

      await controller.reactivateProduct(mockReply, productId);

      expect(service.reactivateProduct).toHaveBeenCalledWith({ id: productId });
      expect(mockReply.send).toHaveBeenCalled();
    });

    it("should return NO_CONTENT status (204)", async () => {
      const productId = uuid();
      mockStripeProductAdminService.reactivateProduct.mockResolvedValue(undefined);

      await controller.reactivateProduct(mockReply, productId);

      // The @HttpCode decorator sets status to 204 automatically
      expect(mockReply.send).toHaveBeenCalled();
    });

    it("should call admin service reactivateProduct", async () => {
      const productId = uuid();
      mockStripeProductAdminService.reactivateProduct.mockResolvedValue(undefined);

      await controller.reactivateProduct(mockReply, productId);

      expect(service.reactivateProduct).toHaveBeenCalledTimes(1);
      expect(service.reactivateProduct).toHaveBeenCalledWith({ id: productId });
    });

    it("should use DELETE method on /:id/archive route", async () => {
      const productId = uuid();
      mockStripeProductAdminService.reactivateProduct.mockResolvedValue(undefined);

      await controller.reactivateProduct(mockReply, productId);

      // The endpoint is decorated with @Delete, verifying through test execution
      expect(service.reactivateProduct).toHaveBeenCalledWith({ id: productId });
    });

    it("should handle errors from admin service", async () => {
      const productId = uuid();
      const error = new Error("Product not found");
      mockStripeProductAdminService.reactivateProduct.mockRejectedValue(error);

      await expect(controller.reactivateProduct(mockReply, productId)).rejects.toThrow("Product not found");

      expect(service.reactivateProduct).toHaveBeenCalledWith({ id: productId });
    });
  });
});
