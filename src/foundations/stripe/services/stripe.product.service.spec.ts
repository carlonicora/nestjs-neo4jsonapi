import { Test, TestingModule } from "@nestjs/testing";
import { StripeProductService } from "./stripe.product.service";
import { StripeService } from "./stripe.service";
import { StripeError } from "../errors/stripe.errors";
import { createMockStripeClient, MockStripeClient } from "../__tests__/mocks/stripe.mock";
import {
  MOCK_PRODUCT,
  MOCK_PRICE_RECURRING,
  TEST_IDS,
  STRIPE_CARD_ERROR,
  STRIPE_INVALID_REQUEST_ERROR,
  STRIPE_API_ERROR,
  STRIPE_RATE_LIMIT_ERROR,
} from "../__tests__/fixtures/stripe.fixtures";

describe("StripeProductService", () => {
  let service: StripeProductService;
  let stripeService: jest.Mocked<StripeService>;
  let mockStripe: MockStripeClient;

  beforeEach(async () => {
    mockStripe = createMockStripeClient();

    const mockStripeService = {
      getClient: jest.fn().mockReturnValue(mockStripe),
      isConfigured: jest.fn().mockReturnValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeProductService,
        {
          provide: StripeService,
          useValue: mockStripeService,
        },
      ],
    }).compile();

    service = module.get<StripeProductService>(StripeProductService);
    stripeService = module.get(StripeService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("createProduct", () => {
    const validParams = {
      name: "Test Product",
    };

    it("should create product with minimal params", async () => {
      mockStripe.products.create.mockResolvedValue(MOCK_PRODUCT);

      const result = await service.createProduct(validParams);

      expect(mockStripe.products.create).toHaveBeenCalledWith({
        name: validParams.name,
        description: undefined,
        metadata: undefined,
      });
      expect(result).toEqual(MOCK_PRODUCT);
    });

    it("should create product with description", async () => {
      const paramsWithDescription = {
        name: "Test Product",
        description: "A detailed product description",
      };
      mockStripe.products.create.mockResolvedValue(MOCK_PRODUCT);

      await service.createProduct(paramsWithDescription);

      expect(mockStripe.products.create).toHaveBeenCalledWith({
        name: paramsWithDescription.name,
        description: paramsWithDescription.description,
        metadata: undefined,
      });
    });

    it("should create product with metadata", async () => {
      const paramsWithMetadata = {
        name: "Test Product",
        metadata: { category: "premium", tier: "gold" },
      };
      mockStripe.products.create.mockResolvedValue(MOCK_PRODUCT);

      await service.createProduct(paramsWithMetadata);

      expect(mockStripe.products.create).toHaveBeenCalledWith({
        name: paramsWithMetadata.name,
        description: undefined,
        metadata: { category: "premium", tier: "gold" },
      });
    });

    it("should create product with all optional params", async () => {
      const fullParams = {
        name: "Premium Product",
        description: "Premium tier product with all features",
        metadata: { category: "premium", featured: "true" },
      };
      mockStripe.products.create.mockResolvedValue(MOCK_PRODUCT);

      const result = await service.createProduct(fullParams);

      expect(mockStripe.products.create).toHaveBeenCalledWith({
        name: fullParams.name,
        description: fullParams.description,
        metadata: fullParams.metadata,
      });
      expect(result).toEqual(MOCK_PRODUCT);
    });

    it("should handle Stripe card errors", async () => {
      mockStripe.products.create.mockRejectedValue(STRIPE_CARD_ERROR);

      await expect(service.createProduct(validParams)).rejects.toThrow(StripeError);
    });

    it("should handle Stripe invalid request errors", async () => {
      mockStripe.products.create.mockRejectedValue(STRIPE_INVALID_REQUEST_ERROR);

      await expect(service.createProduct(validParams)).rejects.toThrow(StripeError);
    });

    it("should handle Stripe API errors", async () => {
      mockStripe.products.create.mockRejectedValue(STRIPE_API_ERROR);

      await expect(service.createProduct(validParams)).rejects.toThrow(StripeError);
    });

    it("should handle Stripe rate limit errors", async () => {
      mockStripe.products.create.mockRejectedValue(STRIPE_RATE_LIMIT_ERROR);

      await expect(service.createProduct(validParams)).rejects.toThrow(StripeError);
    });
  });

  describe("retrieveProduct", () => {
    it("should retrieve product successfully", async () => {
      mockStripe.products.retrieve.mockResolvedValue(MOCK_PRODUCT);

      const result = await service.retrieveProduct(TEST_IDS.productId);

      expect(mockStripe.products.retrieve).toHaveBeenCalledWith(TEST_IDS.productId);
      expect(result).toEqual(MOCK_PRODUCT);
    });

    it("should handle Stripe API errors", async () => {
      mockStripe.products.retrieve.mockRejectedValue(STRIPE_API_ERROR);

      await expect(service.retrieveProduct(TEST_IDS.productId)).rejects.toThrow(StripeError);
    });

    it("should handle Stripe invalid request errors for non-existent product", async () => {
      mockStripe.products.retrieve.mockRejectedValue(STRIPE_INVALID_REQUEST_ERROR);

      await expect(service.retrieveProduct("prod_nonexistent")).rejects.toThrow(StripeError);
    });
  });

  describe("updateProduct", () => {
    it("should update product name", async () => {
      const params = {
        productId: TEST_IDS.productId,
        name: "Updated Product Name",
      };
      mockStripe.products.update.mockResolvedValue(MOCK_PRODUCT);

      await service.updateProduct(params);

      expect(mockStripe.products.update).toHaveBeenCalledWith(TEST_IDS.productId, {
        name: params.name,
      });
    });

    it("should update product description", async () => {
      const params = {
        productId: TEST_IDS.productId,
        description: "Updated product description",
      };
      mockStripe.products.update.mockResolvedValue(MOCK_PRODUCT);

      await service.updateProduct(params);

      expect(mockStripe.products.update).toHaveBeenCalledWith(TEST_IDS.productId, {
        description: params.description,
      });
    });

    it("should update product active status", async () => {
      const params = {
        productId: TEST_IDS.productId,
        active: false,
      };
      mockStripe.products.update.mockResolvedValue(MOCK_PRODUCT);

      await service.updateProduct(params);

      expect(mockStripe.products.update).toHaveBeenCalledWith(TEST_IDS.productId, {
        active: false,
      });
    });

    it("should update product metadata", async () => {
      const params = {
        productId: TEST_IDS.productId,
        metadata: { category: "enterprise", updated: "true" },
      };
      mockStripe.products.update.mockResolvedValue(MOCK_PRODUCT);

      await service.updateProduct(params);

      expect(mockStripe.products.update).toHaveBeenCalledWith(TEST_IDS.productId, {
        metadata: { category: "enterprise", updated: "true" },
      });
    });

    it("should update multiple product fields at once", async () => {
      const params = {
        productId: TEST_IDS.productId,
        name: "New Name",
        description: "New Description",
        active: true,
        metadata: { version: "2.0" },
      };
      mockStripe.products.update.mockResolvedValue(MOCK_PRODUCT);

      await service.updateProduct(params);

      expect(mockStripe.products.update).toHaveBeenCalledWith(TEST_IDS.productId, {
        name: params.name,
        description: params.description,
        active: params.active,
        metadata: params.metadata,
      });
    });

    it("should handle update with only productId", async () => {
      const params = {
        productId: TEST_IDS.productId,
      };
      mockStripe.products.update.mockResolvedValue(MOCK_PRODUCT);

      await service.updateProduct(params);

      expect(mockStripe.products.update).toHaveBeenCalledWith(TEST_IDS.productId, {});
    });

    it("should handle undefined values in update", async () => {
      const params = {
        productId: TEST_IDS.productId,
        name: undefined,
        description: "Only description updated",
        active: undefined,
      };
      mockStripe.products.update.mockResolvedValue(MOCK_PRODUCT);

      await service.updateProduct(params);

      expect(mockStripe.products.update).toHaveBeenCalledWith(TEST_IDS.productId, {
        description: "Only description updated",
      });
    });

    it("should handle Stripe API errors", async () => {
      const params = {
        productId: TEST_IDS.productId,
        name: "New Name",
      };
      mockStripe.products.update.mockRejectedValue(STRIPE_API_ERROR);

      await expect(service.updateProduct(params)).rejects.toThrow(StripeError);
    });
  });

  describe("archiveProduct", () => {
    it("should archive product successfully", async () => {
      const archivedProduct = { ...MOCK_PRODUCT, active: false };
      mockStripe.products.update.mockResolvedValue(archivedProduct);

      const result = await service.archiveProduct(TEST_IDS.productId);

      expect(mockStripe.products.update).toHaveBeenCalledWith(TEST_IDS.productId, {
        active: false,
      });
      expect(result).toEqual(archivedProduct);
    });

    it("should handle Stripe API errors", async () => {
      mockStripe.products.update.mockRejectedValue(STRIPE_API_ERROR);

      await expect(service.archiveProduct(TEST_IDS.productId)).rejects.toThrow(StripeError);
    });

    it("should handle archiving already archived product", async () => {
      const archivedProduct = { ...MOCK_PRODUCT, active: false };
      mockStripe.products.update.mockResolvedValue(archivedProduct);

      const result = await service.archiveProduct(TEST_IDS.productId);

      expect(result.active).toBe(false);
    });
  });

  describe("listProducts", () => {
    it("should list all products without filter", async () => {
      const productsList = {
        object: "list" as const,
        data: [MOCK_PRODUCT],
        has_more: false,
        url: "/v1/products",
      };
      mockStripe.products.list.mockResolvedValue(productsList);

      const result = await service.listProducts();

      expect(mockStripe.products.list).toHaveBeenCalledWith({
        limit: 100,
      });
      expect(result).toEqual([MOCK_PRODUCT]);
    });

    it("should list active products only", async () => {
      const productsList = {
        object: "list" as const,
        data: [MOCK_PRODUCT],
        has_more: false,
        url: "/v1/products",
      };
      mockStripe.products.list.mockResolvedValue(productsList);

      await service.listProducts(true);

      expect(mockStripe.products.list).toHaveBeenCalledWith({
        limit: 100,
        active: true,
      });
    });

    it("should list archived products only", async () => {
      const productsList = {
        object: "list" as const,
        data: [],
        has_more: false,
        url: "/v1/products",
      };
      mockStripe.products.list.mockResolvedValue(productsList);

      await service.listProducts(false);

      expect(mockStripe.products.list).toHaveBeenCalledWith({
        limit: 100,
        active: false,
      });
    });

    it("should return empty array when no products", async () => {
      const productsList = {
        object: "list" as const,
        data: [],
        has_more: false,
        url: "/v1/products",
      };
      mockStripe.products.list.mockResolvedValue(productsList);

      const result = await service.listProducts();

      expect(result).toEqual([]);
      expect(result.length).toBe(0);
    });

    it("should return multiple products", async () => {
      const multipleProducts = [
        MOCK_PRODUCT,
        { ...MOCK_PRODUCT, id: "prod_second_123" },
        { ...MOCK_PRODUCT, id: "prod_third_123" },
      ];
      const productsList = {
        object: "list" as const,
        data: multipleProducts,
        has_more: false,
        url: "/v1/products",
      };
      mockStripe.products.list.mockResolvedValue(productsList);

      const result = await service.listProducts();

      expect(result).toEqual(multipleProducts);
      expect(result.length).toBe(3);
    });

    it("should handle Stripe API errors", async () => {
      mockStripe.products.list.mockRejectedValue(STRIPE_API_ERROR);

      await expect(service.listProducts()).rejects.toThrow(StripeError);
    });
  });

  describe("createPrice", () => {
    const validParams = {
      productId: TEST_IDS.productId,
      unitAmount: 999,
      currency: "usd",
    };

    it("should create one-time price with minimal params", async () => {
      mockStripe.prices.create.mockResolvedValue(MOCK_PRICE_RECURRING);

      const result = await service.createPrice(validParams);

      expect(mockStripe.prices.create).toHaveBeenCalledWith({
        product: validParams.productId,
        unit_amount: validParams.unitAmount,
        currency: validParams.currency,
        nickname: undefined,
        lookup_key: undefined,
        metadata: undefined,
      });
      expect(result).toEqual(MOCK_PRICE_RECURRING);
    });

    it("should create price with nickname", async () => {
      const paramsWithNickname = {
        ...validParams,
        nickname: "Monthly Plan",
      };
      mockStripe.prices.create.mockResolvedValue(MOCK_PRICE_RECURRING);

      await service.createPrice(paramsWithNickname);

      expect(mockStripe.prices.create).toHaveBeenCalledWith(
        expect.objectContaining({
          nickname: "Monthly Plan",
        }),
      );
    });

    it("should create price with lookup key", async () => {
      const paramsWithLookupKey = {
        ...validParams,
        lookupKey: "premium_monthly",
      };
      mockStripe.prices.create.mockResolvedValue(MOCK_PRICE_RECURRING);

      await service.createPrice(paramsWithLookupKey);

      expect(mockStripe.prices.create).toHaveBeenCalledWith(
        expect.objectContaining({
          lookup_key: "premium_monthly",
        }),
      );
    });

    it("should create recurring price with monthly interval", async () => {
      const paramsWithRecurring = {
        ...validParams,
        recurring: {
          interval: "month" as const,
        },
      };
      mockStripe.prices.create.mockResolvedValue(MOCK_PRICE_RECURRING);

      await service.createPrice(paramsWithRecurring);

      expect(mockStripe.prices.create).toHaveBeenCalledWith(
        expect.objectContaining({
          recurring: {
            interval: "month",
            interval_count: undefined,
            meter: undefined,
          },
        }),
      );
    });

    it("should create recurring price with custom interval count", async () => {
      const paramsWithIntervalCount = {
        ...validParams,
        recurring: {
          interval: "month" as const,
          intervalCount: 3,
        },
      };
      mockStripe.prices.create.mockResolvedValue(MOCK_PRICE_RECURRING);

      await service.createPrice(paramsWithIntervalCount);

      expect(mockStripe.prices.create).toHaveBeenCalledWith(
        expect.objectContaining({
          recurring: {
            interval: "month",
            interval_count: 3,
            meter: undefined,
          },
        }),
      );
    });

    it("should create price with yearly interval", async () => {
      const paramsWithYearly = {
        ...validParams,
        recurring: {
          interval: "year" as const,
        },
      };
      mockStripe.prices.create.mockResolvedValue(MOCK_PRICE_RECURRING);

      await service.createPrice(paramsWithYearly);

      expect(mockStripe.prices.create).toHaveBeenCalledWith(
        expect.objectContaining({
          recurring: {
            interval: "year",
            interval_count: undefined,
            meter: undefined,
          },
        }),
      );
    });

    it("should create usage-based price with meter", async () => {
      const paramsWithMeter = {
        ...validParams,
        recurring: {
          interval: "month" as const,
          meter: TEST_IDS.meterId,
        },
      };
      mockStripe.prices.create.mockResolvedValue(MOCK_PRICE_RECURRING);

      await service.createPrice(paramsWithMeter);

      expect(mockStripe.prices.create).toHaveBeenCalledWith(
        expect.objectContaining({
          recurring: {
            interval: "month",
            interval_count: undefined,
            meter: TEST_IDS.meterId,
          },
        }),
      );
    });

    it("should create price with metadata", async () => {
      const paramsWithMetadata = {
        ...validParams,
        metadata: { tier: "premium", featured: "true" },
      };
      mockStripe.prices.create.mockResolvedValue(MOCK_PRICE_RECURRING);

      await service.createPrice(paramsWithMetadata);

      expect(mockStripe.prices.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { tier: "premium", featured: "true" },
        }),
      );
    });

    it("should create price with all optional params", async () => {
      const fullParams = {
        productId: TEST_IDS.productId,
        unitAmount: 1999,
        currency: "eur",
        nickname: "Premium Annual",
        lookupKey: "premium_annual",
        recurring: {
          interval: "year" as const,
          intervalCount: 1,
          meter: TEST_IDS.meterId,
        },
        metadata: { tier: "premium", plan: "annual" },
      };
      mockStripe.prices.create.mockResolvedValue(MOCK_PRICE_RECURRING);

      const result = await service.createPrice(fullParams);

      expect(mockStripe.prices.create).toHaveBeenCalledWith({
        product: fullParams.productId,
        unit_amount: fullParams.unitAmount,
        currency: fullParams.currency,
        nickname: fullParams.nickname,
        lookup_key: fullParams.lookupKey,
        recurring: {
          interval: "year",
          interval_count: 1,
          meter: TEST_IDS.meterId,
        },
        metadata: fullParams.metadata,
      });
      expect(result).toEqual(MOCK_PRICE_RECURRING);
    });

    it("should handle Stripe card errors", async () => {
      mockStripe.prices.create.mockRejectedValue(STRIPE_CARD_ERROR);

      await expect(service.createPrice(validParams)).rejects.toThrow(StripeError);
    });

    it("should handle Stripe invalid request errors", async () => {
      mockStripe.prices.create.mockRejectedValue(STRIPE_INVALID_REQUEST_ERROR);

      await expect(service.createPrice(validParams)).rejects.toThrow(StripeError);
    });

    it("should handle Stripe API errors", async () => {
      mockStripe.prices.create.mockRejectedValue(STRIPE_API_ERROR);

      await expect(service.createPrice(validParams)).rejects.toThrow(StripeError);
    });
  });

  describe("retrievePrice", () => {
    it("should retrieve price successfully", async () => {
      mockStripe.prices.retrieve.mockResolvedValue(MOCK_PRICE_RECURRING);

      const result = await service.retrievePrice(TEST_IDS.priceId);

      expect(mockStripe.prices.retrieve).toHaveBeenCalledWith(TEST_IDS.priceId);
      expect(result).toEqual(MOCK_PRICE_RECURRING);
    });

    it("should handle Stripe API errors", async () => {
      mockStripe.prices.retrieve.mockRejectedValue(STRIPE_API_ERROR);

      await expect(service.retrievePrice(TEST_IDS.priceId)).rejects.toThrow(StripeError);
    });

    it("should handle Stripe invalid request errors for non-existent price", async () => {
      mockStripe.prices.retrieve.mockRejectedValue(STRIPE_INVALID_REQUEST_ERROR);

      await expect(service.retrievePrice("price_nonexistent")).rejects.toThrow(StripeError);
    });
  });

  describe("updatePrice", () => {
    it("should update price nickname", async () => {
      const params = {
        priceId: TEST_IDS.priceId,
        nickname: "Updated Nickname",
      };
      mockStripe.prices.update.mockResolvedValue(MOCK_PRICE_RECURRING);

      await service.updatePrice(params);

      expect(mockStripe.prices.update).toHaveBeenCalledWith(TEST_IDS.priceId, {
        nickname: params.nickname,
      });
    });

    it("should update price active status", async () => {
      const params = {
        priceId: TEST_IDS.priceId,
        active: false,
      };
      mockStripe.prices.update.mockResolvedValue(MOCK_PRICE_RECURRING);

      await service.updatePrice(params);

      expect(mockStripe.prices.update).toHaveBeenCalledWith(TEST_IDS.priceId, {
        active: false,
      });
    });

    it("should update price metadata", async () => {
      const params = {
        priceId: TEST_IDS.priceId,
        metadata: { recommended: "true", order: "1" },
      };
      mockStripe.prices.update.mockResolvedValue(MOCK_PRICE_RECURRING);

      await service.updatePrice(params);

      expect(mockStripe.prices.update).toHaveBeenCalledWith(TEST_IDS.priceId, {
        metadata: { recommended: "true", order: "1" },
      });
    });

    it("should update multiple price fields at once", async () => {
      const params = {
        priceId: TEST_IDS.priceId,
        nickname: "Best Value",
        active: true,
        metadata: { popular: "true" },
      };
      mockStripe.prices.update.mockResolvedValue(MOCK_PRICE_RECURRING);

      await service.updatePrice(params);

      expect(mockStripe.prices.update).toHaveBeenCalledWith(TEST_IDS.priceId, {
        nickname: params.nickname,
        active: params.active,
        metadata: params.metadata,
      });
    });

    it("should handle update with only priceId", async () => {
      const params = {
        priceId: TEST_IDS.priceId,
      };
      mockStripe.prices.update.mockResolvedValue(MOCK_PRICE_RECURRING);

      await service.updatePrice(params);

      expect(mockStripe.prices.update).toHaveBeenCalledWith(TEST_IDS.priceId, {});
    });

    it("should handle undefined values in update", async () => {
      const params = {
        priceId: TEST_IDS.priceId,
        nickname: undefined,
        active: false,
        metadata: undefined,
      };
      mockStripe.prices.update.mockResolvedValue(MOCK_PRICE_RECURRING);

      await service.updatePrice(params);

      expect(mockStripe.prices.update).toHaveBeenCalledWith(TEST_IDS.priceId, {
        active: false,
      });
    });

    it("should handle Stripe API errors", async () => {
      const params = {
        priceId: TEST_IDS.priceId,
        nickname: "New Nickname",
      };
      mockStripe.prices.update.mockRejectedValue(STRIPE_API_ERROR);

      await expect(service.updatePrice(params)).rejects.toThrow(StripeError);
    });
  });

  describe("listPrices", () => {
    it("should list all prices without filter", async () => {
      const pricesList = {
        object: "list" as const,
        data: [MOCK_PRICE_RECURRING],
        has_more: false,
        url: "/v1/prices",
      };
      mockStripe.prices.list.mockResolvedValue(pricesList);

      const result = await service.listPrices();

      expect(mockStripe.prices.list).toHaveBeenCalledWith({
        limit: 100,
        expand: ["data.product"],
      });
      expect(result).toEqual([MOCK_PRICE_RECURRING]);
    });

    it("should list prices for specific product", async () => {
      const pricesList = {
        object: "list" as const,
        data: [MOCK_PRICE_RECURRING],
        has_more: false,
        url: "/v1/prices",
      };
      mockStripe.prices.list.mockResolvedValue(pricesList);

      await service.listPrices({ productId: TEST_IDS.productId });

      expect(mockStripe.prices.list).toHaveBeenCalledWith({
        limit: 100,
        expand: ["data.product"],
        product: TEST_IDS.productId,
      });
    });

    it("should list active prices only", async () => {
      const pricesList = {
        object: "list" as const,
        data: [MOCK_PRICE_RECURRING],
        has_more: false,
        url: "/v1/prices",
      };
      mockStripe.prices.list.mockResolvedValue(pricesList);

      await service.listPrices({ active: true });

      expect(mockStripe.prices.list).toHaveBeenCalledWith({
        limit: 100,
        expand: ["data.product"],
        active: true,
      });
    });

    it("should list archived prices only", async () => {
      const pricesList = {
        object: "list" as const,
        data: [],
        has_more: false,
        url: "/v1/prices",
      };
      mockStripe.prices.list.mockResolvedValue(pricesList);

      await service.listPrices({ active: false });

      expect(mockStripe.prices.list).toHaveBeenCalledWith({
        limit: 100,
        expand: ["data.product"],
        active: false,
      });
    });

    it("should list prices with both productId and active filters", async () => {
      const pricesList = {
        object: "list" as const,
        data: [MOCK_PRICE_RECURRING],
        has_more: false,
        url: "/v1/prices",
      };
      mockStripe.prices.list.mockResolvedValue(pricesList);

      await service.listPrices({ productId: TEST_IDS.productId, active: true });

      expect(mockStripe.prices.list).toHaveBeenCalledWith({
        limit: 100,
        expand: ["data.product"],
        product: TEST_IDS.productId,
        active: true,
      });
    });

    it("should return empty array when no prices", async () => {
      const pricesList = {
        object: "list" as const,
        data: [],
        has_more: false,
        url: "/v1/prices",
      };
      mockStripe.prices.list.mockResolvedValue(pricesList);

      const result = await service.listPrices();

      expect(result).toEqual([]);
      expect(result.length).toBe(0);
    });

    it("should return multiple prices", async () => {
      const multiplePrices = [
        MOCK_PRICE_RECURRING,
        { ...MOCK_PRICE_RECURRING, id: "price_second_123" },
        { ...MOCK_PRICE_RECURRING, id: "price_third_123" },
      ];
      const pricesList = {
        object: "list" as const,
        data: multiplePrices,
        has_more: false,
        url: "/v1/prices",
      };
      mockStripe.prices.list.mockResolvedValue(pricesList);

      const result = await service.listPrices();

      expect(result).toEqual(multiplePrices);
      expect(result.length).toBe(3);
    });

    it("should always expand product data", async () => {
      const pricesList = {
        object: "list" as const,
        data: [MOCK_PRICE_RECURRING],
        has_more: false,
        url: "/v1/prices",
      };
      mockStripe.prices.list.mockResolvedValue(pricesList);

      await service.listPrices({ productId: TEST_IDS.productId });

      expect(mockStripe.prices.list).toHaveBeenCalledWith(
        expect.objectContaining({
          expand: ["data.product"],
        }),
      );
    });

    it("should handle Stripe API errors", async () => {
      mockStripe.prices.list.mockRejectedValue(STRIPE_API_ERROR);

      await expect(service.listPrices()).rejects.toThrow(StripeError);
    });
  });

  describe("Edge Cases", () => {
    it("should handle product with empty name", async () => {
      const paramsWithEmptyName = {
        name: "",
      };
      mockStripe.products.create.mockResolvedValue(MOCK_PRODUCT);

      await service.createProduct(paramsWithEmptyName);

      expect(mockStripe.products.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "",
        }),
      );
    });

    it("should handle price with zero unit amount", async () => {
      const paramsWithZeroAmount = {
        productId: TEST_IDS.productId,
        unitAmount: 0,
        currency: "usd",
      };
      mockStripe.prices.create.mockResolvedValue(MOCK_PRICE_RECURRING);

      await service.createPrice(paramsWithZeroAmount);

      expect(mockStripe.prices.create).toHaveBeenCalledWith(
        expect.objectContaining({
          unit_amount: 0,
        }),
      );
    });

    it("should handle empty metadata object", async () => {
      const paramsWithEmptyMetadata = {
        name: "Test Product",
        metadata: {},
      };
      mockStripe.products.create.mockResolvedValue(MOCK_PRODUCT);

      await service.createProduct(paramsWithEmptyMetadata);

      expect(mockStripe.products.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: {},
        }),
      );
    });

    it("should handle price with interval count of 1", async () => {
      const paramsWithIntervalOne = {
        productId: TEST_IDS.productId,
        unitAmount: 999,
        currency: "usd",
        recurring: {
          interval: "month" as const,
          intervalCount: 1,
        },
      };
      mockStripe.prices.create.mockResolvedValue(MOCK_PRICE_RECURRING);

      await service.createPrice(paramsWithIntervalOne);

      expect(mockStripe.prices.create).toHaveBeenCalledWith(
        expect.objectContaining({
          recurring: expect.objectContaining({
            interval_count: 1,
          }),
        }),
      );
    });

    it("should handle updating product to active=true", async () => {
      const params = {
        productId: TEST_IDS.productId,
        active: true,
      };
      mockStripe.products.update.mockResolvedValue(MOCK_PRODUCT);

      await service.updateProduct(params);

      expect(mockStripe.products.update).toHaveBeenCalledWith(TEST_IDS.productId, {
        active: true,
      });
    });
  });

  describe("Parameter Validation", () => {
    it("should preserve exact product name", async () => {
      const exactParams = {
        name: "Exact Product Name 123",
      };
      mockStripe.products.create.mockResolvedValue(MOCK_PRODUCT);

      await service.createProduct(exactParams);

      expect(mockStripe.products.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Exact Product Name 123",
        }),
      );
    });

    it("should preserve exact unit amount", async () => {
      const exactParams = {
        productId: TEST_IDS.productId,
        unitAmount: 1234,
        currency: "usd",
      };
      mockStripe.prices.create.mockResolvedValue(MOCK_PRICE_RECURRING);

      await service.createPrice(exactParams);

      expect(mockStripe.prices.create).toHaveBeenCalledWith(
        expect.objectContaining({
          unit_amount: 1234,
        }),
      );
    });

    it("should preserve exact currency code", async () => {
      const exactParams = {
        productId: TEST_IDS.productId,
        unitAmount: 999,
        currency: "eur",
      };
      mockStripe.prices.create.mockResolvedValue(MOCK_PRICE_RECURRING);

      await service.createPrice(exactParams);

      expect(mockStripe.prices.create).toHaveBeenCalledWith(
        expect.objectContaining({
          currency: "eur",
        }),
      );
    });

    it("should preserve exact metadata values", async () => {
      const exactParams = {
        name: "Test Product",
        metadata: { key1: "exact_value_1", key2: "exact_value_2" },
      };
      mockStripe.products.create.mockResolvedValue(MOCK_PRODUCT);

      await service.createProduct(exactParams);

      expect(mockStripe.products.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { key1: "exact_value_1", key2: "exact_value_2" },
        }),
      );
    });

    it("should preserve exact product ID in operations", async () => {
      mockStripe.products.retrieve.mockResolvedValue(MOCK_PRODUCT);

      await service.retrieveProduct("prod_exact_product_123");

      expect(mockStripe.products.retrieve).toHaveBeenCalledWith("prod_exact_product_123");
    });

    it("should preserve exact price ID in operations", async () => {
      mockStripe.prices.retrieve.mockResolvedValue(MOCK_PRICE_RECURRING);

      await service.retrievePrice("price_exact_price_123");

      expect(mockStripe.prices.retrieve).toHaveBeenCalledWith("price_exact_price_123");
    });
  });

  describe("Service Integration", () => {
    it("should use StripeService to get client", async () => {
      mockStripe.products.create.mockResolvedValue(MOCK_PRODUCT);

      await service.createProduct({ name: "Test Product" });

      expect(stripeService.getClient).toHaveBeenCalled();
    });

    it("should call getClient before each operation", async () => {
      mockStripe.products.create.mockResolvedValue(MOCK_PRODUCT);
      mockStripe.products.retrieve.mockResolvedValue(MOCK_PRODUCT);
      mockStripe.products.update.mockResolvedValue(MOCK_PRODUCT);
      mockStripe.prices.create.mockResolvedValue(MOCK_PRICE_RECURRING);

      await service.createProduct({ name: "Test" });
      await service.retrieveProduct(TEST_IDS.productId);
      await service.updateProduct({ productId: TEST_IDS.productId, name: "Updated" });
      await service.createPrice({ productId: TEST_IDS.productId, unitAmount: 999, currency: "usd" });

      expect(stripeService.getClient).toHaveBeenCalledTimes(4);
    });
  });
});
