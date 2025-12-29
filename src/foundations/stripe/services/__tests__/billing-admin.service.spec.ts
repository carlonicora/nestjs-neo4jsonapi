// Mock problematic modules before any imports
jest.mock("../../../../foundations/chunker/chunker.module", () => ({
  ChunkerModule: class {},
}));
jest.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({}));

// Mock the barrel export to provide the imports that BillingAdminService needs
jest.mock("@carlonicora/nestjs-neo4jsonapi", () => {
  const actual = jest.requireActual("@carlonicora/nestjs-neo4jsonapi");

  // Create a mock class for StripeProductService
  class MockStripeProductService {}

  return {
    ...actual,
    // Override companyMeta that billing-customer.model needs
    companyMeta: {
      type: "companies",
      endpoint: "companies",
      nodeName: "company",
      labelName: "Company",
    },
    // Provide StripeProductService as a class that can be mocked
    StripeProductService: MockStripeProductService,
  };
});

import { Test, TestingModule } from "@nestjs/testing";
import { HttpException, HttpStatus } from "@nestjs/common";
import Stripe from "stripe";
import { BillingAdminService } from "../billing-admin.service";
import { StripeProductRepository } from "../../repositories/stripe-product.repository";
import { StripePriceRepository } from "../../repositories/stripe-price.repository";
import { StripeProductService } from "@carlonicora/nestjs-neo4jsonapi";
import { JsonApiService } from "@carlonicora/nestjs-neo4jsonapi";
import { StripeProduct } from "../../entities/stripe-product.entity";
import { StripePrice } from "../../entities/stripe-price.entity";
import { MOCK_PRODUCT, TEST_IDS } from "../../__tests__/fixtures/stripe.fixtures";

