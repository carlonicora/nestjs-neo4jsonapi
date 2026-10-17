import { vi, describe, it, expect, beforeEach, afterEach, type Mocked } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { HttpException, HttpStatus } from "@nestjs/common";
import { StripePriceAdminService } from "../stripe-price-admin.service";
import { StripePriceRepository } from "../../repositories/stripe-price.repository";
import { StripeProductApiService } from "../../../stripe-product/services/stripe-product-api.service";
import { StripeProductRepository } from "../../../stripe-product/repositories/stripe-product.repository";
import { StripeProductAdminService } from "../../../stripe-product/services/stripe-product-admin.service";
import { JsonApiService } from "../../../../core/jsonapi";
import { StripePrice } from "../../entities/stripe-price.entity";
import { stripePriceMeta } from "../../entities/stripe-price.meta";
import { StripeProduct } from "../../../stripe-product/entities/stripe-product.entity";
import { stripeProductMeta } from "../../../stripe-product/entities/stripe-product.meta";
import Stripe from "stripe";

describe("StripePriceAdminService - Archive/Reactivate", () => {
  let service: StripePriceAdminService;
  let repository: Mocked<StripePriceRepository>;
  let apiService: Mocked<StripeProductApiService>;

  const mockProduct: StripeProduct = {
    id: "test-uuid-product-123",
    type: stripeProductMeta.type,
    stripeProductId: "prod_test_123",
    name: "Test Product",
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockPrice: StripePrice = {
    id: "test-uuid-price-123",
    type: stripePriceMeta.type,
    stripePriceId: "price_test_123",
    active: true,
    currency: "usd",
    unitAmount: 2999,
    priceType: "recurring",
    recurringInterval: "month",
    recurringIntervalCount: 1,
    recurringUsageType: "licensed",
    nickname: null,
    lookupKey: null,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    stripeProduct: mockProduct,
  };

  const mockStripePrice: Stripe.Price = {
    id: "price_test_123",
    object: "price",
    active: true,
    currency: "usd",
    unit_amount: 2999,
    type: "recurring",
    recurring: {
      interval: "month",
      interval_count: 1,
      usage_type: "licensed",
      meter: null,
      trial_period_days: null,
    },
    billing_scheme: "per_unit",
    created: 1234567890,
    livemode: false,
    lookup_key: null,
    metadata: {},
    nickname: null,
    product: "prod_test_123",
    tax_behavior: "unspecified",
    tiers_mode: null,
    transform_quantity: null,
    unit_amount_decimal: Stripe.Decimal.from("2999"),
    custom_unit_amount: null,
  };

  beforeEach(async () => {
    const mockStripePriceRepository = {
      findById: vi.fn(),
      findAll: vi.fn(),
      findByStripePriceId: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateByStripePriceId: vi.fn(),
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
      archivePrice: vi.fn(),
      reactivatePrice: vi.fn(),
      listPrices: vi.fn(),
    };

    const mockStripeProductRepository = {
      findById: vi.fn(),
      findByStripeProductId: vi.fn(),
    };

    const mockStripeProductAdminService = {
      syncProductFromStripe: vi.fn(),
    };

    const mockJsonApiService = {
      buildSingle: vi.fn(),
      buildList: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripePriceAdminService,
        {
          provide: StripePriceRepository,
          useValue: mockStripePriceRepository,
        },
        {
          provide: StripeProductApiService,
          useValue: mockStripeProductApiService,
        },
        {
          provide: StripeProductRepository,
          useValue: mockStripeProductRepository,
        },
        {
          provide: StripeProductAdminService,
          useValue: mockStripeProductAdminService,
        },
        {
          provide: JsonApiService,
          useValue: mockJsonApiService,
        },
      ],
    }).compile();

    service = module.get<StripePriceAdminService>(StripePriceAdminService);
    repository = module.get(StripePriceRepository);
    apiService = module.get(StripeProductApiService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("archivePrice", () => {
    it("should archive price successfully", async () => {
      repository.findById.mockResolvedValue(mockPrice);
      const archivedStripePrice = { ...mockStripePrice, active: false };
      apiService.archivePrice.mockResolvedValue(archivedStripePrice);
      const archivedPrice = { ...mockPrice, active: false };
      repository.update.mockResolvedValue(archivedPrice);

      await service.archivePrice({ id: mockPrice.id });

      expect(repository.findById).toHaveBeenCalledWith({ id: mockPrice.id });
      expect(apiService.archivePrice).toHaveBeenCalledWith(mockPrice.stripePriceId);
      expect(repository.update).toHaveBeenCalledWith({
        id: mockPrice.id,
        active: false,
      });
    });

    it("should throw NOT_FOUND if price doesn't exist", async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.archivePrice({ id: "non-existent-id" })).rejects.toThrow(
        new HttpException("Price not found", HttpStatus.NOT_FOUND),
      );

      expect(repository.findById).toHaveBeenCalledWith({ id: "non-existent-id" });
      expect(apiService.archivePrice).not.toHaveBeenCalled();
      expect(repository.update).not.toHaveBeenCalled();
    });

    it("should call API service to archive in Stripe", async () => {
      repository.findById.mockResolvedValue(mockPrice);
      const archivedStripePrice = { ...mockStripePrice, active: false };
      apiService.archivePrice.mockResolvedValue(archivedStripePrice);
      repository.update.mockResolvedValue({ ...mockPrice, active: false });

      await service.archivePrice({ id: mockPrice.id });

      expect(apiService.archivePrice).toHaveBeenCalledWith(mockPrice.stripePriceId);
    });

    it("should update repository with active=false", async () => {
      repository.findById.mockResolvedValue(mockPrice);
      const archivedStripePrice = { ...mockStripePrice, active: false };
      apiService.archivePrice.mockResolvedValue(archivedStripePrice);
      repository.update.mockResolvedValue({ ...mockPrice, active: false });

      await service.archivePrice({ id: mockPrice.id });

      expect(repository.update).toHaveBeenCalledWith({
        id: mockPrice.id,
        active: false,
      });
    });

    it("should handle API service errors gracefully", async () => {
      repository.findById.mockResolvedValue(mockPrice);
      apiService.archivePrice.mockRejectedValue(new Error("Stripe API Error"));

      await expect(service.archivePrice({ id: mockPrice.id })).rejects.toThrow("Stripe API Error");

      expect(repository.findById).toHaveBeenCalledWith({ id: mockPrice.id });
      expect(apiService.archivePrice).toHaveBeenCalledWith(mockPrice.stripePriceId);
    });
  });

  describe("reactivatePrice", () => {
    it("should reactivate price successfully", async () => {
      const archivedPrice = { ...mockPrice, active: false };
      repository.findById.mockResolvedValue(archivedPrice);
      const reactivatedStripePrice = { ...mockStripePrice, active: true };
      apiService.reactivatePrice.mockResolvedValue(reactivatedStripePrice);
      const reactivatedPrice = { ...mockPrice, active: true };
      repository.update.mockResolvedValue(reactivatedPrice);

      await service.reactivatePrice({ id: mockPrice.id });

      expect(repository.findById).toHaveBeenCalledWith({ id: mockPrice.id });
      expect(apiService.reactivatePrice).toHaveBeenCalledWith(mockPrice.stripePriceId);
      expect(repository.update).toHaveBeenCalledWith({
        id: mockPrice.id,
        active: true,
      });
    });

    it("should throw NOT_FOUND if price doesn't exist", async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.reactivatePrice({ id: "non-existent-id" })).rejects.toThrow(
        new HttpException("Price not found", HttpStatus.NOT_FOUND),
      );

      expect(repository.findById).toHaveBeenCalledWith({ id: "non-existent-id" });
      expect(apiService.reactivatePrice).not.toHaveBeenCalled();
      expect(repository.update).not.toHaveBeenCalled();
    });

    it("should call API service to reactivate in Stripe", async () => {
      const archivedPrice = { ...mockPrice, active: false };
      repository.findById.mockResolvedValue(archivedPrice);
      const reactivatedStripePrice = { ...mockStripePrice, active: true };
      apiService.reactivatePrice.mockResolvedValue(reactivatedStripePrice);
      repository.update.mockResolvedValue({ ...mockPrice, active: true });

      await service.reactivatePrice({ id: mockPrice.id });

      expect(apiService.reactivatePrice).toHaveBeenCalledWith(mockPrice.stripePriceId);
    });

    it("should update repository with active=true", async () => {
      const archivedPrice = { ...mockPrice, active: false };
      repository.findById.mockResolvedValue(archivedPrice);
      const reactivatedStripePrice = { ...mockStripePrice, active: true };
      apiService.reactivatePrice.mockResolvedValue(reactivatedStripePrice);
      repository.update.mockResolvedValue({ ...mockPrice, active: true });

      await service.reactivatePrice({ id: mockPrice.id });

      expect(repository.update).toHaveBeenCalledWith({
        id: mockPrice.id,
        active: true,
      });
    });

    it("should handle API service errors gracefully", async () => {
      const archivedPrice = { ...mockPrice, active: false };
      repository.findById.mockResolvedValue(archivedPrice);
      apiService.reactivatePrice.mockRejectedValue(new Error("Stripe API Error"));

      await expect(service.reactivatePrice({ id: mockPrice.id })).rejects.toThrow("Stripe API Error");

      expect(repository.findById).toHaveBeenCalledWith({ id: mockPrice.id });
      expect(apiService.reactivatePrice).toHaveBeenCalledWith(mockPrice.stripePriceId);
    });
  });
});
