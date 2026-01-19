import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
// Mock problematic modules before any imports
vi.mock("../../../chunker/chunker.module", () => ({
  ChunkerModule: class {},
}));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({}));

// Mock the guards to avoid dependency resolution issues
vi.mock("../../../../common/guards", () => ({
  JwtAuthGuard: class MockJwtAuthGuard {
    canActivate = vi.fn().mockReturnValue(true);
  },
  AdminJwtAuthGuard: class MockAdminJwtAuthGuard {
    canActivate = vi.fn().mockReturnValue(true);
  },
}));

// Mock the barrel export to provide only what we need
vi.mock("@carlonicora/nestjs-neo4jsonapi", () => {
  const actual = vi.importActual("@carlonicora/nestjs-neo4jsonapi");

  return {
    ...actual,
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
import { StripeCustomerController } from "../stripe-customer.controller";
import { StripeCustomerAdminService } from "../../services/stripe-customer-admin.service";
import { StripeCustomerApiService } from "../../services/stripe-customer-api.service";
import { StripeCustomerRepository } from "../../repositories/stripe-customer.repository";
import { JsonApiService } from "../../../../core/jsonapi";
import { AuthenticatedRequest } from "@carlonicora/nestjs-neo4jsonapi";

describe("StripeCustomerController", () => {
  let controller: StripeCustomerController;
  let adminService: vi.Mocked<StripeCustomerAdminService>;
  let apiService: vi.Mocked<StripeCustomerApiService>;
  let repository: vi.Mocked<StripeCustomerRepository>;
  let jsonApiService: vi.Mocked<JsonApiService>;
  let mockReply: vi.Mocked<FastifyReply>;

  // Test data constants
  const TEST_IDS = {
    companyId: "660e8400-e29b-41d4-a716-446655440001",
    userId: "550e8400-e29b-41d4-a716-446655440001",
    customerId: "990e8400-e29b-41d4-a716-446655440001",
    stripeCustomerId: "cus_stripe123",
    paymentMethodId: "pm_123",
  };

  const MOCK_CUSTOMER_ENTITY = {
    id: TEST_IDS.customerId,
    stripeCustomerId: TEST_IDS.stripeCustomerId,
    email: "test@example.com",
    name: "Test Company",
    currency: "usd",
    balance: 0,
    delinquent: false,
    defaultPaymentMethodId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const MOCK_CUSTOMER_RESPONSE = {
    data: {
      type: "stripe-customers",
      id: TEST_IDS.customerId,
      attributes: {
        stripeCustomerId: TEST_IDS.stripeCustomerId,
        email: "test@example.com",
        name: "Test Company",
        currency: "usd",
        balance: 0,
        delinquent: false,
      },
    },
  };

  const MOCK_PAYMENT_METHODS_RESPONSE = {
    data: [
      {
        type: "stripe-payment-methods",
        id: TEST_IDS.paymentMethodId,
        attributes: {
          type: "card",
          brand: "visa",
          last4: "4242",
          expMonth: 12,
          expYear: 2025,
        },
      },
    ],
  };

  // Create a mock authenticated request
  const createMockRequest = (
    companyId: string = TEST_IDS.companyId,
    userId: string = TEST_IDS.userId,
  ): AuthenticatedRequest => {
    return {
      user: {
        companyId,
        userId,
      },
    } as AuthenticatedRequest;
  };

  // Create a mock Fastify reply
  const createMockReply = (): vi.Mocked<FastifyReply> => {
    const reply = {
      send: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      code: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
    } as unknown as vi.Mocked<FastifyReply>;
    return reply;
  };

  beforeEach(async () => {
    const mockStripeCustomerAdminService = {
      getCustomerByCompanyId: vi.fn(),
      getCustomerById: vi.fn(),
      createCustomer: vi.fn(),
      updateCustomer: vi.fn(),
      deleteCustomer: vi.fn(),
    };

    const mockStripeCustomerApiService = {
      listPaymentMethods: vi.fn(),
      setDefaultPaymentMethod: vi.fn(),
      detachPaymentMethod: vi.fn(),
    };

    const mockStripeCustomerRepository = {
      findByCompanyId: vi.fn(),
      update: vi.fn(),
    };

    const mockJsonApiService = {
      buildList: vi.fn(),
      buildSingle: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StripeCustomerController],
      providers: [
        {
          provide: StripeCustomerAdminService,
          useValue: mockStripeCustomerAdminService,
        },
        {
          provide: StripeCustomerApiService,
          useValue: mockStripeCustomerApiService,
        },
        {
          provide: StripeCustomerRepository,
          useValue: mockStripeCustomerRepository,
        },
        {
          provide: JsonApiService,
          useValue: mockJsonApiService,
        },
      ],
    }).compile();

    controller = module.get<StripeCustomerController>(StripeCustomerController);
    adminService = module.get(StripeCustomerAdminService);
    apiService = module.get(StripeCustomerApiService);
    repository = module.get(StripeCustomerRepository);
    jsonApiService = module.get(JsonApiService);

    mockReply = createMockReply();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /stripe-customers", () => {
    it("should get customer for the current company successfully", async () => {
      const req = createMockRequest();
      adminService.getCustomerByCompanyId.mockResolvedValue(MOCK_CUSTOMER_RESPONSE);

      await controller.getCustomer(req, mockReply);

      expect(adminService.getCustomerByCompanyId).toHaveBeenCalledWith(TEST_IDS.companyId);
      expect(mockReply.send).toHaveBeenCalledWith(MOCK_CUSTOMER_RESPONSE);
    });

    it("should return 404 when customer not found", async () => {
      const req = createMockRequest();
      adminService.getCustomerByCompanyId.mockResolvedValue(null);

      await controller.getCustomer(req, mockReply);

      expect(adminService.getCustomerByCompanyId).toHaveBeenCalledWith(TEST_IDS.companyId);
      expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
      expect(mockReply.send).toHaveBeenCalledWith({ error: "Customer not found" });
    });

    it("should handle service errors", async () => {
      const req = createMockRequest();
      const error = new Error("Database error");
      adminService.getCustomerByCompanyId.mockRejectedValue(error);

      await expect(controller.getCustomer(req, mockReply)).rejects.toThrow(error);
    });
  });

  describe("GET /stripe-customers/:id", () => {
    it("should get customer by id successfully", async () => {
      const req = createMockRequest();
      adminService.getCustomerById.mockResolvedValue(MOCK_CUSTOMER_RESPONSE);

      await controller.getCustomerById(req, mockReply, TEST_IDS.customerId);

      expect(adminService.getCustomerById).toHaveBeenCalledWith(TEST_IDS.customerId);
      expect(mockReply.send).toHaveBeenCalledWith(MOCK_CUSTOMER_RESPONSE);
    });

    it("should return 404 when customer not found", async () => {
      const req = createMockRequest();
      adminService.getCustomerById.mockResolvedValue(null);

      await controller.getCustomerById(req, mockReply, TEST_IDS.customerId);

      expect(adminService.getCustomerById).toHaveBeenCalledWith(TEST_IDS.customerId);
      expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
      expect(mockReply.send).toHaveBeenCalledWith({ error: "Customer not found" });
    });

    it("should extract customerId from path params", async () => {
      const req = createMockRequest();
      const customId = "custom_customer_789";
      adminService.getCustomerById.mockResolvedValue(MOCK_CUSTOMER_RESPONSE);

      await controller.getCustomerById(req, mockReply, customId);

      expect(adminService.getCustomerById).toHaveBeenCalledWith(customId);
    });
  });

  describe("POST /stripe-customers", () => {
    it("should create customer successfully with 201 status", async () => {
      const req = createMockRequest();
      const body = {
        data: {
          type: "stripe-customers",
          attributes: {
            email: "new@example.com",
            name: "New Company",
          },
        },
      };
      repository.findByCompanyId.mockResolvedValue(null);
      adminService.createCustomer.mockResolvedValue(MOCK_CUSTOMER_RESPONSE);

      await controller.createCustomer(req, mockReply, body as any);

      expect(repository.findByCompanyId).toHaveBeenCalledWith({ companyId: TEST_IDS.companyId });
      expect(adminService.createCustomer).toHaveBeenCalledWith(TEST_IDS.companyId, TEST_IDS.userId, body);
      expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.CREATED);
      expect(mockReply.send).toHaveBeenCalledWith(MOCK_CUSTOMER_RESPONSE);
    });

    it("should return 409 CONFLICT when customer already exists", async () => {
      const req = createMockRequest();
      const body = {
        data: {
          type: "stripe-customers",
          attributes: {
            email: "new@example.com",
            name: "New Company",
          },
        },
      };
      repository.findByCompanyId.mockResolvedValue(MOCK_CUSTOMER_ENTITY as any);

      await controller.createCustomer(req, mockReply, body as any);

      expect(repository.findByCompanyId).toHaveBeenCalledWith({ companyId: TEST_IDS.companyId });
      expect(adminService.createCustomer).not.toHaveBeenCalled();
      expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
      expect(mockReply.send).toHaveBeenCalledWith({ error: "Customer already exists for this company" });
    });

    it("should handle service errors during creation", async () => {
      const req = createMockRequest();
      const body = {
        data: {
          type: "stripe-customers",
          attributes: {},
        },
      };
      const error = new Error("Stripe API error");
      repository.findByCompanyId.mockResolvedValue(null);
      adminService.createCustomer.mockRejectedValue(error);

      await expect(controller.createCustomer(req, mockReply, body as any)).rejects.toThrow(error);
    });
  });

  describe("PUT /stripe-customers/:id", () => {
    it("should update customer successfully", async () => {
      const req = createMockRequest();
      const body = {
        data: {
          type: "stripe-customers",
          id: TEST_IDS.customerId,
          attributes: {
            name: "Updated Company",
            email: "updated@example.com",
          },
        },
      };
      adminService.updateCustomer.mockResolvedValue(MOCK_CUSTOMER_RESPONSE);

      await controller.updateCustomer(req, mockReply, TEST_IDS.customerId, body as any);

      expect(adminService.updateCustomer).toHaveBeenCalledWith(TEST_IDS.customerId, body);
      expect(mockReply.send).toHaveBeenCalledWith(MOCK_CUSTOMER_RESPONSE);
    });

    it("should return 404 when customer not found", async () => {
      const req = createMockRequest();
      const body = {
        data: {
          type: "stripe-customers",
          id: TEST_IDS.customerId,
          attributes: {
            name: "Updated Company",
          },
        },
      };
      adminService.updateCustomer.mockResolvedValue(null);

      await controller.updateCustomer(req, mockReply, TEST_IDS.customerId, body as any);

      expect(adminService.updateCustomer).toHaveBeenCalledWith(TEST_IDS.customerId, body);
      expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
      expect(mockReply.send).toHaveBeenCalledWith({ error: "Customer not found" });
    });

    it("should extract customerId from path params", async () => {
      const req = createMockRequest();
      const customId = "custom_customer_update_789";
      const body = {
        data: {
          type: "stripe-customers",
          id: customId,
          attributes: {
            name: "Updated",
          },
        },
      };
      adminService.updateCustomer.mockResolvedValue(MOCK_CUSTOMER_RESPONSE);

      await controller.updateCustomer(req, mockReply, customId, body as any);

      expect(adminService.updateCustomer).toHaveBeenCalledWith(customId, body);
    });
  });

  describe("DELETE /stripe-customers/:id", () => {
    it("should delete customer successfully", async () => {
      const req = createMockRequest();
      adminService.deleteCustomer.mockResolvedValue(undefined);

      await controller.deleteCustomer(req, mockReply, TEST_IDS.customerId);

      expect(adminService.deleteCustomer).toHaveBeenCalledWith(TEST_IDS.customerId);
      expect(mockReply.send).toHaveBeenCalled();
    });

    it("should extract customerId from path params", async () => {
      const req = createMockRequest();
      const customId = "custom_customer_delete_789";
      adminService.deleteCustomer.mockResolvedValue(undefined);

      await controller.deleteCustomer(req, mockReply, customId);

      expect(adminService.deleteCustomer).toHaveBeenCalledWith(customId);
    });
  });

  describe("GET /stripe-customers/payment-methods", () => {
    const mockStripePaymentMethods = [
      {
        id: TEST_IDS.paymentMethodId,
        type: "card" as const,
        card: {
          brand: "visa",
          last4: "4242",
          exp_month: 12,
          exp_year: 2025,
        },
        billing_details: {
          name: "John Doe",
          email: "john@example.com",
          phone: "+1234567890",
          address: {
            city: "San Francisco",
            country: "US",
            line1: "123 Main St",
            line2: "Suite 100",
            postal_code: "94102",
            state: "CA",
          },
        },
      },
    ];

    it("should list payment methods successfully", async () => {
      const req = createMockRequest();
      repository.findByCompanyId.mockResolvedValue(MOCK_CUSTOMER_ENTITY as any);
      apiService.listPaymentMethods.mockResolvedValue(mockStripePaymentMethods as any);
      jsonApiService.buildList.mockResolvedValue(MOCK_PAYMENT_METHODS_RESPONSE as any);

      await controller.listPaymentMethods(req, mockReply);

      expect(repository.findByCompanyId).toHaveBeenCalledWith({ companyId: TEST_IDS.companyId });
      expect(apiService.listPaymentMethods).toHaveBeenCalledWith(TEST_IDS.stripeCustomerId);
      expect(jsonApiService.buildList).toHaveBeenCalledWith(
        expect.anything(),
        expect.arrayContaining([
          expect.objectContaining({
            id: TEST_IDS.paymentMethodId,
            type: "card",
            brand: "visa",
            last4: "4242",
            expMonth: 12,
            expYear: 2025,
            billingName: "John Doe",
            billingEmail: "john@example.com",
            billingPhone: "+1234567890",
            billingAddressCity: "San Francisco",
            billingAddressCountry: "US",
            billingAddressLine1: "123 Main St",
            billingAddressLine2: "Suite 100",
            billingAddressPostalCode: "94102",
            billingAddressState: "CA",
          }),
        ]),
      );
      expect(mockReply.send).toHaveBeenCalledWith(MOCK_PAYMENT_METHODS_RESPONSE);
    });

    it("should return 404 when customer not found", async () => {
      const req = createMockRequest();
      repository.findByCompanyId.mockResolvedValue(null);

      await controller.listPaymentMethods(req, mockReply);

      expect(repository.findByCompanyId).toHaveBeenCalledWith({ companyId: TEST_IDS.companyId });
      expect(apiService.listPaymentMethods).not.toHaveBeenCalled();
      expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
      expect(mockReply.send).toHaveBeenCalledWith({ error: "Customer not found" });
    });

    it("should handle payment methods with missing billing details", async () => {
      const req = createMockRequest();
      const paymentMethodsWithoutBilling = [
        {
          id: "pm_456",
          type: "card" as const,
          card: {
            brand: "mastercard",
            last4: "1234",
            exp_month: 6,
            exp_year: 2026,
          },
          billing_details: {
            name: null,
            email: null,
            phone: null,
            address: {
              city: null,
              country: null,
              line1: null,
              line2: null,
              postal_code: null,
              state: null,
            },
          },
        },
      ];
      repository.findByCompanyId.mockResolvedValue(MOCK_CUSTOMER_ENTITY as any);
      apiService.listPaymentMethods.mockResolvedValue(paymentMethodsWithoutBilling as any);
      jsonApiService.buildList.mockResolvedValue({ data: [] } as any);

      await controller.listPaymentMethods(req, mockReply);

      expect(jsonApiService.buildList).toHaveBeenCalledWith(
        expect.anything(),
        expect.arrayContaining([
          expect.objectContaining({
            id: "pm_456",
            billingName: null,
            billingEmail: null,
            billingPhone: null,
            billingAddressCity: null,
            billingAddressCountry: null,
            billingAddressLine1: null,
            billingAddressLine2: null,
            billingAddressPostalCode: null,
            billingAddressState: null,
          }),
        ]),
      );
    });
  });

  describe("POST /stripe-customers/payment-methods/:paymentMethodId/default", () => {
    it("should set default payment method successfully", async () => {
      const req = createMockRequest();
      repository.findByCompanyId.mockResolvedValue(MOCK_CUSTOMER_ENTITY as any);
      apiService.setDefaultPaymentMethod.mockResolvedValue({} as any);
      repository.update.mockResolvedValue({} as any);

      await controller.setDefaultPaymentMethod(req, mockReply, TEST_IDS.paymentMethodId);

      expect(repository.findByCompanyId).toHaveBeenCalledWith({ companyId: TEST_IDS.companyId });
      expect(apiService.setDefaultPaymentMethod).toHaveBeenCalledWith(
        TEST_IDS.stripeCustomerId,
        TEST_IDS.paymentMethodId,
      );
      expect(repository.update).toHaveBeenCalledWith({
        id: TEST_IDS.customerId,
        defaultPaymentMethodId: TEST_IDS.paymentMethodId,
      });
      expect(mockReply.send).toHaveBeenCalled();
    });

    it("should return 404 when customer not found", async () => {
      const req = createMockRequest();
      repository.findByCompanyId.mockResolvedValue(null);

      await controller.setDefaultPaymentMethod(req, mockReply, TEST_IDS.paymentMethodId);

      expect(repository.findByCompanyId).toHaveBeenCalledWith({ companyId: TEST_IDS.companyId });
      expect(apiService.setDefaultPaymentMethod).not.toHaveBeenCalled();
      expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
      expect(mockReply.send).toHaveBeenCalledWith({ error: "Customer not found" });
    });

    it("should extract paymentMethodId from path params", async () => {
      const req = createMockRequest();
      const customPaymentMethodId = "pm_custom_789";
      repository.findByCompanyId.mockResolvedValue(MOCK_CUSTOMER_ENTITY as any);
      apiService.setDefaultPaymentMethod.mockResolvedValue({} as any);
      repository.update.mockResolvedValue({} as any);

      await controller.setDefaultPaymentMethod(req, mockReply, customPaymentMethodId);

      expect(apiService.setDefaultPaymentMethod).toHaveBeenCalledWith(TEST_IDS.stripeCustomerId, customPaymentMethodId);
      expect(repository.update).toHaveBeenCalledWith({
        id: TEST_IDS.customerId,
        defaultPaymentMethodId: customPaymentMethodId,
      });
    });
  });

  describe("DELETE /stripe-customers/payment-methods/:paymentMethodId", () => {
    it("should detach payment method successfully", async () => {
      const req = createMockRequest();
      repository.findByCompanyId.mockResolvedValue(MOCK_CUSTOMER_ENTITY as any);
      apiService.detachPaymentMethod.mockResolvedValue({} as any);

      await controller.detachPaymentMethod(req, mockReply, TEST_IDS.paymentMethodId);

      expect(repository.findByCompanyId).toHaveBeenCalledWith({ companyId: TEST_IDS.companyId });
      expect(apiService.detachPaymentMethod).toHaveBeenCalledWith(TEST_IDS.paymentMethodId);
      expect(mockReply.send).toHaveBeenCalled();
    });

    it("should return 404 when customer not found", async () => {
      const req = createMockRequest();
      repository.findByCompanyId.mockResolvedValue(null);

      await controller.detachPaymentMethod(req, mockReply, TEST_IDS.paymentMethodId);

      expect(repository.findByCompanyId).toHaveBeenCalledWith({ companyId: TEST_IDS.companyId });
      expect(apiService.detachPaymentMethod).not.toHaveBeenCalled();
      expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
      expect(mockReply.send).toHaveBeenCalledWith({ error: "Customer not found" });
    });

    it("should clear default payment method if detached payment was default", async () => {
      const req = createMockRequest();
      const customerWithDefault = {
        ...MOCK_CUSTOMER_ENTITY,
        defaultPaymentMethodId: TEST_IDS.paymentMethodId,
      };
      repository.findByCompanyId.mockResolvedValue(customerWithDefault as any);
      apiService.detachPaymentMethod.mockResolvedValue({} as any);
      repository.update.mockResolvedValue({} as any);

      await controller.detachPaymentMethod(req, mockReply, TEST_IDS.paymentMethodId);

      expect(apiService.detachPaymentMethod).toHaveBeenCalledWith(TEST_IDS.paymentMethodId);
      expect(repository.update).toHaveBeenCalledWith({
        id: TEST_IDS.customerId,
        defaultPaymentMethodId: null,
      });
    });

    it("should not update repository if detached payment was not default", async () => {
      const req = createMockRequest();
      const customerWithDifferentDefault = {
        ...MOCK_CUSTOMER_ENTITY,
        defaultPaymentMethodId: "pm_different",
      };
      repository.findByCompanyId.mockResolvedValue(customerWithDifferentDefault as any);
      apiService.detachPaymentMethod.mockResolvedValue({} as any);

      await controller.detachPaymentMethod(req, mockReply, TEST_IDS.paymentMethodId);

      expect(apiService.detachPaymentMethod).toHaveBeenCalledWith(TEST_IDS.paymentMethodId);
      expect(repository.update).not.toHaveBeenCalled();
    });

    it("should extract paymentMethodId from path params", async () => {
      const req = createMockRequest();
      const customPaymentMethodId = "pm_detach_custom_789";
      repository.findByCompanyId.mockResolvedValue(MOCK_CUSTOMER_ENTITY as any);
      apiService.detachPaymentMethod.mockResolvedValue({} as any);

      await controller.detachPaymentMethod(req, mockReply, customPaymentMethodId);

      expect(apiService.detachPaymentMethod).toHaveBeenCalledWith(customPaymentMethodId);
    });
  });
});