describe("BillingAdminService", () => {
  let service: BillingAdminService;
  let stripeProductRepository: jest.Mocked<StripeProductRepository>;
  let stripePriceRepository: jest.Mocked<StripePriceRepository>;
  let stripeProductService: jest.Mocked<StripeProductService>;
  let jsonApiService: jest.Mocked<JsonApiService>;

  // Test data constants
  const MOCK_STRIPE_PRODUCT: StripeProduct = {
    id: "stripe_product_123",
    stripeProductId: TEST_IDS.productId,
    name: "Test Product",
    description: "Test Description",
    active: true,
    metadata: JSON.stringify({ key: "value" }),
  };

  const MOCK_STRIPE_PRICE: StripePrice = {
    id: "stripe_price_123",
    stripePriceId: TEST_IDS.priceId,
    active: true,
    currency: "usd",
    unitAmount: 999,
    priceType: "recurring",
    recurringInterval: "month",
    recurringIntervalCount: 1,
    recurringUsageType: "licensed",
    nickname: "Monthly Plan",
    lookupKey: "monthly_plan",
    metadata: JSON.stringify({ tier: "premium" }),
    product: MOCK_STRIPE_PRODUCT,
  };

  const MOCK_JSON_API_SINGLE = {
    data: {
      type: "stripe-products",
      id: MOCK_STRIPE_PRODUCT.id,
      attributes: MOCK_STRIPE_PRODUCT,
    },
  };

  const MOCK_JSON_API_LIST = {
    data: [
      {
        type: "stripe-products",
        id: MOCK_STRIPE_PRODUCT.id,
        attributes: MOCK_STRIPE_PRODUCT,
      },
    ],
    meta: {
      pagination: {
        total: 1,
        count: 1,
        per_page: 10,
        current_page: 1,
        total_pages: 1,
      },
    },
  };

  beforeEach(async () => {
    const mockStripeProductRepository = {
      findAll: jest.fn(),
      findById: jest.fn(),
      findByStripeProductId: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateByStripeProductId: jest.fn(),
    };

    const mockStripePriceRepository = {
      findAll: jest.fn(),
      findById: jest.fn(),
      findByStripePriceId: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateByStripePriceId: jest.fn(),
    };

    const mockStripeProductService = {
      createProduct: jest.fn(),
      updateProduct: jest.fn(),
      archiveProduct: jest.fn(),
      retrieveProduct: jest.fn(),
      createPrice: jest.fn(),
      updatePrice: jest.fn(),
      retrievePrice: jest.fn(),
    };

    const mockJsonApiService = {
      buildSingle: jest.fn(),
      buildList: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingAdminService,
        {
          provide: StripeProductRepository,
          useValue: mockStripeProductRepository,
        },
        {
          provide: StripePriceRepository,
          useValue: mockStripePriceRepository,
        },
        {
          provide: StripeProductService,
          useValue: mockStripeProductService,
        },
        {
          provide: JsonApiService,
          useValue: mockJsonApiService,
        },
      ],
    }).compile();

    service = module.get<BillingAdminService>(BillingAdminService);
    stripeProductRepository = module.get(StripeProductRepository) as jest.Mocked<StripeProductRepository>;
    stripePriceRepository = module.get(StripePriceRepository) as jest.Mocked<StripePriceRepository>;
    stripeProductService = module.get(StripeProductService) as jest.Mocked<StripeProductService>;
    jsonApiService = module.get(JsonApiService) as jest.Mocked<JsonApiService>;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ========== PRODUCTS ==========

  describe("listProducts", () => {
    it("should list all products without active filter", async () => {
      const query = { page: { number: 1, size: 10 } };
      stripeProductRepository.findAll.mockResolvedValue([MOCK_STRIPE_PRODUCT]);
      jsonApiService.buildList.mockReturnValue(MOCK_JSON_API_LIST);

      const result = await service.listProducts({ query });

      expect(stripeProductRepository.findAll).toHaveBeenCalledWith({
        active: undefined,
      });
      expect(jsonApiService.buildList).toHaveBeenCalledWith(
        expect.any(Object),
        [MOCK_STRIPE_PRODUCT],
        expect.any(Object),
      );
      expect(result).toEqual(MOCK_JSON_API_LIST);
    });

    it("should list products with active filter true", async () => {
      const query = { page: { number: 1, size: 10 } };
      stripeProductRepository.findAll.mockResolvedValue([MOCK_STRIPE_PRODUCT]);
      jsonApiService.buildList.mockReturnValue(MOCK_JSON_API_LIST);

      await service.listProducts({ query, active: true });

      expect(stripeProductRepository.findAll).toHaveBeenCalledWith({
        active: true,
      });
    });

    it("should list products with active filter false", async () => {
      const query = { page: { number: 1, size: 10 } };
      stripeProductRepository.findAll.mockResolvedValue([]);
      jsonApiService.buildList.mockReturnValue({ data: [], meta: {} });

      await service.listProducts({ query, active: false });

      expect(stripeProductRepository.findAll).toHaveBeenCalledWith({
        active: false,
      });
    });

    it("should return paginated results", async () => {
      const query = { page: { number: 2, size: 5 } };
      stripeProductRepository.findAll.mockResolvedValue([MOCK_STRIPE_PRODUCT]);
      jsonApiService.buildList.mockReturnValue(MOCK_JSON_API_LIST);

      const result = await service.listProducts({ query });

      expect(jsonApiService.buildList).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Array),
        expect.objectContaining({}),
      );
      expect(result).toEqual(MOCK_JSON_API_LIST);
    });
  });

  describe("getProduct", () => {
    it("should return product when found", async () => {
      stripeProductRepository.findById.mockResolvedValue(MOCK_STRIPE_PRODUCT);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_SINGLE);

      const result = await service.getProduct({ id: "stripe_product_123" });

      expect(stripeProductRepository.findById).toHaveBeenCalledWith({
        id: "stripe_product_123",
      });
      expect(jsonApiService.buildSingle).toHaveBeenCalledWith(expect.any(Object), MOCK_STRIPE_PRODUCT);
      expect(result).toEqual(MOCK_JSON_API_SINGLE);
    });

    it("should throw NOT_FOUND when product not found", async () => {
      stripeProductRepository.findById.mockResolvedValue(null);

      await expect(service.getProduct({ id: "nonexistent" })).rejects.toThrow(
        new HttpException("Product not found", HttpStatus.NOT_FOUND),
      );

      expect(jsonApiService.buildSingle).not.toHaveBeenCalled();
    });

    it("should throw NOT_FOUND with correct status code", async () => {
      stripeProductRepository.findById.mockResolvedValue(null);

      try {
        await service.getProduct({ id: "nonexistent" });
        fail("Should have thrown HttpException");
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(HttpStatus.NOT_FOUND);
        expect((error as HttpException).message).toBe("Product not found");
      }
    });
  });

  describe("createProduct", () => {
    it("should create product successfully with metadata", async () => {
      const params = {
        name: "New Product",
        description: "New Description",
        metadata: { key: "value", tier: "premium" },
      };
      const stripeProduct: Stripe.Product = {
        ...MOCK_PRODUCT,
        id: "prod_new_123",
        name: params.name,
        description: params.description,
        active: true,
        metadata: params.metadata,
      };
      stripeProductService.createProduct.mockResolvedValue(stripeProduct);
      stripeProductRepository.create.mockResolvedValue(MOCK_STRIPE_PRODUCT);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_SINGLE);

      const result = await service.createProduct(params);

      expect(stripeProductService.createProduct).toHaveBeenCalledWith({
        name: params.name,
        description: params.description,
        metadata: params.metadata,
      });
      expect(stripeProductRepository.create).toHaveBeenCalledWith({
        stripeProductId: stripeProduct.id,
        name: params.name,
        description: params.description,
        active: true,
        metadata: JSON.stringify(params.metadata),
      });
      expect(result).toEqual(MOCK_JSON_API_SINGLE);
    });

    it("should create product without metadata", async () => {
      const params = {
        name: "New Product",
        description: "New Description",
      };
      const stripeProduct: Stripe.Product = {
        ...MOCK_PRODUCT,
        id: "prod_new_123",
        name: params.name,
        description: params.description,
        active: true,
      };
      stripeProductService.createProduct.mockResolvedValue(stripeProduct);
      stripeProductRepository.create.mockResolvedValue(MOCK_STRIPE_PRODUCT);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_SINGLE);

      await service.createProduct(params);

      expect(stripeProductRepository.create).toHaveBeenCalledWith({
        stripeProductId: stripeProduct.id,
        name: params.name,
        description: params.description,
        active: true,
        metadata: undefined,
      });
    });

    it("should JSON.stringify metadata when creating", async () => {
      const params = {
        name: "Test Product",
        metadata: { complex: "data", nested: "value" },
      };
      const stripeProduct: Stripe.Product = {
        ...MOCK_PRODUCT,
        id: "prod_new_123",
        active: false,
      };
      stripeProductService.createProduct.mockResolvedValue(stripeProduct);
      stripeProductRepository.create.mockResolvedValue(MOCK_STRIPE_PRODUCT);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_SINGLE);

      await service.createProduct(params);

      expect(stripeProductRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: '{"complex":"data","nested":"value"}',
        }),
      );
    });

    it("should use active from Stripe response", async () => {
      const params = {
        name: "Test Product",
      };
      const stripeProduct: Stripe.Product = {
        ...MOCK_PRODUCT,
        id: "prod_new_123",
        active: false,
      };
      stripeProductService.createProduct.mockResolvedValue(stripeProduct);
      stripeProductRepository.create.mockResolvedValue(MOCK_STRIPE_PRODUCT);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_SINGLE);

      await service.createProduct(params);

      expect(stripeProductRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          active: false,
        }),
      );
    });

    it("should create in Stripe before database", async () => {
      const callOrder: string[] = [];
      const params = {
        name: "Test Product",
      };
      const stripeProduct: Stripe.Product = {
        ...MOCK_PRODUCT,
        id: "prod_new_123",
        active: true,
      };
      stripeProductService.createProduct.mockImplementation(async () => {
        callOrder.push("stripe");
        return stripeProduct;
      });
      stripeProductRepository.create.mockImplementation(async () => {
        callOrder.push("database");
        return MOCK_STRIPE_PRODUCT;
      });
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_SINGLE);

      await service.createProduct(params);

      expect(callOrder).toEqual(["stripe", "database"]);
    });
  });

  describe("updateProduct", () => {
    it("should update product successfully with all fields", async () => {
      const params = {
        id: "stripe_product_123",
        name: "Updated Name",
        description: "Updated Description",
        metadata: { updated: "true" },
      };
      stripeProductRepository.findById.mockResolvedValue(MOCK_STRIPE_PRODUCT);
      stripeProductService.updateProduct.mockResolvedValue(MOCK_PRODUCT);
      stripeProductRepository.update.mockResolvedValue({
        ...MOCK_STRIPE_PRODUCT,
        ...params,
        metadata: JSON.stringify(params.metadata),
      });
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_SINGLE);

      const result = await service.updateProduct(params);

      expect(stripeProductRepository.findById).toHaveBeenCalledWith({
        id: params.id,
      });
      expect(stripeProductService.updateProduct).toHaveBeenCalledWith({
        productId: MOCK_STRIPE_PRODUCT.stripeProductId,
        name: params.name,
        description: params.description,
        metadata: params.metadata,
      });
      expect(stripeProductRepository.update).toHaveBeenCalledWith({
        id: params.id,
        name: params.name,
        description: params.description,
        metadata: JSON.stringify(params.metadata),
      });
      expect(result).toEqual(MOCK_JSON_API_SINGLE);
    });

    it("should throw NOT_FOUND when product does not exist", async () => {
      stripeProductRepository.findById.mockResolvedValue(null);

      await expect(
        service.updateProduct({
          id: "nonexistent",
          name: "Updated Name",
        }),
      ).rejects.toThrow(new HttpException("Product not found", HttpStatus.NOT_FOUND));

      expect(stripeProductService.updateProduct).not.toHaveBeenCalled();
      expect(stripeProductRepository.update).not.toHaveBeenCalled();
    });

    it("should JSON.stringify metadata when updating", async () => {
      const params = {
        id: "stripe_product_123",
        metadata: { key: "updated" },
      };
      stripeProductRepository.findById.mockResolvedValue(MOCK_STRIPE_PRODUCT);
      stripeProductService.updateProduct.mockResolvedValue(MOCK_PRODUCT);
      stripeProductRepository.update.mockResolvedValue(MOCK_STRIPE_PRODUCT);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_SINGLE);

      await service.updateProduct(params);

      expect(stripeProductRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: '{"key":"updated"}',
        }),
      );
    });

    it("should update Stripe before database", async () => {
      const callOrder: string[] = [];
      const params = {
        id: "stripe_product_123",
        name: "Updated Name",
      };
      stripeProductRepository.findById.mockResolvedValue(MOCK_STRIPE_PRODUCT);
      stripeProductService.updateProduct.mockImplementation(async () => {
        callOrder.push("stripe");
        return MOCK_PRODUCT;
      });
      stripeProductRepository.update.mockImplementation(async () => {
        callOrder.push("database");
        return MOCK_STRIPE_PRODUCT;
      });
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_SINGLE);

      await service.updateProduct(params);

      expect(callOrder).toEqual(["stripe", "database"]);
    });

    it("should not update database if Stripe update fails", async () => {
      const params = {
        id: "stripe_product_123",
        name: "Updated Name",
      };
      stripeProductRepository.findById.mockResolvedValue(MOCK_STRIPE_PRODUCT);
      const stripeError = new Error("Stripe update failed");
      stripeProductService.updateProduct.mockRejectedValue(stripeError);

      await expect(service.updateProduct(params)).rejects.toThrow("Stripe update failed");

      expect(stripeProductRepository.update).not.toHaveBeenCalled();
    });
  });

  describe("archiveProduct", () => {
    it("should archive product successfully", async () => {
      stripeProductRepository.findById.mockResolvedValue(MOCK_STRIPE_PRODUCT);
      stripeProductService.archiveProduct.mockResolvedValue(MOCK_PRODUCT);
      stripeProductRepository.update.mockResolvedValue({
        ...MOCK_STRIPE_PRODUCT,
        active: false,
      });

      await service.archiveProduct({ id: "stripe_product_123" });

      expect(stripeProductRepository.findById).toHaveBeenCalledWith({
        id: "stripe_product_123",
      });
      expect(stripeProductService.archiveProduct).toHaveBeenCalledWith(MOCK_STRIPE_PRODUCT.stripeProductId);
      expect(stripeProductRepository.update).toHaveBeenCalledWith({
        id: "stripe_product_123",
        active: false,
      });
    });

    it("should throw NOT_FOUND when product does not exist", async () => {
      stripeProductRepository.findById.mockResolvedValue(null);

      await expect(service.archiveProduct({ id: "nonexistent" })).rejects.toThrow(
        new HttpException("Product not found", HttpStatus.NOT_FOUND),
      );

      expect(stripeProductService.archiveProduct).not.toHaveBeenCalled();
      expect(stripeProductRepository.update).not.toHaveBeenCalled();
    });

    it("should archive in Stripe before database", async () => {
      const callOrder: string[] = [];
      stripeProductRepository.findById.mockResolvedValue(MOCK_STRIPE_PRODUCT);
      stripeProductService.archiveProduct.mockImplementation(async () => {
        callOrder.push("stripe");
        return MOCK_PRODUCT;
      });
      stripeProductRepository.update.mockImplementation(async () => {
        callOrder.push("database");
        return { ...MOCK_STRIPE_PRODUCT, active: false };
      });

      await service.archiveProduct({ id: "stripe_product_123" });

      expect(callOrder).toEqual(["stripe", "database"]);
    });

    it("should set active to false in database", async () => {
      stripeProductRepository.findById.mockResolvedValue(MOCK_STRIPE_PRODUCT);
      stripeProductService.archiveProduct.mockResolvedValue(MOCK_PRODUCT);
      stripeProductRepository.update.mockResolvedValue({
        ...MOCK_STRIPE_PRODUCT,
        active: false,
      });

      await service.archiveProduct({ id: "stripe_product_123" });

      expect(stripeProductRepository.update).toHaveBeenCalledWith({
        id: "stripe_product_123",
        active: false,
      });
    });
  });

  // ========== PRICES ==========

  describe("listPrices", () => {
    const MOCK_JSON_API_PRICE_LIST = {
      data: [
        {
          type: "stripe-prices",
          id: MOCK_STRIPE_PRICE.id,
          attributes: MOCK_STRIPE_PRICE,
        },
      ],
      meta: {
        pagination: {
          total: 1,
          count: 1,
          per_page: 10,
          current_page: 1,
          total_pages: 1,
        },
      },
    };

    it("should list all prices without filters", async () => {
      const query = { page: { number: 1, size: 10 } };
      stripePriceRepository.findAll.mockResolvedValue([MOCK_STRIPE_PRICE]);
      jsonApiService.buildList.mockReturnValue(MOCK_JSON_API_PRICE_LIST);

      const result = await service.listPrices({ query });

      expect(stripePriceRepository.findAll).toHaveBeenCalledWith({
        productId: undefined,
        active: undefined,
      });
      expect(jsonApiService.buildList).toHaveBeenCalledWith(
        expect.any(Object),
        [MOCK_STRIPE_PRICE],
        expect.any(Object),
      );
      expect(result).toEqual(MOCK_JSON_API_PRICE_LIST);
    });

    it("should list prices with productId filter", async () => {
      const query = { page: { number: 1, size: 10 } };
      stripePriceRepository.findAll.mockResolvedValue([MOCK_STRIPE_PRICE]);
      jsonApiService.buildList.mockReturnValue(MOCK_JSON_API_PRICE_LIST);

      await service.listPrices({
        query,
        productId: "stripe_product_123",
      });

      expect(stripePriceRepository.findAll).toHaveBeenCalledWith({
        productId: "stripe_product_123",
        active: undefined,
      });
    });

    it("should list prices with active filter", async () => {
      const query = { page: { number: 1, size: 10 } };
      stripePriceRepository.findAll.mockResolvedValue([MOCK_STRIPE_PRICE]);
      jsonApiService.buildList.mockReturnValue(MOCK_JSON_API_PRICE_LIST);

      await service.listPrices({ query, active: true });

      expect(stripePriceRepository.findAll).toHaveBeenCalledWith({
        productId: undefined,
        active: true,
      });
    });

    it("should list prices with both productId and active filters", async () => {
      const query = { page: { number: 1, size: 10 } };
      stripePriceRepository.findAll.mockResolvedValue([MOCK_STRIPE_PRICE]);
      jsonApiService.buildList.mockReturnValue(MOCK_JSON_API_PRICE_LIST);

      await service.listPrices({
        query,
        productId: "stripe_product_123",
        active: false,
      });

      expect(stripePriceRepository.findAll).toHaveBeenCalledWith({
        productId: "stripe_product_123",
        active: false,
      });
    });
  });

  describe("getPrice", () => {
    const MOCK_JSON_API_PRICE_SINGLE = {
      data: {
        type: "stripe-prices",
        id: MOCK_STRIPE_PRICE.id,
        attributes: MOCK_STRIPE_PRICE,
      },
    };

    it("should return price when found", async () => {
      stripePriceRepository.findById.mockResolvedValue(MOCK_STRIPE_PRICE);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_PRICE_SINGLE);

      const result = await service.getPrice({ id: "stripe_price_123" });

      expect(stripePriceRepository.findById).toHaveBeenCalledWith({
        id: "stripe_price_123",
      });
      expect(jsonApiService.buildSingle).toHaveBeenCalledWith(expect.any(Object), MOCK_STRIPE_PRICE);
      expect(result).toEqual(MOCK_JSON_API_PRICE_SINGLE);
    });

    it("should throw NOT_FOUND when price not found", async () => {
      stripePriceRepository.findById.mockResolvedValue(null);

      await expect(service.getPrice({ id: "nonexistent" })).rejects.toThrow(
        new HttpException("Price not found", HttpStatus.NOT_FOUND),
      );

      expect(jsonApiService.buildSingle).not.toHaveBeenCalled();
    });

    it("should throw NOT_FOUND with correct status code", async () => {
      stripePriceRepository.findById.mockResolvedValue(null);

      try {
        await service.getPrice({ id: "nonexistent" });
        fail("Should have thrown HttpException");
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(HttpStatus.NOT_FOUND);
        expect((error as HttpException).message).toBe("Price not found");
      }
    });
  });

  describe("createPrice", () => {
    const MOCK_STRIPE_PRICE_RESPONSE: Stripe.Price = {
      id: "price_new_123",
      object: "price",
      active: true,
      billing_scheme: "per_unit",
      created: Math.floor(Date.now() / 1000),
      currency: "usd",
      currency_options: null,
      custom_unit_amount: null,
      livemode: false,
      lookup_key: "test_lookup",
      metadata: { tier: "premium" },
      nickname: "Test Price",
      product: TEST_IDS.productId,
      recurring: {
        interval: "month",
        interval_count: 1,
        meter: null,
        trial_period_days: null,
        usage_type: "licensed",
      },
      tax_behavior: "unspecified",
      tiers_mode: null,
      transform_quantity: null,
      type: "recurring",
      unit_amount: 999,
      unit_amount_decimal: "999",
    };

    it("should create recurring price successfully", async () => {
      const params = {
        productId: "stripe_product_123",
        unitAmount: 999,
        currency: "usd",
        nickname: "Monthly Plan",
        lookupKey: "monthly_plan",
        recurring: {
          interval: "month" as const,
          intervalCount: 1,
        },
        metadata: { tier: "premium" },
      };
      stripeProductRepository.findById.mockResolvedValue(MOCK_STRIPE_PRODUCT);
      stripeProductService.createPrice.mockResolvedValue(MOCK_STRIPE_PRICE_RESPONSE);
      stripePriceRepository.create.mockResolvedValue(MOCK_STRIPE_PRICE);
      jsonApiService.buildSingle.mockReturnValue({ data: MOCK_STRIPE_PRICE });

      const result = await service.createPrice(params);

      expect(stripeProductRepository.findById).toHaveBeenCalledWith({
        id: params.productId,
      });
      expect(stripeProductService.createPrice).toHaveBeenCalledWith({
        productId: MOCK_STRIPE_PRODUCT.stripeProductId,
        unitAmount: params.unitAmount,
        currency: params.currency,
        nickname: params.nickname,
        lookupKey: params.lookupKey,
        recurring: params.recurring,
        metadata: params.metadata,
      });
      expect(stripePriceRepository.create).toHaveBeenCalledWith({
        productId: params.productId,
        stripePriceId: MOCK_STRIPE_PRICE_RESPONSE.id,
        active: MOCK_STRIPE_PRICE_RESPONSE.active,
        currency: params.currency,
        unitAmount: params.unitAmount,
        priceType: "recurring",
        recurringInterval: params.recurring.interval,
        recurringIntervalCount: params.recurring.intervalCount,
        recurringUsageType: "licensed",
        nickname: params.nickname,
        lookupKey: params.lookupKey,
        metadata: JSON.stringify(params.metadata),
      });
      expect(result).toEqual({ data: MOCK_STRIPE_PRICE });
    });

    it("should create one_time price when recurring is not provided", async () => {
      const params = {
        productId: "stripe_product_123",
        unitAmount: 1999,
        currency: "usd",
        nickname: "One-time Purchase",
      };
      const oneTimePrice: Stripe.Price = {
        ...MOCK_STRIPE_PRICE_RESPONSE,
        type: "one_time",
        recurring: null,
      };
      stripeProductRepository.findById.mockResolvedValue(MOCK_STRIPE_PRODUCT);
      stripeProductService.createPrice.mockResolvedValue(oneTimePrice);
      stripePriceRepository.create.mockResolvedValue(MOCK_STRIPE_PRICE);
      jsonApiService.buildSingle.mockReturnValue({ data: MOCK_STRIPE_PRICE });

      await service.createPrice(params);

      expect(stripePriceRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          priceType: "one_time",
          recurringInterval: undefined,
          recurringIntervalCount: undefined,
          recurringUsageType: "licensed",
        }),
      );
    });

    it("should determine recurringUsageType as metered when meter exists", async () => {
      const params = {
        productId: "stripe_product_123",
        unitAmount: 999,
        currency: "usd",
        recurring: {
          interval: "month" as const,
          intervalCount: 1,
          meter: "meter_test_123",
        },
      };
      stripeProductRepository.findById.mockResolvedValue(MOCK_STRIPE_PRODUCT);
      stripeProductService.createPrice.mockResolvedValue(MOCK_STRIPE_PRICE_RESPONSE);
      stripePriceRepository.create.mockResolvedValue(MOCK_STRIPE_PRICE);
      jsonApiService.buildSingle.mockReturnValue({ data: MOCK_STRIPE_PRICE });

      await service.createPrice(params);

      expect(stripePriceRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          recurringUsageType: "metered",
        }),
      );
    });

    it("should determine recurringUsageType as licensed when meter does not exist", async () => {
      const params = {
        productId: "stripe_product_123",
        unitAmount: 999,
        currency: "usd",
        recurring: {
          interval: "month" as const,
          intervalCount: 1,
        },
      };
      stripeProductRepository.findById.mockResolvedValue(MOCK_STRIPE_PRODUCT);
      stripeProductService.createPrice.mockResolvedValue(MOCK_STRIPE_PRICE_RESPONSE);
      stripePriceRepository.create.mockResolvedValue(MOCK_STRIPE_PRICE);
      jsonApiService.buildSingle.mockReturnValue({ data: MOCK_STRIPE_PRICE });

      await service.createPrice(params);

      expect(stripePriceRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          recurringUsageType: "licensed",
        }),
      );
    });

    it("should throw NOT_FOUND when product does not exist", async () => {
      stripeProductRepository.findById.mockResolvedValue(null);

      await expect(
        service.createPrice({
          productId: "nonexistent",
          unitAmount: 999,
          currency: "usd",
        }),
      ).rejects.toThrow(new HttpException("Product not found", HttpStatus.NOT_FOUND));

      expect(stripeProductService.createPrice).not.toHaveBeenCalled();
      expect(stripePriceRepository.create).not.toHaveBeenCalled();
    });

    it("should JSON.stringify metadata when creating", async () => {
      const params = {
        productId: "stripe_product_123",
        unitAmount: 999,
        currency: "usd",
        metadata: { complex: "data", nested: "value" },
      };
      stripeProductRepository.findById.mockResolvedValue(MOCK_STRIPE_PRODUCT);
      stripeProductService.createPrice.mockResolvedValue(MOCK_STRIPE_PRICE_RESPONSE);
      stripePriceRepository.create.mockResolvedValue(MOCK_STRIPE_PRICE);
      jsonApiService.buildSingle.mockReturnValue({ data: MOCK_STRIPE_PRICE });

      await service.createPrice(params);

      expect(stripePriceRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: '{"complex":"data","nested":"value"}',
        }),
      );
    });

    it("should handle price without metadata", async () => {
      const params = {
        productId: "stripe_product_123",
        unitAmount: 999,
        currency: "usd",
      };
      stripeProductRepository.findById.mockResolvedValue(MOCK_STRIPE_PRODUCT);
      stripeProductService.createPrice.mockResolvedValue(MOCK_STRIPE_PRICE_RESPONSE);
      stripePriceRepository.create.mockResolvedValue(MOCK_STRIPE_PRICE);
      jsonApiService.buildSingle.mockReturnValue({ data: MOCK_STRIPE_PRICE });

      await service.createPrice(params);

      expect(stripePriceRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: undefined,
        }),
      );
    });
  });

  describe("updatePrice", () => {
    it("should update price nickname and metadata", async () => {
      const params = {
        id: "stripe_price_123",
        nickname: "Updated Plan",
        metadata: { updated: "true" },
      };
      stripePriceRepository.findById.mockResolvedValue(MOCK_STRIPE_PRICE);
      stripeProductService.updatePrice.mockResolvedValue({} as Stripe.Price);
      stripePriceRepository.update.mockResolvedValue({
        ...MOCK_STRIPE_PRICE,
        ...params,
        metadata: JSON.stringify(params.metadata),
      });
      jsonApiService.buildSingle.mockReturnValue({ data: MOCK_STRIPE_PRICE });

      const result = await service.updatePrice(params);

      expect(stripePriceRepository.findById).toHaveBeenCalledWith({
        id: params.id,
      });
      expect(stripeProductService.updatePrice).toHaveBeenCalledWith({
        priceId: MOCK_STRIPE_PRICE.stripePriceId,
        nickname: params.nickname,
        metadata: params.metadata,
      });
      expect(stripePriceRepository.update).toHaveBeenCalledWith({
        id: params.id,
        nickname: params.nickname,
        metadata: JSON.stringify(params.metadata),
      });
      expect(result).toEqual({ data: MOCK_STRIPE_PRICE });
    });

    it("should throw NOT_FOUND when price does not exist", async () => {
      stripePriceRepository.findById.mockResolvedValue(null);

      await expect(
        service.updatePrice({
          id: "nonexistent",
          nickname: "Updated",
        }),
      ).rejects.toThrow(new HttpException("Price not found", HttpStatus.NOT_FOUND));

      expect(stripeProductService.updatePrice).not.toHaveBeenCalled();
      expect(stripePriceRepository.update).not.toHaveBeenCalled();
    });

    it("should JSON.stringify metadata when updating", async () => {
      const params = {
        id: "stripe_price_123",
        metadata: { key: "updated", value: "test" },
      };
      stripePriceRepository.findById.mockResolvedValue(MOCK_STRIPE_PRICE);
      stripeProductService.updatePrice.mockResolvedValue({} as Stripe.Price);
      stripePriceRepository.update.mockResolvedValue(MOCK_STRIPE_PRICE);
      jsonApiService.buildSingle.mockReturnValue({ data: MOCK_STRIPE_PRICE });

      await service.updatePrice(params);

      expect(stripePriceRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: '{"key":"updated","value":"test"}',
        }),
      );
    });

    it("should update Stripe before database", async () => {
      const callOrder: string[] = [];
      const params = {
        id: "stripe_price_123",
        nickname: "Updated",
      };
      stripePriceRepository.findById.mockResolvedValue(MOCK_STRIPE_PRICE);
      stripeProductService.updatePrice.mockImplementation(async () => {
        callOrder.push("stripe");
        return {} as Stripe.Price;
      });
      stripePriceRepository.update.mockImplementation(async () => {
        callOrder.push("database");
        return MOCK_STRIPE_PRICE;
      });
      jsonApiService.buildSingle.mockReturnValue({ data: MOCK_STRIPE_PRICE });

      await service.updatePrice(params);

      expect(callOrder).toEqual(["stripe", "database"]);
    });
  });

  // ========== SYNC OPERATIONS ==========

  describe("syncProductFromStripe", () => {
    it("should update existing product by stripeProductId", async () => {
      const stripeProduct: Stripe.Product = {
        ...MOCK_PRODUCT,
        id: "prod_stripe_123",
        name: "Updated Product",
        description: "Updated Description",
        active: false,
        metadata: { synced: "true" },
      };
      stripeProductService.retrieveProduct.mockResolvedValue(stripeProduct);
      stripeProductRepository.findByStripeProductId.mockResolvedValue(MOCK_STRIPE_PRODUCT);
      stripeProductRepository.updateByStripeProductId.mockResolvedValue(MOCK_STRIPE_PRODUCT);

      await service.syncProductFromStripe({ stripeProductId: "prod_stripe_123" });

      expect(stripeProductService.retrieveProduct).toHaveBeenCalledWith("prod_stripe_123");
      expect(stripeProductRepository.findByStripeProductId).toHaveBeenCalledWith({
        stripeProductId: "prod_stripe_123",
      });
      expect(stripeProductRepository.updateByStripeProductId).toHaveBeenCalledWith({
        stripeProductId: "prod_stripe_123",
        name: stripeProduct.name,
        description: stripeProduct.description,
        active: false,
        metadata: JSON.stringify(stripeProduct.metadata),
      });
      expect(stripeProductRepository.create).not.toHaveBeenCalled();
    });

    it("should create new product if does not exist", async () => {
      const stripeProduct: Stripe.Product = {
        ...MOCK_PRODUCT,
        id: "prod_new_123",
        name: "New Product",
        description: "New Description",
        active: true,
        metadata: { new: "product" },
      };
      stripeProductService.retrieveProduct.mockResolvedValue(stripeProduct);
      stripeProductRepository.findByStripeProductId.mockResolvedValue(null);
      stripeProductRepository.create.mockResolvedValue(MOCK_STRIPE_PRODUCT);

      await service.syncProductFromStripe({ stripeProductId: "prod_new_123" });

      expect(stripeProductRepository.findByStripeProductId).toHaveBeenCalledWith({
        stripeProductId: "prod_new_123",
      });
      expect(stripeProductRepository.create).toHaveBeenCalledWith({
        stripeProductId: stripeProduct.id,
        name: stripeProduct.name,
        description: stripeProduct.description,
        active: true,
        metadata: JSON.stringify(stripeProduct.metadata),
      });
      expect(stripeProductRepository.updateByStripeProductId).not.toHaveBeenCalled();
    });

    it("should JSON.stringify metadata when syncing", async () => {
      const stripeProduct: Stripe.Product = {
        ...MOCK_PRODUCT,
        metadata: { complex: "data", nested: "value" },
      };
      stripeProductService.retrieveProduct.mockResolvedValue(stripeProduct);
      stripeProductRepository.findByStripeProductId.mockResolvedValue(MOCK_STRIPE_PRODUCT);
      stripeProductRepository.updateByStripeProductId.mockResolvedValue(MOCK_STRIPE_PRODUCT);

      await service.syncProductFromStripe({ stripeProductId: stripeProduct.id });

      expect(stripeProductRepository.updateByStripeProductId).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: '{"complex":"data","nested":"value"}',
        }),
      );
    });

    it("should handle null description", async () => {
      const stripeProduct: Stripe.Product = {
        ...MOCK_PRODUCT,
        description: null,
      };
      stripeProductService.retrieveProduct.mockResolvedValue(stripeProduct);
      stripeProductRepository.findByStripeProductId.mockResolvedValue(MOCK_STRIPE_PRODUCT);
      stripeProductRepository.updateByStripeProductId.mockResolvedValue(MOCK_STRIPE_PRODUCT);

      await service.syncProductFromStripe({ stripeProductId: stripeProduct.id });

      expect(stripeProductRepository.updateByStripeProductId).toHaveBeenCalledWith(
        expect.objectContaining({
          description: undefined,
        }),
      );
    });

    it("should handle product without metadata", async () => {
      const stripeProduct: Stripe.Product = {
        ...MOCK_PRODUCT,
        metadata: {},
      };
      stripeProductService.retrieveProduct.mockResolvedValue(stripeProduct);
      stripeProductRepository.findByStripeProductId.mockResolvedValue(null);
      stripeProductRepository.create.mockResolvedValue(MOCK_STRIPE_PRODUCT);

      await service.syncProductFromStripe({ stripeProductId: stripeProduct.id });

      // Empty object {} is truthy, so it gets stringified to "{}"
      expect(stripeProductRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: "{}",
        }),
      );
    });
  });

  describe("syncPriceFromStripe", () => {
    const MOCK_STRIPE_PRICE_FROM_API: Stripe.Price = {
      id: "price_stripe_123",
      object: "price",
      active: true,
      billing_scheme: "per_unit",
      created: Math.floor(Date.now() / 1000),
      currency: "usd",
      currency_options: null,
      custom_unit_amount: null,
      livemode: false,
      lookup_key: "test_lookup",
      metadata: { tier: "premium" },
      nickname: "Test Price",
      product: TEST_IDS.productId,
      recurring: {
        interval: "month",
        interval_count: 1,
        meter: null,
        trial_period_days: null,
        usage_type: "licensed",
      },
      tax_behavior: "unspecified",
      tiers_mode: null,
      transform_quantity: null,
      type: "recurring",
      unit_amount: 999,
      unit_amount_decimal: "999",
    };

    it("should update existing price by stripePriceId", async () => {
      const stripePrice: Stripe.Price = {
        ...MOCK_STRIPE_PRICE_FROM_API,
        id: "price_existing_123",
        active: false,
        nickname: "Updated Price",
        metadata: { updated: "true" },
      };
      stripeProductService.retrievePrice.mockResolvedValue(stripePrice);
      stripePriceRepository.findByStripePriceId.mockResolvedValue(MOCK_STRIPE_PRICE);
      stripePriceRepository.updateByStripePriceId.mockResolvedValue(MOCK_STRIPE_PRICE);

      await service.syncPriceFromStripe({ stripePriceId: "price_existing_123" });

      expect(stripeProductService.retrievePrice).toHaveBeenCalledWith("price_existing_123");
      expect(stripePriceRepository.findByStripePriceId).toHaveBeenCalledWith({
        stripePriceId: "price_existing_123",
      });
      expect(stripePriceRepository.updateByStripePriceId).toHaveBeenCalledWith({
        stripePriceId: "price_existing_123",
        active: false,
        nickname: "Updated Price",
        metadata: JSON.stringify(stripePrice.metadata),
      });
      expect(stripePriceRepository.create).not.toHaveBeenCalled();
    });

    it("should create new price if does not exist", async () => {
      const stripePrice: Stripe.Price = {
        ...MOCK_STRIPE_PRICE_FROM_API,
        id: "price_new_123",
      };
      stripeProductService.retrievePrice.mockResolvedValue(stripePrice);
      stripePriceRepository.findByStripePriceId.mockResolvedValue(null);
      stripeProductRepository.findByStripeProductId.mockResolvedValue(MOCK_STRIPE_PRODUCT);
      stripePriceRepository.create.mockResolvedValue(MOCK_STRIPE_PRICE);

      await service.syncPriceFromStripe({ stripePriceId: "price_new_123" });

      expect(stripePriceRepository.findByStripePriceId).toHaveBeenCalledWith({
        stripePriceId: "price_new_123",
      });
      expect(stripeProductRepository.findByStripeProductId).toHaveBeenCalledWith({
        stripeProductId: TEST_IDS.productId,
      });
      expect(stripePriceRepository.create).toHaveBeenCalledWith({
        productId: MOCK_STRIPE_PRODUCT.id,
        stripePriceId: stripePrice.id,
        active: stripePrice.active,
        currency: stripePrice.currency,
        unitAmount: stripePrice.unit_amount,
        priceType: "recurring",
        recurringInterval: "month",
        recurringIntervalCount: 1,
        recurringUsageType: "licensed",
        nickname: stripePrice.nickname,
        lookupKey: stripePrice.lookup_key,
        metadata: JSON.stringify(stripePrice.metadata),
      });
    });

    it("should auto-sync product if product does not exist", async () => {
      const stripePrice: Stripe.Price = {
        ...MOCK_STRIPE_PRICE_FROM_API,
        id: "price_new_123",
        product: "prod_not_synced_123",
      };
      stripeProductService.retrievePrice.mockResolvedValue(stripePrice);
      stripePriceRepository.findByStripePriceId.mockResolvedValue(null);
      stripeProductRepository.findByStripeProductId
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(MOCK_STRIPE_PRODUCT);
      stripeProductService.retrieveProduct.mockResolvedValue(MOCK_PRODUCT);
      stripeProductRepository.create.mockResolvedValue(MOCK_STRIPE_PRODUCT);
      stripePriceRepository.create.mockResolvedValue(MOCK_STRIPE_PRICE);

      await service.syncPriceFromStripe({ stripePriceId: "price_new_123" });

      expect(stripeProductRepository.findByStripeProductId).toHaveBeenNthCalledWith(1, {
        stripeProductId: "prod_not_synced_123",
      });
      expect(stripeProductService.retrieveProduct).toHaveBeenCalledWith("prod_not_synced_123");
      expect(stripeProductRepository.findByStripeProductId).toHaveBeenNthCalledWith(2, {
        stripeProductId: "prod_not_synced_123",
      });
    });

    it("should handle product as string", async () => {
      const stripePrice: Stripe.Price = {
        ...MOCK_STRIPE_PRICE_FROM_API,
        product: "prod_string_123",
      };
      stripeProductService.retrievePrice.mockResolvedValue(stripePrice);
      stripePriceRepository.findByStripePriceId.mockResolvedValue(null);
      stripeProductRepository.findByStripeProductId.mockResolvedValue(MOCK_STRIPE_PRODUCT);
      stripePriceRepository.create.mockResolvedValue(MOCK_STRIPE_PRICE);

      await service.syncPriceFromStripe({ stripePriceId: stripePrice.id });

      expect(stripeProductRepository.findByStripeProductId).toHaveBeenCalledWith({
        stripeProductId: "prod_string_123",
      });
    });

    it("should handle product as object", async () => {
      const stripePrice: Stripe.Price = {
        ...MOCK_STRIPE_PRICE_FROM_API,
        product: MOCK_PRODUCT,
      };
      stripeProductService.retrievePrice.mockResolvedValue(stripePrice);
      stripePriceRepository.findByStripePriceId.mockResolvedValue(null);
      stripeProductRepository.findByStripeProductId.mockResolvedValue(MOCK_STRIPE_PRODUCT);
      stripePriceRepository.create.mockResolvedValue(MOCK_STRIPE_PRICE);

      await service.syncPriceFromStripe({ stripePriceId: stripePrice.id });

      expect(stripeProductRepository.findByStripeProductId).toHaveBeenCalledWith({
        stripeProductId: MOCK_PRODUCT.id,
      });
    });

    it("should determine priceType as recurring when type is recurring", async () => {
      const stripePrice: Stripe.Price = {
        ...MOCK_STRIPE_PRICE_FROM_API,
        type: "recurring",
      };
      stripeProductService.retrievePrice.mockResolvedValue(stripePrice);
      stripePriceRepository.findByStripePriceId.mockResolvedValue(null);
      stripeProductRepository.findByStripeProductId.mockResolvedValue(MOCK_STRIPE_PRODUCT);
      stripePriceRepository.create.mockResolvedValue(MOCK_STRIPE_PRICE);

      await service.syncPriceFromStripe({ stripePriceId: stripePrice.id });

      expect(stripePriceRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          priceType: "recurring",
        }),
      );
    });

    it("should determine priceType as one_time when type is not recurring", async () => {
      const stripePrice: Stripe.Price = {
        ...MOCK_STRIPE_PRICE_FROM_API,
        type: "one_time",
        recurring: null,
      };
      stripeProductService.retrievePrice.mockResolvedValue(stripePrice);
      stripePriceRepository.findByStripePriceId.mockResolvedValue(null);
      stripeProductRepository.findByStripeProductId.mockResolvedValue(MOCK_STRIPE_PRODUCT);
      stripePriceRepository.create.mockResolvedValue(MOCK_STRIPE_PRICE);

      await service.syncPriceFromStripe({ stripePriceId: stripePrice.id });

      expect(stripePriceRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          priceType: "one_time",
        }),
      );
    });

    it("should determine recurringUsageType as metered when meter exists", async () => {
      const stripePrice: Stripe.Price = {
        ...MOCK_STRIPE_PRICE_FROM_API,
        recurring: {
          interval: "month",
          interval_count: 1,
          meter: "meter_test_123",
          trial_period_days: null,
          usage_type: "metered",
        },
      };
      stripeProductService.retrievePrice.mockResolvedValue(stripePrice);
      stripePriceRepository.findByStripePriceId.mockResolvedValue(null);
      stripeProductRepository.findByStripeProductId.mockResolvedValue(MOCK_STRIPE_PRODUCT);
      stripePriceRepository.create.mockResolvedValue(MOCK_STRIPE_PRICE);

      await service.syncPriceFromStripe({ stripePriceId: stripePrice.id });

      expect(stripePriceRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          recurringUsageType: "metered",
        }),
      );
    });

    it("should determine recurringUsageType as licensed when meter does not exist", async () => {
      const stripePrice: Stripe.Price = {
        ...MOCK_STRIPE_PRICE_FROM_API,
        recurring: {
          interval: "month",
          interval_count: 1,
          meter: null,
          trial_period_days: null,
          usage_type: "licensed",
        },
      };
      stripeProductService.retrievePrice.mockResolvedValue(stripePrice);
      stripePriceRepository.findByStripePriceId.mockResolvedValue(null);
      stripeProductRepository.findByStripeProductId.mockResolvedValue(MOCK_STRIPE_PRODUCT);
      stripePriceRepository.create.mockResolvedValue(MOCK_STRIPE_PRICE);

      await service.syncPriceFromStripe({ stripePriceId: stripePrice.id });

      expect(stripePriceRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          recurringUsageType: "licensed",
        }),
      );
    });

    it("should JSON.stringify metadata when syncing", async () => {
      const stripePrice: Stripe.Price = {
        ...MOCK_STRIPE_PRICE_FROM_API,
        metadata: { complex: "data", nested: "value" },
      };
      stripeProductService.retrievePrice.mockResolvedValue(stripePrice);
      stripePriceRepository.findByStripePriceId.mockResolvedValue(MOCK_STRIPE_PRICE);
      stripePriceRepository.updateByStripePriceId.mockResolvedValue(MOCK_STRIPE_PRICE);

      await service.syncPriceFromStripe({ stripePriceId: stripePrice.id });

      expect(stripePriceRepository.updateByStripePriceId).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: '{"complex":"data","nested":"value"}',
        }),
      );
    });

    it("should handle null nickname", async () => {
      const stripePrice: Stripe.Price = {
        ...MOCK_STRIPE_PRICE_FROM_API,
        nickname: null,
      };
      stripeProductService.retrievePrice.mockResolvedValue(stripePrice);
      stripePriceRepository.findByStripePriceId.mockResolvedValue(MOCK_STRIPE_PRICE);
      stripePriceRepository.updateByStripePriceId.mockResolvedValue(MOCK_STRIPE_PRICE);

      await service.syncPriceFromStripe({ stripePriceId: stripePrice.id });

      expect(stripePriceRepository.updateByStripePriceId).toHaveBeenCalledWith(
        expect.objectContaining({
          nickname: undefined,
        }),
      );
    });

    it("should handle null unit_amount", async () => {
      const stripePrice: Stripe.Price = {
        ...MOCK_STRIPE_PRICE_FROM_API,
        unit_amount: null,
      };
      stripeProductService.retrievePrice.mockResolvedValue(stripePrice);
      stripePriceRepository.findByStripePriceId.mockResolvedValue(null);
      stripeProductRepository.findByStripeProductId.mockResolvedValue(MOCK_STRIPE_PRODUCT);
      stripePriceRepository.create.mockResolvedValue(MOCK_STRIPE_PRICE);

      await service.syncPriceFromStripe({ stripePriceId: stripePrice.id });

      expect(stripePriceRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          unitAmount: undefined,
        }),
      );
    });

    it("should handle null lookup_key", async () => {
      const stripePrice: Stripe.Price = {
        ...MOCK_STRIPE_PRICE_FROM_API,
        lookup_key: null,
      };
      stripeProductService.retrievePrice.mockResolvedValue(stripePrice);
      stripePriceRepository.findByStripePriceId.mockResolvedValue(null);
      stripeProductRepository.findByStripeProductId.mockResolvedValue(MOCK_STRIPE_PRODUCT);
      stripePriceRepository.create.mockResolvedValue(MOCK_STRIPE_PRICE);

      await service.syncPriceFromStripe({ stripePriceId: stripePrice.id });

      expect(stripePriceRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          lookupKey: undefined,
        }),
      );
    });

    it("should not create price if product sync fails", async () => {
      const stripePrice: Stripe.Price = {
        ...MOCK_STRIPE_PRICE_FROM_API,
        product: "prod_not_found_123",
      };
      stripeProductService.retrievePrice.mockResolvedValue(stripePrice);
      stripePriceRepository.findByStripePriceId.mockResolvedValue(null);
      stripeProductRepository.findByStripeProductId.mockResolvedValue(null);
      stripeProductService.retrieveProduct.mockResolvedValue(MOCK_PRODUCT);
      stripeProductRepository.create.mockResolvedValue(MOCK_STRIPE_PRODUCT);
      stripeProductRepository.findByStripeProductId.mockResolvedValue(null);

      await service.syncPriceFromStripe({ stripePriceId: stripePrice.id });

      expect(stripePriceRepository.create).not.toHaveBeenCalled();
    });
  });

  // ========== EDGE CASES ==========

  describe("Edge Cases", () => {
    it("should handle empty metadata object", async () => {
      const params = {
        name: "Test Product",
        metadata: {},
      };
      const stripeProduct: Stripe.Product = {
        ...MOCK_PRODUCT,
        id: "prod_test_123",
        active: true,
        metadata: {},
      };
      stripeProductService.createProduct.mockResolvedValue(stripeProduct);
      stripeProductRepository.create.mockResolvedValue(MOCK_STRIPE_PRODUCT);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_SINGLE);

      await service.createProduct(params);

      expect(stripeProductRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: "{}",
        }),
      );
    });

    it("should preserve exact parameter values in updates", async () => {
      const exactParams = {
        id: "exact_id_123",
        name: "Exact Name Test",
        description: "Exact Description Test",
        metadata: { exact: "metadata" },
      };
      stripeProductRepository.findById.mockResolvedValue(MOCK_STRIPE_PRODUCT);
      stripeProductService.updateProduct.mockResolvedValue(MOCK_PRODUCT);
      stripeProductRepository.update.mockResolvedValue(MOCK_STRIPE_PRODUCT);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_SINGLE);

      await service.updateProduct(exactParams);

      expect(stripeProductService.updateProduct).toHaveBeenCalledWith({
        productId: MOCK_STRIPE_PRODUCT.stripeProductId,
        name: exactParams.name,
        description: exactParams.description,
        metadata: exactParams.metadata,
      });
      expect(stripeProductRepository.update).toHaveBeenCalledWith({
        id: exactParams.id,
        name: exactParams.name,
        description: exactParams.description,
        metadata: JSON.stringify(exactParams.metadata),
      });
    });

    it("should handle concurrent sync operations", async () => {
      const stripeProduct: Stripe.Product = {
        ...MOCK_PRODUCT,
        id: "prod_concurrent_123",
      };
      stripeProductService.retrieveProduct.mockResolvedValue(stripeProduct);
      stripeProductRepository.findByStripeProductId.mockResolvedValue(MOCK_STRIPE_PRODUCT);
      stripeProductRepository.updateByStripeProductId.mockResolvedValue(MOCK_STRIPE_PRODUCT);

      const promises = [
        service.syncProductFromStripe({ stripeProductId: "prod_concurrent_123" }),
        service.syncProductFromStripe({ stripeProductId: "prod_concurrent_123" }),
      ];

      await Promise.all(promises);

      expect(stripeProductService.retrieveProduct).toHaveBeenCalledTimes(2);
    });
  });
});
