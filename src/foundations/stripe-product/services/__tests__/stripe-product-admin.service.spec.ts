import { vi, describe, it, expect, beforeEach, afterEach, type Mocked } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { HttpException, HttpStatus } from "@nestjs/common";
import { StripeProductAdminService } from "../stripe-product-admin.service";
import { StripeProductRepository } from "../../repositories/stripe-product.repository";
import { StripeProductApiService } from "../stripe-product-api.service";
import { JsonApiService } from "../../../../core/jsonapi";
import { StripeProduct } from "../../entities/stripe-product.entity";
import { stripeProductMeta } from "../../entities/stripe-product.meta";
import Stripe from "stripe";

describe("StripeProductAdminService", () => {
  let service: StripeProductAdminService;
  let repository: Mocked<StripeProductRepository>;
  let apiService: Mocked<StripeProductApiService>;
  let jsonApiService: Mocked<JsonApiService>;

  const mockProduct: StripeProduct = {
    id: "test-uuid-123",
    type: stripeProductMeta.type,
    stripeProductId: "prod_test_123",
    name: "Test Product",
    description: "Test Description",
    active: true,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockStripeProduct: Stripe.Product = {
    id: "prod_test_123",
    object: "product",
    active: true,
    created: 1234567890,
    default_price: null,
    description: "Test Description",
    images: [],
    livemode: false,
    marketing_features: [],
    metadata: {},
    name: "Test Product",
    package_dimensions: null,
    shippable: null,
    statement_descriptor: null,
    tax_code: null,
    type: "service",
    unit_label: null,
    updated: 1234567890,
    url: null,
  };

  beforeEach(async () => {
    const mockStripeProductRepository = {
      findById: vi.fn(),
      findAll: vi.fn(),
      findByStripeProductId: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateByStripeProductId: vi.fn(),
      delete: vi.fn(),
    };

    const mockStripeProductApiService = {
      createProduct: vi.fn(),
      retrieveProduct: vi.fn(),
      updateProduct: vi.fn(),
      archiveProduct: vi.fn(),
      reactivateProduct: vi.fn(),
      listProducts: vi.fn(),
      createPrice: vi.fn(),
      retrievePrice: vi.fn(),
      updatePrice: vi.fn(),
      listPrices: vi.fn(),
    };

    const mockJsonApiService = {
      buildSingle: vi.fn(),
      buildList: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeProductAdminService,
        {
          provide: StripeProductRepository,
          useValue: mockStripeProductRepository,
        },
        {
          provide: StripeProductApiService,
          useValue: mockStripeProductApiService,
        },
        {
          provide: JsonApiService,
          useValue: mockJsonApiService,
        },
      ],
    }).compile();

    service = module.get<StripeProductAdminService>(StripeProductAdminService);
    repository = module.get(StripeProductRepository);
    apiService = module.get(StripeProductApiService);
    jsonApiService = module.get(JsonApiService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("archiveProduct", () => {
    it("should archive product successfully", async () => {
      repository.findById.mockResolvedValue(mockProduct);
      const archivedStripeProduct = { ...mockStripeProduct, active: false };
      apiService.archiveProduct.mockResolvedValue(archivedStripeProduct);
      const archivedProduct = { ...mockProduct, active: false };
      repository.update.mockResolvedValue(archivedProduct);

      await service.archiveProduct({ id: mockProduct.id });

      expect(repository.findById).toHaveBeenCalledWith({ id: mockProduct.id });
      expect(apiService.archiveProduct).toHaveBeenCalledWith(mockProduct.stripeProductId);
      expect(repository.update).toHaveBeenCalledWith({
        id: mockProduct.id,
        active: false,
      });
    });

    it("should throw NOT_FOUND if product doesn't exist", async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.archiveProduct({ id: "non-existent-id" })).rejects.toThrow(
        new HttpException("Product not found", HttpStatus.NOT_FOUND),
      );

      expect(repository.findById).toHaveBeenCalledWith({ id: "non-existent-id" });
      expect(apiService.archiveProduct).not.toHaveBeenCalled();
      expect(repository.update).not.toHaveBeenCalled();
    });

    it("should call API service to archive in Stripe", async () => {
      repository.findById.mockResolvedValue(mockProduct);
      const archivedStripeProduct = { ...mockStripeProduct, active: false };
      apiService.archiveProduct.mockResolvedValue(archivedStripeProduct);
      repository.update.mockResolvedValue({ ...mockProduct, active: false });

      await service.archiveProduct({ id: mockProduct.id });

      expect(apiService.archiveProduct).toHaveBeenCalledWith(mockProduct.stripeProductId);
    });

    it("should update repository with active=false", async () => {
      repository.findById.mockResolvedValue(mockProduct);
      const archivedStripeProduct = { ...mockStripeProduct, active: false };
      apiService.archiveProduct.mockResolvedValue(archivedStripeProduct);
      repository.update.mockResolvedValue({ ...mockProduct, active: false });

      await service.archiveProduct({ id: mockProduct.id });

      expect(repository.update).toHaveBeenCalledWith({
        id: mockProduct.id,
        active: false,
      });
    });

    it("should handle API service errors gracefully", async () => {
      repository.findById.mockResolvedValue(mockProduct);
      apiService.archiveProduct.mockRejectedValue(new Error("Stripe API Error"));

      await expect(service.archiveProduct({ id: mockProduct.id })).rejects.toThrow("Stripe API Error");

      expect(repository.findById).toHaveBeenCalledWith({ id: mockProduct.id });
      expect(apiService.archiveProduct).toHaveBeenCalledWith(mockProduct.stripeProductId);
      // Repository update should not be called if API service fails
    });
  });

  describe("reactivateProduct", () => {
    it("should reactivate product successfully", async () => {
      const archivedProduct = { ...mockProduct, active: false };
      repository.findById.mockResolvedValue(archivedProduct);
      const reactivatedStripeProduct = { ...mockStripeProduct, active: true };
      apiService.reactivateProduct.mockResolvedValue(reactivatedStripeProduct);
      const reactivatedProduct = { ...mockProduct, active: true };
      repository.update.mockResolvedValue(reactivatedProduct);

      await service.reactivateProduct({ id: mockProduct.id });

      expect(repository.findById).toHaveBeenCalledWith({ id: mockProduct.id });
      expect(apiService.reactivateProduct).toHaveBeenCalledWith(mockProduct.stripeProductId);
      expect(repository.update).toHaveBeenCalledWith({
        id: mockProduct.id,
        active: true,
      });
    });

    it("should throw NOT_FOUND if product doesn't exist", async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.reactivateProduct({ id: "non-existent-id" })).rejects.toThrow(
        new HttpException("Product not found", HttpStatus.NOT_FOUND),
      );

      expect(repository.findById).toHaveBeenCalledWith({ id: "non-existent-id" });
      expect(apiService.reactivateProduct).not.toHaveBeenCalled();
      expect(repository.update).not.toHaveBeenCalled();
    });

    it("should call API service to reactivate in Stripe", async () => {
      const archivedProduct = { ...mockProduct, active: false };
      repository.findById.mockResolvedValue(archivedProduct);
      const reactivatedStripeProduct = { ...mockStripeProduct, active: true };
      apiService.reactivateProduct.mockResolvedValue(reactivatedStripeProduct);
      repository.update.mockResolvedValue({ ...mockProduct, active: true });

      await service.reactivateProduct({ id: mockProduct.id });

      expect(apiService.reactivateProduct).toHaveBeenCalledWith(mockProduct.stripeProductId);
    });

    it("should update repository with active=true", async () => {
      const archivedProduct = { ...mockProduct, active: false };
      repository.findById.mockResolvedValue(archivedProduct);
      const reactivatedStripeProduct = { ...mockStripeProduct, active: true };
      apiService.reactivateProduct.mockResolvedValue(reactivatedStripeProduct);
      repository.update.mockResolvedValue({ ...mockProduct, active: true });

      await service.reactivateProduct({ id: mockProduct.id });

      expect(repository.update).toHaveBeenCalledWith({
        id: mockProduct.id,
        active: true,
      });
    });

    it("should handle API service errors gracefully", async () => {
      const archivedProduct = { ...mockProduct, active: false };
      repository.findById.mockResolvedValue(archivedProduct);
      apiService.reactivateProduct.mockRejectedValue(new Error("Stripe API Error"));

      await expect(service.reactivateProduct({ id: mockProduct.id })).rejects.toThrow("Stripe API Error");

      expect(repository.findById).toHaveBeenCalledWith({ id: mockProduct.id });
      expect(apiService.reactivateProduct).toHaveBeenCalledWith(mockProduct.stripeProductId);
      // Repository update should not be called if API service fails
    });
  });
});
