// Mock problematic modules before any imports
jest.mock("../../../../foundations/chunker/chunker.module", () => ({
  ChunkerModule: class {},
}));
jest.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({}));

// Mock the barrel export to provide only what we need
jest.mock("@carlonicora/nestjs-neo4jsonapi", () => {
  const actual = jest.requireActual("@carlonicora/nestjs-neo4jsonapi");

  return {
    ...actual,
    AdminJwtAuthGuard: class MockAdminJwtAuthGuard {},
    // Override companyMeta that billing-customer.model needs
    companyMeta: {
      type: "companies",
      endpoint: "companies",
      nodeName: "company",
      labelName: "Company",
    },
  };
});

import { Test, TestingModule } from "@nestjs/testing";
import { HttpStatus } from "@nestjs/common";
import { FastifyReply } from "fastify";
import { BillingAdminController } from "../billing-admin.controller";
import { BillingAdminService } from "../../services/billing-admin.service";

describe("BillingAdminController", () => {
  let controller: BillingAdminController;
  let billingAdminService: jest.Mocked<BillingAdminService>;
  let mockReply: jest.Mocked<FastifyReply>;

  // Test data constants
  const TEST_IDS = {
    productId: "prod_test123",
    priceId: "price_test123",
  };

  const MOCK_PRODUCT_RESPONSE = {
    data: {
      type: "products",
      id: TEST_IDS.productId,
      attributes: {
        stripeProductId: "prod_stripe_123",
        name: "Test Product",
        description: "Test Description",
        active: true,
      },
    },
  };

  const MOCK_PRICE_RESPONSE = {
    data: {
      type: "prices",
      id: TEST_IDS.priceId,
      attributes: {
        stripePriceId: "price_stripe_123",
        productId: TEST_IDS.productId,
        unitAmount: 1000,
        currency: "usd",
        active: true,
      },
    },
  };

  const MOCK_PRODUCTS_LIST = {
    data: [MOCK_PRODUCT_RESPONSE.data],
    meta: { total: 1 },
  };

  const MOCK_PRICES_LIST = {
    data: [MOCK_PRICE_RESPONSE.data],
    meta: { total: 1 },
  };

  // Create a mock Fastify reply
  const createMockReply = (): jest.Mocked<FastifyReply> => {
    const reply = {
      send: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis(),
      code: jest.fn().mockReturnThis(),
    } as unknown as jest.Mocked<FastifyReply>;
    return reply;
  };

  beforeEach(async () => {
    const mockBillingAdminService = {
      // Product methods
      listProducts: jest.fn(),
      getProduct: jest.fn(),
      createProduct: jest.fn(),
      updateProduct: jest.fn(),
      archiveProduct: jest.fn(),
      // Price methods
      listPrices: jest.fn(),
      getPrice: jest.fn(),
      createPrice: jest.fn(),
      updatePrice: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BillingAdminController],
      providers: [
        {
          provide: BillingAdminService,
          useValue: mockBillingAdminService,
        },
      ],
    }).compile();

    controller = module.get<BillingAdminController>(BillingAdminController);
    billingAdminService = module.get(BillingAdminService);

    mockReply = createMockReply();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ===================================================================
  // PRODUCT ENDPOINTS (5 endpoints)
  // ===================================================================

  describe("Product Endpoints", () => {
    describe("GET /billing/admin/products", () => {
      it("should list all products without active filter", async () => {
        const mockQuery = { page: { size: 10, number: 1 } };
        billingAdminService.listProducts.mockResolvedValue(MOCK_PRODUCTS_LIST);

        await controller.listProducts(mockReply, mockQuery, undefined);

        expect(billingAdminService.listProducts).toHaveBeenCalledWith({
          query: mockQuery,
          active: undefined,
        });
        expect(mockReply.send).toHaveBeenCalledWith(MOCK_PRODUCTS_LIST);
      });

      it("should list active products when active=true", async () => {
        const mockQuery = { page: { size: 10 } };
        billingAdminService.listProducts.mockResolvedValue(MOCK_PRODUCTS_LIST);

        await controller.listProducts(mockReply, mockQuery, "true");

        expect(billingAdminService.listProducts).toHaveBeenCalledWith({
          query: mockQuery,
          active: true,
        });
        expect(mockReply.send).toHaveBeenCalledWith(MOCK_PRODUCTS_LIST);
      });

      it("should list inactive products when active=false", async () => {
        const mockQuery = {};
        billingAdminService.listProducts.mockResolvedValue({ data: [] });

        await controller.listProducts(mockReply, mockQuery, "false");

        expect(billingAdminService.listProducts).toHaveBeenCalledWith({
          query: mockQuery,
          active: false,
        });
        expect(mockReply.send).toHaveBeenCalled();
      });

      it("should convert string 'true' to boolean true", async () => {
        const mockQuery = {};
        billingAdminService.listProducts.mockResolvedValue({ data: [] });

        await controller.listProducts(mockReply, mockQuery, "true");

        expect(billingAdminService.listProducts).toHaveBeenCalledWith({
          query: mockQuery,
          active: true,
        });
      });

      it("should convert string 'false' to boolean false", async () => {
        const mockQuery = {};
        billingAdminService.listProducts.mockResolvedValue({ data: [] });

        await controller.listProducts(mockReply, mockQuery, "false");

        expect(billingAdminService.listProducts).toHaveBeenCalledWith({
          query: mockQuery,
          active: false,
        });
      });

      it("should treat non-'true' string as false", async () => {
        const mockQuery = {};
        billingAdminService.listProducts.mockResolvedValue({ data: [] });

        await controller.listProducts(mockReply, mockQuery, "yes");

        expect(billingAdminService.listProducts).toHaveBeenCalledWith({
          query: mockQuery,
          active: false,
        });
      });

      it("should pass query object from query params", async () => {
        const customQuery = { filter: { archived: false }, sort: "name" };
        billingAdminService.listProducts.mockResolvedValue({ data: [] });

        await controller.listProducts(mockReply, customQuery, undefined);

        expect(billingAdminService.listProducts).toHaveBeenCalledWith({
          query: customQuery,
          active: undefined,
        });
      });

      it("should handle service errors", async () => {
        const error = new Error("Database error");
        billingAdminService.listProducts.mockRejectedValue(error);

        await expect(controller.listProducts(mockReply, {}, undefined)).rejects.toThrow("Database error");
        expect(billingAdminService.listProducts).toHaveBeenCalled();
      });
    });

    describe("GET /billing/admin/products/:productId", () => {
      it("should get product by id successfully", async () => {
        billingAdminService.getProduct.mockResolvedValue(MOCK_PRODUCT_RESPONSE);

        await controller.getProduct(mockReply, TEST_IDS.productId);

        expect(billingAdminService.getProduct).toHaveBeenCalledWith({
          id: TEST_IDS.productId,
        });
        expect(mockReply.send).toHaveBeenCalledWith(MOCK_PRODUCT_RESPONSE);
      });

      it("should extract productId from path params", async () => {
        const customProductId = "prod_custom_456";
        billingAdminService.getProduct.mockResolvedValue(MOCK_PRODUCT_RESPONSE);

        await controller.getProduct(mockReply, customProductId);

        expect(billingAdminService.getProduct).toHaveBeenCalledWith({
          id: customProductId,
        });
      });

      it("should handle service errors", async () => {
        const error = new Error("Product not found");
        billingAdminService.getProduct.mockRejectedValue(error);

        await expect(controller.getProduct(mockReply, TEST_IDS.productId)).rejects.toThrow("Product not found");
        expect(billingAdminService.getProduct).toHaveBeenCalledWith({
          id: TEST_IDS.productId,
        });
      });
    });

    describe("POST /billing/admin/products", () => {
      const validCreateProductBody = {
        name: "New Product",
        description: "New Description",
        metadata: { key: "value" },
      };

      it("should create product successfully with 201 status", async () => {
        billingAdminService.createProduct.mockResolvedValue(MOCK_PRODUCT_RESPONSE);

        await controller.createProduct(mockReply, validCreateProductBody);

        expect(billingAdminService.createProduct).toHaveBeenCalledWith({
          name: validCreateProductBody.name,
          description: validCreateProductBody.description,
          metadata: validCreateProductBody.metadata,
        });
        expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.CREATED);
        expect(mockReply.send).toHaveBeenCalledWith(MOCK_PRODUCT_RESPONSE);
      });

      it("should pass all body parameters to service", async () => {
        const bodyWithAllFields = {
          name: "Complete Product",
          description: "Complete Description",
          metadata: { tier: "premium", category: "software" },
        };
        billingAdminService.createProduct.mockResolvedValue(MOCK_PRODUCT_RESPONSE);

        await controller.createProduct(mockReply, bodyWithAllFields);

        expect(billingAdminService.createProduct).toHaveBeenCalledWith({
          name: bodyWithAllFields.name,
          description: bodyWithAllFields.description,
          metadata: bodyWithAllFields.metadata,
        });
      });

      it("should create product with only required fields", async () => {
        const minimalBody = {
          name: "Minimal Product",
        } as any;
        billingAdminService.createProduct.mockResolvedValue(MOCK_PRODUCT_RESPONSE);

        await controller.createProduct(mockReply, minimalBody);

        expect(billingAdminService.createProduct).toHaveBeenCalledWith({
          name: minimalBody.name,
          description: undefined,
          metadata: undefined,
        });
      });

      it("should handle service errors during creation", async () => {
        const error = new Error("Product creation failed");
        billingAdminService.createProduct.mockRejectedValue(error);

        await expect(controller.createProduct(mockReply, validCreateProductBody)).rejects.toThrow(
          "Product creation failed",
        );
        expect(billingAdminService.createProduct).toHaveBeenCalled();
      });
    });

    describe("PUT /billing/admin/products/:productId", () => {
      const validUpdateProductBody = {
        name: "Updated Product",
        description: "Updated Description",
        metadata: { key: "new_value" },
      };

      it("should update product successfully", async () => {
        billingAdminService.updateProduct.mockResolvedValue(MOCK_PRODUCT_RESPONSE);

        await controller.updateProduct(mockReply, TEST_IDS.productId, validUpdateProductBody);

        expect(billingAdminService.updateProduct).toHaveBeenCalledWith({
          id: TEST_IDS.productId,
          name: validUpdateProductBody.name,
          description: validUpdateProductBody.description,
          metadata: validUpdateProductBody.metadata,
        });
        expect(mockReply.send).toHaveBeenCalledWith(MOCK_PRODUCT_RESPONSE);
      });

      it("should extract productId from path params", async () => {
        const customProductId = "prod_to_update_789";
        billingAdminService.updateProduct.mockResolvedValue(MOCK_PRODUCT_RESPONSE);

        await controller.updateProduct(mockReply, customProductId, validUpdateProductBody);

        expect(billingAdminService.updateProduct).toHaveBeenCalledWith({
          id: customProductId,
          name: validUpdateProductBody.name,
          description: validUpdateProductBody.description,
          metadata: validUpdateProductBody.metadata,
        });
      });

      it("should pass all body parameters to service", async () => {
        const partialUpdateBody = {
          name: "Partial Update",
        } as any;
        billingAdminService.updateProduct.mockResolvedValue(MOCK_PRODUCT_RESPONSE);

        await controller.updateProduct(mockReply, TEST_IDS.productId, partialUpdateBody);

        expect(billingAdminService.updateProduct).toHaveBeenCalledWith({
          id: TEST_IDS.productId,
          name: partialUpdateBody.name,
          description: undefined,
          metadata: undefined,
        });
      });

      it("should handle service errors during update", async () => {
        const error = new Error("Product update failed");
        billingAdminService.updateProduct.mockRejectedValue(error);

        await expect(controller.updateProduct(mockReply, TEST_IDS.productId, validUpdateProductBody)).rejects.toThrow(
          "Product update failed",
        );
        expect(billingAdminService.updateProduct).toHaveBeenCalled();
      });
    });

    describe("DELETE /billing/admin/products/:productId", () => {
      it("should archive product with 204 NO_CONTENT status", async () => {
        billingAdminService.archiveProduct.mockResolvedValue(undefined);

        await controller.archiveProduct(mockReply, TEST_IDS.productId);

        expect(billingAdminService.archiveProduct).toHaveBeenCalledWith({
          id: TEST_IDS.productId,
        });
        expect(mockReply.send).toHaveBeenCalled();
      });

      it("should extract productId from path params", async () => {
        const customProductId = "prod_to_archive_456";
        billingAdminService.archiveProduct.mockResolvedValue(undefined);

        await controller.archiveProduct(mockReply, customProductId);

        expect(billingAdminService.archiveProduct).toHaveBeenCalledWith({
          id: customProductId,
        });
        expect(mockReply.send).toHaveBeenCalled();
      });

      it("should handle service errors during archive", async () => {
        const error = new Error("Cannot archive product with active subscriptions");
        billingAdminService.archiveProduct.mockRejectedValue(error);

        await expect(controller.archiveProduct(mockReply, TEST_IDS.productId)).rejects.toThrow(
          "Cannot archive product with active subscriptions",
        );
        expect(billingAdminService.archiveProduct).toHaveBeenCalledWith({
          id: TEST_IDS.productId,
        });
      });
    });
  });

  // ===================================================================
  // PRICE ENDPOINTS (4 endpoints)
  // ===================================================================

  describe("Price Endpoints", () => {
    describe("GET /billing/admin/prices", () => {
      it("should list all prices without filters", async () => {
        const mockQuery = { page: { size: 10, number: 1 } };
        billingAdminService.listPrices.mockResolvedValue(MOCK_PRICES_LIST);

        await controller.listPrices(mockReply, mockQuery, undefined, undefined);

        expect(billingAdminService.listPrices).toHaveBeenCalledWith({
          query: mockQuery,
          productId: undefined,
          active: undefined,
        });
        expect(mockReply.send).toHaveBeenCalledWith(MOCK_PRICES_LIST);
      });

      it("should list prices filtered by productId", async () => {
        const mockQuery = {};
        billingAdminService.listPrices.mockResolvedValue(MOCK_PRICES_LIST);

        await controller.listPrices(mockReply, mockQuery, TEST_IDS.productId, undefined);

        expect(billingAdminService.listPrices).toHaveBeenCalledWith({
          query: mockQuery,
          productId: TEST_IDS.productId,
          active: undefined,
        });
        expect(mockReply.send).toHaveBeenCalledWith(MOCK_PRICES_LIST);
      });

      it("should list active prices when active=true", async () => {
        const mockQuery = {};
        billingAdminService.listPrices.mockResolvedValue(MOCK_PRICES_LIST);

        await controller.listPrices(mockReply, mockQuery, undefined, "true");

        expect(billingAdminService.listPrices).toHaveBeenCalledWith({
          query: mockQuery,
          productId: undefined,
          active: true,
        });
      });

      it("should list inactive prices when active=false", async () => {
        const mockQuery = {};
        billingAdminService.listPrices.mockResolvedValue({ data: [] });

        await controller.listPrices(mockReply, mockQuery, undefined, "false");

        expect(billingAdminService.listPrices).toHaveBeenCalledWith({
          query: mockQuery,
          productId: undefined,
          active: false,
        });
      });

      it("should filter by both productId and active", async () => {
        const mockQuery = { sort: "created" };
        billingAdminService.listPrices.mockResolvedValue(MOCK_PRICES_LIST);

        await controller.listPrices(mockReply, mockQuery, TEST_IDS.productId, "true");

        expect(billingAdminService.listPrices).toHaveBeenCalledWith({
          query: mockQuery,
          productId: TEST_IDS.productId,
          active: true,
        });
      });

      it("should convert string 'true' to boolean true for active", async () => {
        const mockQuery = {};
        billingAdminService.listPrices.mockResolvedValue({ data: [] });

        await controller.listPrices(mockReply, mockQuery, undefined, "true");

        expect(billingAdminService.listPrices).toHaveBeenCalledWith({
          query: mockQuery,
          productId: undefined,
          active: true,
        });
      });

      it("should convert string 'false' to boolean false for active", async () => {
        const mockQuery = {};
        billingAdminService.listPrices.mockResolvedValue({ data: [] });

        await controller.listPrices(mockReply, mockQuery, undefined, "false");

        expect(billingAdminService.listPrices).toHaveBeenCalledWith({
          query: mockQuery,
          productId: undefined,
          active: false,
        });
      });

      it("should treat non-'true' string as false for active", async () => {
        const mockQuery = {};
        billingAdminService.listPrices.mockResolvedValue({ data: [] });

        await controller.listPrices(mockReply, mockQuery, undefined, "active");

        expect(billingAdminService.listPrices).toHaveBeenCalledWith({
          query: mockQuery,
          productId: undefined,
          active: false,
        });
      });

      it("should not convert productId (keep as string)", async () => {
        const mockQuery = {};
        const productId = "prod_string_123";
        billingAdminService.listPrices.mockResolvedValue({ data: [] });

        await controller.listPrices(mockReply, mockQuery, productId, undefined);

        expect(billingAdminService.listPrices).toHaveBeenCalledWith({
          query: mockQuery,
          productId: productId,
          active: undefined,
        });
      });

      it("should pass query object from query params", async () => {
        const customQuery = { filter: { recurring: true }, page: { size: 50 } };
        billingAdminService.listPrices.mockResolvedValue({ data: [] });

        await controller.listPrices(mockReply, customQuery, undefined, undefined);

        expect(billingAdminService.listPrices).toHaveBeenCalledWith({
          query: customQuery,
          productId: undefined,
          active: undefined,
        });
      });

      it("should handle service errors", async () => {
        const error = new Error("Database error");
        billingAdminService.listPrices.mockRejectedValue(error);

        await expect(controller.listPrices(mockReply, {}, undefined, undefined)).rejects.toThrow("Database error");
        expect(billingAdminService.listPrices).toHaveBeenCalled();
      });
    });

    describe("GET /billing/admin/prices/:priceId", () => {
      it("should get price by id successfully", async () => {
        billingAdminService.getPrice.mockResolvedValue(MOCK_PRICE_RESPONSE);

        await controller.getPrice(mockReply, TEST_IDS.priceId);

        expect(billingAdminService.getPrice).toHaveBeenCalledWith({
          id: TEST_IDS.priceId,
        });
        expect(mockReply.send).toHaveBeenCalledWith(MOCK_PRICE_RESPONSE);
      });

      it("should extract priceId from path params", async () => {
        const customPriceId = "price_custom_789";
        billingAdminService.getPrice.mockResolvedValue(MOCK_PRICE_RESPONSE);

        await controller.getPrice(mockReply, customPriceId);

        expect(billingAdminService.getPrice).toHaveBeenCalledWith({
          id: customPriceId,
        });
      });

      it("should handle service errors", async () => {
        const error = new Error("Price not found");
        billingAdminService.getPrice.mockRejectedValue(error);

        await expect(controller.getPrice(mockReply, TEST_IDS.priceId)).rejects.toThrow("Price not found");
        expect(billingAdminService.getPrice).toHaveBeenCalledWith({
          id: TEST_IDS.priceId,
        });
      });
    });

    describe("POST /billing/admin/prices", () => {
      const validCreatePriceBody = {
        productId: TEST_IDS.productId,
        unitAmount: 1000,
        currency: "usd",
        nickname: "Monthly Plan",
        lookupKey: "monthly_plan",
        recurring: {
          interval: "month" as const,
          intervalCount: 1,
        },
        metadata: { plan: "basic" },
      };

      it("should create price successfully with 201 status", async () => {
        billingAdminService.createPrice.mockResolvedValue(MOCK_PRICE_RESPONSE);

        await controller.createPrice(mockReply, validCreatePriceBody);

        expect(billingAdminService.createPrice).toHaveBeenCalledWith({
          productId: validCreatePriceBody.productId,
          unitAmount: validCreatePriceBody.unitAmount,
          currency: validCreatePriceBody.currency,
          nickname: validCreatePriceBody.nickname,
          lookupKey: validCreatePriceBody.lookupKey,
          recurring: validCreatePriceBody.recurring,
          metadata: validCreatePriceBody.metadata,
        });
        expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.CREATED);
        expect(mockReply.send).toHaveBeenCalledWith(MOCK_PRICE_RESPONSE);
      });

      it("should pass all body parameters to service", async () => {
        const bodyWithAllFields = {
          productId: "prod_complete_123",
          unitAmount: 2500,
          currency: "eur",
          nickname: "Annual Plan",
          lookupKey: "annual_plan",
          recurring: {
            interval: "year" as const,
            intervalCount: 1,
          },
          metadata: { plan: "premium", tier: "enterprise" },
        };
        billingAdminService.createPrice.mockResolvedValue(MOCK_PRICE_RESPONSE);

        await controller.createPrice(mockReply, bodyWithAllFields);

        expect(billingAdminService.createPrice).toHaveBeenCalledWith({
          productId: bodyWithAllFields.productId,
          unitAmount: bodyWithAllFields.unitAmount,
          currency: bodyWithAllFields.currency,
          nickname: bodyWithAllFields.nickname,
          lookupKey: bodyWithAllFields.lookupKey,
          recurring: bodyWithAllFields.recurring,
          metadata: bodyWithAllFields.metadata,
        });
      });

      it("should create price with only required fields", async () => {
        const minimalBody = {
          productId: TEST_IDS.productId,
          unitAmount: 500,
          currency: "usd",
        } as any;
        billingAdminService.createPrice.mockResolvedValue(MOCK_PRICE_RESPONSE);

        await controller.createPrice(mockReply, minimalBody);

        expect(billingAdminService.createPrice).toHaveBeenCalledWith({
          productId: minimalBody.productId,
          unitAmount: minimalBody.unitAmount,
          currency: minimalBody.currency,
          nickname: undefined,
          lookupKey: undefined,
          recurring: undefined,
          metadata: undefined,
        });
      });

      it("should handle recurring price creation", async () => {
        const recurringBody = {
          productId: TEST_IDS.productId,
          unitAmount: 999,
          currency: "usd",
          recurring: {
            interval: "month" as const,
            intervalCount: 3,
          },
        } as any;
        billingAdminService.createPrice.mockResolvedValue(MOCK_PRICE_RESPONSE);

        await controller.createPrice(mockReply, recurringBody);

        expect(billingAdminService.createPrice).toHaveBeenCalledWith({
          productId: recurringBody.productId,
          unitAmount: recurringBody.unitAmount,
          currency: recurringBody.currency,
          nickname: undefined,
          lookupKey: undefined,
          recurring: recurringBody.recurring,
          metadata: undefined,
        });
      });

      it("should handle service errors during creation", async () => {
        const error = new Error("Price creation failed");
        billingAdminService.createPrice.mockRejectedValue(error);

        await expect(controller.createPrice(mockReply, validCreatePriceBody)).rejects.toThrow("Price creation failed");
        expect(billingAdminService.createPrice).toHaveBeenCalled();
      });
    });

    describe("PUT /billing/admin/prices/:priceId", () => {
      const validUpdatePriceBody = {
        nickname: "Updated Plan",
        metadata: { plan: "updated" },
      };

      it("should update price successfully", async () => {
        billingAdminService.updatePrice.mockResolvedValue(MOCK_PRICE_RESPONSE);

        await controller.updatePrice(mockReply, TEST_IDS.priceId, validUpdatePriceBody);

        expect(billingAdminService.updatePrice).toHaveBeenCalledWith({
          id: TEST_IDS.priceId,
          nickname: validUpdatePriceBody.nickname,
          metadata: validUpdatePriceBody.metadata,
        });
        expect(mockReply.send).toHaveBeenCalledWith(MOCK_PRICE_RESPONSE);
      });

      it("should extract priceId from path params", async () => {
        const customPriceId = "price_to_update_456";
        billingAdminService.updatePrice.mockResolvedValue(MOCK_PRICE_RESPONSE);

        await controller.updatePrice(mockReply, customPriceId, validUpdatePriceBody);

        expect(billingAdminService.updatePrice).toHaveBeenCalledWith({
          id: customPriceId,
          nickname: validUpdatePriceBody.nickname,
          metadata: validUpdatePriceBody.metadata,
        });
      });

      it("should update only nickname", async () => {
        const partialUpdateBody = {
          nickname: "Only Nickname Updated",
        } as any;
        billingAdminService.updatePrice.mockResolvedValue(MOCK_PRICE_RESPONSE);

        await controller.updatePrice(mockReply, TEST_IDS.priceId, partialUpdateBody);

        expect(billingAdminService.updatePrice).toHaveBeenCalledWith({
          id: TEST_IDS.priceId,
          nickname: partialUpdateBody.nickname,
          metadata: undefined,
        });
      });

      it("should update only metadata", async () => {
        const partialUpdateBody = {
          metadata: { updated: "true" },
        } as any;
        billingAdminService.updatePrice.mockResolvedValue(MOCK_PRICE_RESPONSE);

        await controller.updatePrice(mockReply, TEST_IDS.priceId, partialUpdateBody);

        expect(billingAdminService.updatePrice).toHaveBeenCalledWith({
          id: TEST_IDS.priceId,
          nickname: undefined,
          metadata: partialUpdateBody.metadata,
        });
      });

      it("should handle service errors during update", async () => {
        const error = new Error("Price update failed");
        billingAdminService.updatePrice.mockRejectedValue(error);

        await expect(controller.updatePrice(mockReply, TEST_IDS.priceId, validUpdatePriceBody)).rejects.toThrow(
          "Price update failed",
        );
        expect(billingAdminService.updatePrice).toHaveBeenCalled();
      });
    });
  });

  // ===================================================================
  // INTEGRATION TESTS
  // ===================================================================

  describe("Integration Tests", () => {
    it("should have BillingAdminService dependency injected", () => {
      expect(controller["billingAdminService"]).toBeDefined();
    });

    it("should handle active string to boolean conversion consistently across endpoints", async () => {
      billingAdminService.listProducts.mockResolvedValue({ data: [] });
      billingAdminService.listPrices.mockResolvedValue({ data: [] });

      // Test products endpoint
      await controller.listProducts(createMockReply(), {}, "true");
      expect(billingAdminService.listProducts).toHaveBeenCalledWith(expect.objectContaining({ active: true }));

      // Test prices endpoint
      await controller.listPrices(createMockReply(), {}, undefined, "false");
      expect(billingAdminService.listPrices).toHaveBeenCalledWith(expect.objectContaining({ active: false }));

      // Test undefined active
      await controller.listProducts(createMockReply(), {}, undefined);
      expect(billingAdminService.listProducts).toHaveBeenCalledWith(expect.objectContaining({ active: undefined }));
    });

    it("should verify AdminJwtAuthGuard is applied to controller", () => {
      const guards = Reflect.getMetadata("__guards__", BillingAdminController);
      expect(guards).toBeDefined();
      expect(guards.length).toBeGreaterThan(0);
    });

    it("should verify Roles decorator is applied to controller", () => {
      const roles = Reflect.getMetadata("roles", BillingAdminController);
      expect(roles).toBeDefined();
    });

    it("should handle all 201 CREATED responses correctly", async () => {
      billingAdminService.createProduct.mockResolvedValue(MOCK_PRODUCT_RESPONSE);
      billingAdminService.createPrice.mockResolvedValue(MOCK_PRICE_RESPONSE);

      const createProductBody = {
        name: "Test Product",
        description: "Test",
        metadata: {},
      };
      const createPriceBody = {
        productId: TEST_IDS.productId,
        unitAmount: 1000,
        currency: "usd",
        nickname: "Test",
        lookupKey: "test",
        recurring: undefined,
        metadata: {},
      };

      // Test create product
      const reply1 = createMockReply();
      await controller.createProduct(reply1, createProductBody);
      expect(reply1.status).toHaveBeenCalledWith(HttpStatus.CREATED);

      // Test create price
      const reply2 = createMockReply();
      await controller.createPrice(reply2, createPriceBody);
      expect(reply2.status).toHaveBeenCalledWith(HttpStatus.CREATED);
    });

    it("should handle all 204 NO_CONTENT responses correctly", async () => {
      billingAdminService.archiveProduct.mockResolvedValue(undefined);

      // Test archive product
      const reply = createMockReply();
      await controller.archiveProduct(reply, TEST_IDS.productId);
      expect(reply.send).toHaveBeenCalled();
    });

    it("should handle all path parameter extraction correctly", async () => {
      billingAdminService.getProduct.mockResolvedValue(MOCK_PRODUCT_RESPONSE);
      billingAdminService.updateProduct.mockResolvedValue(MOCK_PRODUCT_RESPONSE);
      billingAdminService.archiveProduct.mockResolvedValue(undefined);
      billingAdminService.getPrice.mockResolvedValue(MOCK_PRICE_RESPONSE);
      billingAdminService.updatePrice.mockResolvedValue(MOCK_PRICE_RESPONSE);

      const testProductId = "prod_param_123";
      const testPriceId = "price_param_456";

      // Product endpoints
      await controller.getProduct(createMockReply(), testProductId);
      expect(billingAdminService.getProduct).toHaveBeenCalledWith(expect.objectContaining({ id: testProductId }));

      await controller.updateProduct(createMockReply(), testProductId, { name: "Test" } as any);
      expect(billingAdminService.updateProduct).toHaveBeenCalledWith(expect.objectContaining({ id: testProductId }));

      await controller.archiveProduct(createMockReply(), testProductId);
      expect(billingAdminService.archiveProduct).toHaveBeenCalledWith(expect.objectContaining({ id: testProductId }));

      // Price endpoints
      await controller.getPrice(createMockReply(), testPriceId);
      expect(billingAdminService.getPrice).toHaveBeenCalledWith(expect.objectContaining({ id: testPriceId }));

      await controller.updatePrice(createMockReply(), testPriceId, { nickname: "Test" } as any);
      expect(billingAdminService.updatePrice).toHaveBeenCalledWith(expect.objectContaining({ id: testPriceId }));
    });

    it("should handle all query parameter extraction correctly", async () => {
      billingAdminService.listProducts.mockResolvedValue({ data: [] });
      billingAdminService.listPrices.mockResolvedValue({ data: [] });

      const testQuery = { page: { size: 25, number: 2 } };
      const testProductId = "prod_query_123";

      // Products with query
      await controller.listProducts(createMockReply(), testQuery, "true");
      expect(billingAdminService.listProducts).toHaveBeenCalledWith(
        expect.objectContaining({ query: testQuery, active: true }),
      );

      // Prices with productId and active
      await controller.listPrices(createMockReply(), testQuery, testProductId, "false");
      expect(billingAdminService.listPrices).toHaveBeenCalledWith(
        expect.objectContaining({
          query: testQuery,
          productId: testProductId,
          active: false,
        }),
      );
    });

    it("should ensure no companyId is passed to admin operations", async () => {
      billingAdminService.listProducts.mockResolvedValue({ data: [] });
      billingAdminService.getProduct.mockResolvedValue(MOCK_PRODUCT_RESPONSE);
      billingAdminService.listPrices.mockResolvedValue({ data: [] });
      billingAdminService.getPrice.mockResolvedValue(MOCK_PRICE_RESPONSE);

      // Test all endpoints don't include companyId
      await controller.listProducts(createMockReply(), {}, undefined);
      expect(billingAdminService.listProducts).toHaveBeenCalledWith(
        expect.not.objectContaining({ companyId: expect.anything() }),
      );

      await controller.getProduct(createMockReply(), TEST_IDS.productId);
      expect(billingAdminService.getProduct).toHaveBeenCalledWith(
        expect.not.objectContaining({ companyId: expect.anything() }),
      );

      await controller.listPrices(createMockReply(), {}, undefined, undefined);
      expect(billingAdminService.listPrices).toHaveBeenCalledWith(
        expect.not.objectContaining({ companyId: expect.anything() }),
      );

      await controller.getPrice(createMockReply(), TEST_IDS.priceId);
      expect(billingAdminService.getPrice).toHaveBeenCalledWith(
        expect.not.objectContaining({ companyId: expect.anything() }),
      );
    });
  });
});
