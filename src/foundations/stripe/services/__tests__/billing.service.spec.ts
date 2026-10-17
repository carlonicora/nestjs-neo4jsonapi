import { vi, describe, it, expect, beforeEach, afterEach, type Mocked } from "vitest";
// Mock problematic modules before any imports
vi.mock("../../../../foundations/chunker/chunker.module", () => ({
  ChunkerModule: class {},
}));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({}));

// Mock the barrel export to provide the imports that BillingService needs
vi.mock("@carlonicora/nestjs-neo4jsonapi", () => {
  const actual = vi.importActual("@carlonicora/nestjs-neo4jsonapi");

  return {
    ...actual,
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
import { HttpException, HttpStatus } from "@nestjs/common";
import Stripe from "stripe";
import { BillingService } from "../billing.service";
import { StripeCustomerRepository } from "../../../stripe-customer/repositories/stripe-customer.repository";
import { JsonApiService } from "../../../../core/jsonapi";
import { StripeCustomerApiService } from "../../../stripe-customer/services/stripe-customer-api.service";
import { StripePaymentService } from "../stripe.payment.service";
import { StripePortalService } from "../stripe.portal.service";
import { StripeCustomer } from "../../../stripe-customer/entities/stripe-customer.entity";
import {
  MOCK_CUSTOMER,
  MOCK_PAYMENT_METHOD,
  MOCK_SETUP_INTENT,
  MOCK_PORTAL_SESSION,
  TEST_IDS,
} from "../../__tests__/fixtures/stripe.fixtures";

describe("BillingService", () => {
  let service: BillingService;
  let stripeCustomerRepository: Mocked<StripeCustomerRepository>;
  let stripeCustomerApiService: Mocked<StripeCustomerApiService>;
  let stripePaymentService: Mocked<StripePaymentService>;
  let stripePortalService: Mocked<StripePortalService>;
  let jsonApiService: Mocked<JsonApiService>;

  // Test data constants
  const MOCK_STRIPE_CUSTOMER: StripeCustomer = {
    id: "billing_customer_123",
    type: "stripe-customers",
    stripeCustomerId: TEST_IDS.customerId,
    email: "test@example.com",
    name: "Test Customer",
    currency: "usd",
    balance: 0,
    delinquent: false,
    defaultPaymentMethodId: TEST_IDS.paymentMethodId,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
    company: {} as any,
  };

  const MOCK_JSON_API_RESPONSE = {
    data: {
      type: "billing-customers",
      id: MOCK_STRIPE_CUSTOMER.id,
      attributes: {
        stripeCustomerId: MOCK_STRIPE_CUSTOMER.stripeCustomerId,
        email: MOCK_STRIPE_CUSTOMER.email,
        name: MOCK_STRIPE_CUSTOMER.name,
        currency: MOCK_STRIPE_CUSTOMER.currency,
        balance: MOCK_STRIPE_CUSTOMER.balance,
        delinquent: MOCK_STRIPE_CUSTOMER.delinquent,
        defaultPaymentMethodId: MOCK_STRIPE_CUSTOMER.defaultPaymentMethodId,
      },
    },
  };

  beforeEach(async () => {
    const mockStripeCustomerRepository = {
      findByCompanyId: vi.fn(),
      findByStripeCustomerId: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateByStripeCustomerId: vi.fn(),
    };

    const mockStripeCustomerApiService = {
      createCustomer: vi.fn(),
      retrieveCustomer: vi.fn(),
      updateCustomer: vi.fn(),
      listPaymentMethods: vi.fn(),
      detachPaymentMethod: vi.fn(),
    };

    const mockStripePaymentService = {
      createSetupIntent: vi.fn(),
      retrievePaymentMethod: vi.fn(),
    };

    const mockStripePortalService = {
      createPortalSession: vi.fn(),
    };

    const mockJsonApiService = {
      buildSingle: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        {
          provide: StripeCustomerRepository,
          useValue: mockStripeCustomerRepository,
        },
        {
          provide: StripeCustomerApiService,
          useValue: mockStripeCustomerApiService,
        },
        {
          provide: StripePaymentService,
          useValue: mockStripePaymentService,
        },
        {
          provide: StripePortalService,
          useValue: mockStripePortalService,
        },
        {
          provide: JsonApiService,
          useValue: mockJsonApiService,
        },
      ],
    }).compile();

    service = module.get<BillingService>(BillingService);
    stripeCustomerRepository = module.get(StripeCustomerRepository);
    stripeCustomerApiService = module.get(StripeCustomerApiService);
    stripePaymentService = module.get(StripePaymentService);
    stripePortalService = module.get(StripePortalService);
    jsonApiService = module.get(JsonApiService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("getCustomerByCompanyId", () => {
    it("should return billing customer when found", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);

      const result = await service.getCustomerByCompanyId({ companyId: TEST_IDS.companyId });

      expect(stripeCustomerRepository.findByCompanyId).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
      });
      expect(result).toEqual(MOCK_STRIPE_CUSTOMER);
    });

    it("should return null when customer not found", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(null);

      const result = await service.getCustomerByCompanyId({ companyId: TEST_IDS.companyId });

      expect(result).toBeNull();
      expect(stripeCustomerRepository.findByCompanyId).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
      });
    });

    it("should delegate to repository without transformation", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);

      await service.getCustomerByCompanyId({ companyId: "test_company_id" });

      expect(stripeCustomerRepository.findByCompanyId).toHaveBeenCalledWith({
        companyId: "test_company_id",
      });
    });
  });

  describe("getCustomerOrFail", () => {
    it("should return billing customer when found", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);

      const result = await service.getCustomerOrFail({ companyId: TEST_IDS.companyId });

      expect(stripeCustomerRepository.findByCompanyId).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
      });
      expect(result).toEqual(MOCK_STRIPE_CUSTOMER);
    });

    it("should throw NOT_FOUND exception when customer not found", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(null);

      await expect(service.getCustomerOrFail({ companyId: TEST_IDS.companyId })).rejects.toThrow(
        new HttpException("Stripe customer not found for this company", HttpStatus.NOT_FOUND),
      );

      expect(stripeCustomerRepository.findByCompanyId).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
      });
    });

    it("should throw NOT_FOUND with correct status code", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(null);

      try {
        await service.getCustomerOrFail({ companyId: TEST_IDS.companyId });
        expect.unreachable("Should have thrown HttpException");
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(HttpStatus.NOT_FOUND);
        expect((error as HttpException).message).toBe("Stripe customer not found for this company");
      }
    });

    it("should throw NOT_FOUND with correct message", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(null);

      await expect(service.getCustomerOrFail({ companyId: "nonexistent_company" })).rejects.toThrow(
        "Stripe customer not found for this company",
      );
    });
  });

  describe("createCustomer", () => {
    const validCreateParams = {
      companyId: TEST_IDS.companyId,
      name: "New Customer",
      email: "new@example.com",
      currency: "usd",
    };

    it("should create customer successfully when no existing customer", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(null);
      stripeCustomerApiService.createCustomer.mockResolvedValue(MOCK_CUSTOMER);
      stripeCustomerRepository.create.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      jsonApiService.buildSingle.mockResolvedValue(MOCK_JSON_API_RESPONSE);

      const result = await service.createCustomer(validCreateParams);

      expect(stripeCustomerRepository.findByCompanyId).toHaveBeenCalledWith({
        companyId: validCreateParams.companyId,
      });
      expect(stripeCustomerApiService.createCustomer).toHaveBeenCalledWith({
        companyId: validCreateParams.companyId,
        email: validCreateParams.email,
        name: validCreateParams.name,
      });
      expect(stripeCustomerRepository.create).toHaveBeenCalledWith({
        companyId: validCreateParams.companyId,
        stripeCustomerId: MOCK_CUSTOMER.id,
        email: validCreateParams.email,
        name: validCreateParams.name,
        currency: validCreateParams.currency,
      });
      expect(jsonApiService.buildSingle).toHaveBeenCalledWith(expect.any(Object), MOCK_STRIPE_CUSTOMER);
      expect(result).toEqual(MOCK_JSON_API_RESPONSE);
    });

    it("should throw CONFLICT when customer already exists", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);

      await expect(service.createCustomer(validCreateParams)).rejects.toThrow(
        new HttpException("Billing customer already exists for this company", HttpStatus.CONFLICT),
      );

      expect(stripeCustomerRepository.findByCompanyId).toHaveBeenCalledWith({
        companyId: validCreateParams.companyId,
      });
      expect(stripeCustomerApiService.createCustomer).not.toHaveBeenCalled();
      expect(stripeCustomerRepository.create).not.toHaveBeenCalled();
    });

    it("should throw CONFLICT with correct status code", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);

      try {
        await service.createCustomer(validCreateParams);
        expect.unreachable("Should have thrown HttpException");
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(HttpStatus.CONFLICT);
        expect((error as HttpException).message).toBe("Billing customer already exists for this company");
      }
    });

    it("should create customer in Stripe before database", async () => {
      const callOrder: string[] = [];
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(null);
      stripeCustomerApiService.createCustomer.mockImplementation(async () => {
        callOrder.push("stripe");
        return MOCK_CUSTOMER;
      });
      stripeCustomerRepository.create.mockImplementation(async () => {
        callOrder.push("database");
        return MOCK_STRIPE_CUSTOMER;
      });
      jsonApiService.buildSingle.mockResolvedValue(MOCK_JSON_API_RESPONSE);

      await service.createCustomer(validCreateParams);

      expect(callOrder).toEqual(["stripe", "database"]);
    });

    it("should pass Stripe customer ID to database creation", async () => {
      const customStripeId = "cus_custom_12345";
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(null);
      stripeCustomerApiService.createCustomer.mockResolvedValue({
        ...MOCK_CUSTOMER,
        id: customStripeId,
      });
      stripeCustomerRepository.create.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      jsonApiService.buildSingle.mockResolvedValue(MOCK_JSON_API_RESPONSE);

      await service.createCustomer(validCreateParams);

      expect(stripeCustomerRepository.create).toHaveBeenCalledWith({
        companyId: validCreateParams.companyId,
        stripeCustomerId: customStripeId,
        email: validCreateParams.email,
        name: validCreateParams.name,
        currency: validCreateParams.currency,
      });
    });

    it("should return JSON:API formatted response", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(null);
      stripeCustomerApiService.createCustomer.mockResolvedValue(MOCK_CUSTOMER);
      stripeCustomerRepository.create.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      jsonApiService.buildSingle.mockResolvedValue(MOCK_JSON_API_RESPONSE);

      const result = await service.createCustomer(validCreateParams);

      expect(result).toEqual(MOCK_JSON_API_RESPONSE);
      expect(jsonApiService.buildSingle).toHaveBeenCalledWith(expect.any(Object), MOCK_STRIPE_CUSTOMER);
    });

    it("should preserve exact parameter values", async () => {
      const exactParams = {
        companyId: "exact_company_123",
        name: "Exact Name Test",
        email: "exact@test.com",
        currency: "eur",
      };
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(null);
      stripeCustomerApiService.createCustomer.mockResolvedValue(MOCK_CUSTOMER);
      stripeCustomerRepository.create.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      jsonApiService.buildSingle.mockResolvedValue(MOCK_JSON_API_RESPONSE);

      await service.createCustomer(exactParams);

      expect(stripeCustomerApiService.createCustomer).toHaveBeenCalledWith({
        companyId: exactParams.companyId,
        email: exactParams.email,
        name: exactParams.name,
      });
      expect(stripeCustomerRepository.create).toHaveBeenCalledWith({
        companyId: exactParams.companyId,
        stripeCustomerId: MOCK_CUSTOMER.id,
        email: exactParams.email,
        name: exactParams.name,
        currency: exactParams.currency,
      });
    });

    it("should handle Stripe customer creation failure", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(null);
      const stripeError = new Error("Stripe API error");
      stripeCustomerApiService.createCustomer.mockRejectedValue(stripeError);

      await expect(service.createCustomer(validCreateParams)).rejects.toThrow("Stripe API error");

      expect(stripeCustomerRepository.create).not.toHaveBeenCalled();
    });

    it("should handle database creation failure", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(null);
      stripeCustomerApiService.createCustomer.mockResolvedValue(MOCK_CUSTOMER);
      const dbError = new Error("Database error");
      stripeCustomerRepository.create.mockRejectedValue(dbError);

      await expect(service.createCustomer(validCreateParams)).rejects.toThrow("Database error");

      expect(stripeCustomerApiService.createCustomer).toHaveBeenCalled();
    });
  });

  describe("getCustomer", () => {
    it("should get customer and format as JSON:API", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      jsonApiService.buildSingle.mockResolvedValue(MOCK_JSON_API_RESPONSE);

      const result = await service.getCustomer({ companyId: TEST_IDS.companyId });

      expect(stripeCustomerRepository.findByCompanyId).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
      });
      expect(jsonApiService.buildSingle).toHaveBeenCalledWith(expect.any(Object), MOCK_STRIPE_CUSTOMER);
      expect(result).toEqual(MOCK_JSON_API_RESPONSE);
    });

    it("should throw NOT_FOUND when customer does not exist", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(null);

      await expect(service.getCustomer({ companyId: TEST_IDS.companyId })).rejects.toThrow(
        new HttpException("Stripe customer not found for this company", HttpStatus.NOT_FOUND),
      );

      expect(jsonApiService.buildSingle).not.toHaveBeenCalled();
    });

    it("should use getCustomerOrFail internally", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      jsonApiService.buildSingle.mockResolvedValue(MOCK_JSON_API_RESPONSE);

      await service.getCustomer({ companyId: TEST_IDS.companyId });

      expect(stripeCustomerRepository.findByCompanyId).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
      });
    });
  });

  describe("createSetupIntent", () => {
    it("should create setup intent successfully", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripePaymentService.createSetupIntent.mockResolvedValue(MOCK_SETUP_INTENT);

      const result = await service.createSetupIntent({ companyId: TEST_IDS.companyId });

      expect(stripeCustomerRepository.findByCompanyId).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
      });
      expect(stripePaymentService.createSetupIntent).toHaveBeenCalledWith({
        stripeCustomerId: MOCK_STRIPE_CUSTOMER.stripeCustomerId,
      });
      expect(result).toEqual({
        clientSecret: MOCK_SETUP_INTENT.client_secret,
      });
    });

    it("should throw NOT_FOUND when customer does not exist", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(null);

      await expect(service.createSetupIntent({ companyId: TEST_IDS.companyId })).rejects.toThrow(
        new HttpException("Stripe customer not found for this company", HttpStatus.NOT_FOUND),
      );

      expect(stripePaymentService.createSetupIntent).not.toHaveBeenCalled();
    });

    it("should return client secret from setup intent", async () => {
      const customClientSecret = "seti_custom_secret_123";
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripePaymentService.createSetupIntent.mockResolvedValue({
        ...MOCK_SETUP_INTENT,
        client_secret: customClientSecret,
      });

      const result = await service.createSetupIntent({ companyId: TEST_IDS.companyId });

      expect(result.clientSecret).toBe(customClientSecret);
    });

    it("should accept optional paymentMethodType parameter", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripePaymentService.createSetupIntent.mockResolvedValue(MOCK_SETUP_INTENT);

      await service.createSetupIntent({
        companyId: TEST_IDS.companyId,
        paymentMethodType: "card",
      });

      expect(stripePaymentService.createSetupIntent).toHaveBeenCalledWith({
        stripeCustomerId: MOCK_STRIPE_CUSTOMER.stripeCustomerId,
      });
    });
  });

  describe("createPortalSession", () => {
    it("should create portal session with default return URL", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripePortalService.createPortalSession.mockResolvedValue(MOCK_PORTAL_SESSION);

      const result = await service.createPortalSession({ companyId: TEST_IDS.companyId });

      expect(stripeCustomerRepository.findByCompanyId).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
      });
      expect(stripePortalService.createPortalSession).toHaveBeenCalledWith(
        MOCK_STRIPE_CUSTOMER.stripeCustomerId,
        undefined,
      );
      expect(result).toEqual({
        url: MOCK_PORTAL_SESSION.url,
      });
    });

    it("should create portal session with custom return URL", async () => {
      const customReturnUrl = "https://custom.com/billing";
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripePortalService.createPortalSession.mockResolvedValue({
        ...MOCK_PORTAL_SESSION,
        return_url: customReturnUrl,
      });

      const result = await service.createPortalSession({
        companyId: TEST_IDS.companyId,
        returnUrl: customReturnUrl,
      });

      expect(stripePortalService.createPortalSession).toHaveBeenCalledWith(
        MOCK_STRIPE_CUSTOMER.stripeCustomerId,
        customReturnUrl,
      );
      expect(result.url).toBe(MOCK_PORTAL_SESSION.url);
    });

    it("should throw NOT_FOUND when customer does not exist", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(null);

      await expect(service.createPortalSession({ companyId: TEST_IDS.companyId })).rejects.toThrow(
        new HttpException("Stripe customer not found for this company", HttpStatus.NOT_FOUND),
      );

      expect(stripePortalService.createPortalSession).not.toHaveBeenCalled();
    });

    it("should return portal session URL", async () => {
      const customUrl = "https://billing.stripe.com/custom_session";
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripePortalService.createPortalSession.mockResolvedValue({
        ...MOCK_PORTAL_SESSION,
        url: customUrl,
      });

      const result = await service.createPortalSession({ companyId: TEST_IDS.companyId });

      expect(result.url).toBe(customUrl);
    });
  });

  describe("listPaymentMethods", () => {
    it("should list payment methods for customer", async () => {
      const mockPaymentMethods = [MOCK_PAYMENT_METHOD];
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripeCustomerApiService.listPaymentMethods.mockResolvedValue(mockPaymentMethods);

      const result = await service.listPaymentMethods({ companyId: TEST_IDS.companyId });

      expect(stripeCustomerRepository.findByCompanyId).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
      });
      expect(stripeCustomerApiService.listPaymentMethods).toHaveBeenCalledWith(
        MOCK_STRIPE_CUSTOMER.stripeCustomerId,
        "card",
      );
      expect(result).toEqual({ data: mockPaymentMethods });
    });

    it("should throw NOT_FOUND when customer does not exist", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(null);

      await expect(service.listPaymentMethods({ companyId: TEST_IDS.companyId })).rejects.toThrow(
        new HttpException("Stripe customer not found for this company", HttpStatus.NOT_FOUND),
      );

      expect(stripeCustomerApiService.listPaymentMethods).not.toHaveBeenCalled();
    });

    it("should return empty array when no payment methods", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripeCustomerApiService.listPaymentMethods.mockResolvedValue([]);

      const result = await service.listPaymentMethods({ companyId: TEST_IDS.companyId });

      expect(result).toEqual({ data: [] });
    });

    it("should always use card as payment method type", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripeCustomerApiService.listPaymentMethods.mockResolvedValue([]);

      await service.listPaymentMethods({ companyId: TEST_IDS.companyId });

      expect(stripeCustomerApiService.listPaymentMethods).toHaveBeenCalledWith(
        MOCK_STRIPE_CUSTOMER.stripeCustomerId,
        "card",
      );
    });

    it("should return multiple payment methods", async () => {
      const multiplePaymentMethods = [
        MOCK_PAYMENT_METHOD,
        { ...MOCK_PAYMENT_METHOD, id: "pm_second_123" },
        { ...MOCK_PAYMENT_METHOD, id: "pm_third_456" },
      ];
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripeCustomerApiService.listPaymentMethods.mockResolvedValue(multiplePaymentMethods);

      const result = await service.listPaymentMethods({ companyId: TEST_IDS.companyId });

      expect(result.data).toHaveLength(3);
      expect(result.data).toEqual(multiplePaymentMethods);
    });
  });

  describe("setDefaultPaymentMethod", () => {
    it("should set default payment method in Stripe and database", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripeCustomerApiService.updateCustomer.mockResolvedValue(MOCK_CUSTOMER);
      stripeCustomerRepository.update.mockResolvedValue(MOCK_STRIPE_CUSTOMER);

      await service.setDefaultPaymentMethod({
        companyId: TEST_IDS.companyId,
        paymentMethodId: "pm_new_123",
      });

      expect(stripeCustomerRepository.findByCompanyId).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
      });
      expect(stripeCustomerApiService.updateCustomer).toHaveBeenCalledWith({
        stripeCustomerId: MOCK_STRIPE_CUSTOMER.stripeCustomerId,
        defaultPaymentMethodId: "pm_new_123",
      });
      expect(stripeCustomerRepository.update).toHaveBeenCalledWith({
        id: MOCK_STRIPE_CUSTOMER.id,
        defaultPaymentMethodId: "pm_new_123",
      });
    });

    it("should throw NOT_FOUND when customer does not exist", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(null);

      await expect(
        service.setDefaultPaymentMethod({
          companyId: TEST_IDS.companyId,
          paymentMethodId: "pm_test_123",
        }),
      ).rejects.toThrow(new HttpException("Stripe customer not found for this company", HttpStatus.NOT_FOUND));

      expect(stripeCustomerApiService.updateCustomer).not.toHaveBeenCalled();
      expect(stripeCustomerRepository.update).not.toHaveBeenCalled();
    });

    it("should update Stripe before database", async () => {
      const callOrder: string[] = [];
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripeCustomerApiService.updateCustomer.mockImplementation(async () => {
        callOrder.push("stripe");
        return MOCK_CUSTOMER;
      });
      stripeCustomerRepository.update.mockImplementation(async () => {
        callOrder.push("database");
        return MOCK_STRIPE_CUSTOMER;
      });

      await service.setDefaultPaymentMethod({
        companyId: TEST_IDS.companyId,
        paymentMethodId: "pm_test_123",
      });

      expect(callOrder).toEqual(["stripe", "database"]);
    });

    it("should not update database if Stripe update fails", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      const stripeError = new Error("Stripe update failed");
      stripeCustomerApiService.updateCustomer.mockRejectedValue(stripeError);

      await expect(
        service.setDefaultPaymentMethod({
          companyId: TEST_IDS.companyId,
          paymentMethodId: "pm_test_123",
        }),
      ).rejects.toThrow("Stripe update failed");

      expect(stripeCustomerRepository.update).not.toHaveBeenCalled();
    });

    it("should preserve exact payment method ID", async () => {
      const exactPaymentMethodId = "pm_exact_test_456789";
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripeCustomerApiService.updateCustomer.mockResolvedValue(MOCK_CUSTOMER);
      stripeCustomerRepository.update.mockResolvedValue(MOCK_STRIPE_CUSTOMER);

      await service.setDefaultPaymentMethod({
        companyId: TEST_IDS.companyId,
        paymentMethodId: exactPaymentMethodId,
      });

      expect(stripeCustomerApiService.updateCustomer).toHaveBeenCalledWith({
        stripeCustomerId: MOCK_STRIPE_CUSTOMER.stripeCustomerId,
        defaultPaymentMethodId: exactPaymentMethodId,
      });
      expect(stripeCustomerRepository.update).toHaveBeenCalledWith({
        id: MOCK_STRIPE_CUSTOMER.id,
        defaultPaymentMethodId: exactPaymentMethodId,
      });
    });
  });

  describe("removePaymentMethod", () => {
    it("should remove payment method successfully", async () => {
      const mockPaymentMethod: Stripe.PaymentMethod = {
        ...MOCK_PAYMENT_METHOD,
        customer: MOCK_STRIPE_CUSTOMER.stripeCustomerId,
      };
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripePaymentService.retrievePaymentMethod.mockResolvedValue(mockPaymentMethod);
      stripeCustomerApiService.detachPaymentMethod.mockResolvedValue(MOCK_PAYMENT_METHOD);

      await service.removePaymentMethod({
        companyId: TEST_IDS.companyId,
        paymentMethodId: TEST_IDS.paymentMethodId,
      });

      expect(stripeCustomerRepository.findByCompanyId).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
      });
      expect(stripePaymentService.retrievePaymentMethod).toHaveBeenCalledWith(TEST_IDS.paymentMethodId);
      expect(stripeCustomerApiService.detachPaymentMethod).toHaveBeenCalledWith(TEST_IDS.paymentMethodId);
    });

    it("should throw FORBIDDEN when payment method does not belong to customer", async () => {
      const mockPaymentMethod: Stripe.PaymentMethod = {
        ...MOCK_PAYMENT_METHOD,
        customer: "cus_different_customer",
      };
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripePaymentService.retrievePaymentMethod.mockResolvedValue(mockPaymentMethod);

      await expect(
        service.removePaymentMethod({
          companyId: TEST_IDS.companyId,
          paymentMethodId: TEST_IDS.paymentMethodId,
        }),
      ).rejects.toThrow(new HttpException("Payment method does not belong to this customer", HttpStatus.FORBIDDEN));

      expect(stripeCustomerApiService.detachPaymentMethod).not.toHaveBeenCalled();
    });

    it("should throw FORBIDDEN with correct status code", async () => {
      const mockPaymentMethod: Stripe.PaymentMethod = {
        ...MOCK_PAYMENT_METHOD,
        customer: "cus_different_customer",
      };
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripePaymentService.retrievePaymentMethod.mockResolvedValue(mockPaymentMethod);

      try {
        await service.removePaymentMethod({
          companyId: TEST_IDS.companyId,
          paymentMethodId: TEST_IDS.paymentMethodId,
        });
        expect.unreachable("Should have thrown HttpException");
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(HttpStatus.FORBIDDEN);
      }
    });

    it("should throw NOT_FOUND when customer does not exist", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(null);

      await expect(
        service.removePaymentMethod({
          companyId: TEST_IDS.companyId,
          paymentMethodId: TEST_IDS.paymentMethodId,
        }),
      ).rejects.toThrow(new HttpException("Stripe customer not found for this company", HttpStatus.NOT_FOUND));

      expect(stripePaymentService.retrievePaymentMethod).not.toHaveBeenCalled();
    });

    it("should clear defaultPaymentMethodId when removing default payment method", async () => {
      const customerWithDefaultPM = {
        ...MOCK_STRIPE_CUSTOMER,
        defaultPaymentMethodId: TEST_IDS.paymentMethodId,
      };
      const mockPaymentMethod: Stripe.PaymentMethod = {
        ...MOCK_PAYMENT_METHOD,
        customer: MOCK_STRIPE_CUSTOMER.stripeCustomerId,
      };
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(customerWithDefaultPM);
      stripePaymentService.retrievePaymentMethod.mockResolvedValue(mockPaymentMethod);
      stripeCustomerApiService.detachPaymentMethod.mockResolvedValue(MOCK_PAYMENT_METHOD);
      stripeCustomerRepository.update.mockResolvedValue(customerWithDefaultPM);

      await service.removePaymentMethod({
        companyId: TEST_IDS.companyId,
        paymentMethodId: TEST_IDS.paymentMethodId,
      });

      expect(stripeCustomerApiService.detachPaymentMethod).toHaveBeenCalledWith(TEST_IDS.paymentMethodId);
      expect(stripeCustomerRepository.update).toHaveBeenCalledWith({
        id: customerWithDefaultPM.id,
        defaultPaymentMethodId: null,
      });
    });

    it("should not update database when removing non-default payment method", async () => {
      const customerWithDifferentDefaultPM = {
        ...MOCK_STRIPE_CUSTOMER,
        defaultPaymentMethodId: "pm_different_123",
      };
      const mockPaymentMethod: Stripe.PaymentMethod = {
        ...MOCK_PAYMENT_METHOD,
        customer: MOCK_STRIPE_CUSTOMER.stripeCustomerId,
      };
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(customerWithDifferentDefaultPM);
      stripePaymentService.retrievePaymentMethod.mockResolvedValue(mockPaymentMethod);
      stripeCustomerApiService.detachPaymentMethod.mockResolvedValue(MOCK_PAYMENT_METHOD);

      await service.removePaymentMethod({
        companyId: TEST_IDS.companyId,
        paymentMethodId: TEST_IDS.paymentMethodId,
      });

      expect(stripeCustomerApiService.detachPaymentMethod).toHaveBeenCalledWith(TEST_IDS.paymentMethodId);
      expect(stripeCustomerRepository.update).not.toHaveBeenCalled();
    });

    it("should validate ownership before detaching", async () => {
      const mockPaymentMethod: Stripe.PaymentMethod = {
        ...MOCK_PAYMENT_METHOD,
        customer: MOCK_STRIPE_CUSTOMER.stripeCustomerId,
      };
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripePaymentService.retrievePaymentMethod.mockResolvedValue(mockPaymentMethod);
      stripeCustomerApiService.detachPaymentMethod.mockResolvedValue(MOCK_PAYMENT_METHOD);

      await service.removePaymentMethod({
        companyId: TEST_IDS.companyId,
        paymentMethodId: TEST_IDS.paymentMethodId,
      });

      // Verify ownership validation by checking retrievePaymentMethod was called
      expect(stripePaymentService.retrievePaymentMethod).toHaveBeenCalledWith(TEST_IDS.paymentMethodId);
      expect(stripeCustomerApiService.detachPaymentMethod).toHaveBeenCalledWith(TEST_IDS.paymentMethodId);
    });

    it("should handle payment method with null customer", async () => {
      const mockPaymentMethod: Stripe.PaymentMethod = {
        ...MOCK_PAYMENT_METHOD,
        customer: null,
      };
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripePaymentService.retrievePaymentMethod.mockResolvedValue(mockPaymentMethod);

      await expect(
        service.removePaymentMethod({
          companyId: TEST_IDS.companyId,
          paymentMethodId: TEST_IDS.paymentMethodId,
        }),
      ).rejects.toThrow(new HttpException("Payment method does not belong to this customer", HttpStatus.FORBIDDEN));
    });
  });

  describe("syncCustomerFromStripe", () => {
    it("should sync customer data from Stripe to database", async () => {
      const mockStripeCustomer: Stripe.Customer = {
        ...MOCK_CUSTOMER,
        email: "updated@example.com",
        name: "Updated Name",
        balance: 100,
        delinquent: true,
        invoice_settings: {
          ...MOCK_CUSTOMER.invoice_settings,
          default_payment_method: "pm_updated_123",
        },
      };
      stripeCustomerApiService.retrieveCustomer.mockResolvedValue(mockStripeCustomer);
      stripeCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripeCustomerRepository.updateByStripeCustomerId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);

      await service.syncCustomerFromStripe({ stripeCustomerId: TEST_IDS.customerId });

      expect(stripeCustomerApiService.retrieveCustomer).toHaveBeenCalledWith(TEST_IDS.customerId);
      expect(stripeCustomerRepository.findByStripeCustomerId).toHaveBeenCalledWith({
        stripeCustomerId: TEST_IDS.customerId,
      });
      expect(stripeCustomerRepository.updateByStripeCustomerId).toHaveBeenCalledWith({
        stripeCustomerId: TEST_IDS.customerId,
        email: "updated@example.com",
        name: "Updated Name",
        defaultPaymentMethodId: "pm_updated_123",
        balance: 100,
        delinquent: true,
      });
    });

    it("should not update when customer does not exist in database", async () => {
      stripeCustomerApiService.retrieveCustomer.mockResolvedValue(MOCK_CUSTOMER);
      stripeCustomerRepository.findByStripeCustomerId.mockResolvedValue(null);

      await service.syncCustomerFromStripe({ stripeCustomerId: TEST_IDS.customerId });

      expect(stripeCustomerApiService.retrieveCustomer).toHaveBeenCalledWith(TEST_IDS.customerId);
      expect(stripeCustomerRepository.findByStripeCustomerId).toHaveBeenCalledWith({
        stripeCustomerId: TEST_IDS.customerId,
      });
      expect(stripeCustomerRepository.updateByStripeCustomerId).not.toHaveBeenCalled();
    });

    it("should silently ignore 'Customer has been deleted' error", async () => {
      const deletedError = new Error("Customer has been deleted");
      stripeCustomerApiService.retrieveCustomer.mockRejectedValue(deletedError);

      await expect(service.syncCustomerFromStripe({ stripeCustomerId: TEST_IDS.customerId })).resolves.not.toThrow();

      expect(stripeCustomerApiService.retrieveCustomer).toHaveBeenCalledWith(TEST_IDS.customerId);
      expect(stripeCustomerRepository.updateByStripeCustomerId).not.toHaveBeenCalled();
    });

    it("should rethrow other errors", async () => {
      const otherError = new Error("Some other Stripe error");
      stripeCustomerApiService.retrieveCustomer.mockRejectedValue(otherError);

      await expect(service.syncCustomerFromStripe({ stripeCustomerId: TEST_IDS.customerId })).rejects.toThrow(
        "Some other Stripe error",
      );

      expect(stripeCustomerRepository.updateByStripeCustomerId).not.toHaveBeenCalled();
    });

    it("should use existing email when Stripe customer has null email", async () => {
      const mockStripeCustomer: Stripe.Customer = {
        ...MOCK_CUSTOMER,
        email: null,
        name: "Updated Name",
      };
      stripeCustomerApiService.retrieveCustomer.mockResolvedValue(mockStripeCustomer);
      stripeCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripeCustomerRepository.updateByStripeCustomerId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);

      await service.syncCustomerFromStripe({ stripeCustomerId: TEST_IDS.customerId });

      expect(stripeCustomerRepository.updateByStripeCustomerId).toHaveBeenCalledWith({
        stripeCustomerId: TEST_IDS.customerId,
        email: MOCK_STRIPE_CUSTOMER.email,
        name: "Updated Name",
        defaultPaymentMethodId: undefined,
        balance: mockStripeCustomer.balance,
        delinquent: false,
      });
    });

    it("should use existing name when Stripe customer has null name", async () => {
      const mockStripeCustomer: Stripe.Customer = {
        ...MOCK_CUSTOMER,
        email: "updated@example.com",
        name: null,
      };
      stripeCustomerApiService.retrieveCustomer.mockResolvedValue(mockStripeCustomer);
      stripeCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripeCustomerRepository.updateByStripeCustomerId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);

      await service.syncCustomerFromStripe({ stripeCustomerId: TEST_IDS.customerId });

      expect(stripeCustomerRepository.updateByStripeCustomerId).toHaveBeenCalledWith({
        stripeCustomerId: TEST_IDS.customerId,
        email: "updated@example.com",
        name: MOCK_STRIPE_CUSTOMER.name,
        defaultPaymentMethodId: undefined,
        balance: mockStripeCustomer.balance,
        delinquent: false,
      });
    });

    it("should handle default payment method as PaymentMethod object", async () => {
      const mockStripeCustomer: Stripe.Customer = {
        ...MOCK_CUSTOMER,
        invoice_settings: {
          ...MOCK_CUSTOMER.invoice_settings,
          default_payment_method: MOCK_PAYMENT_METHOD as any,
        },
      };
      stripeCustomerApiService.retrieveCustomer.mockResolvedValue(mockStripeCustomer);
      stripeCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripeCustomerRepository.updateByStripeCustomerId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);

      await service.syncCustomerFromStripe({ stripeCustomerId: TEST_IDS.customerId });

      expect(stripeCustomerRepository.updateByStripeCustomerId).toHaveBeenCalledWith({
        stripeCustomerId: TEST_IDS.customerId,
        email: mockStripeCustomer.email,
        name: mockStripeCustomer.name,
        defaultPaymentMethodId: MOCK_PAYMENT_METHOD.id,
        balance: mockStripeCustomer.balance,
        delinquent: false,
      });
    });

    it("should handle default payment method as string", async () => {
      const pmId = "pm_string_123";
      const mockStripeCustomer: Stripe.Customer = {
        ...MOCK_CUSTOMER,
        invoice_settings: {
          ...MOCK_CUSTOMER.invoice_settings,
          default_payment_method: pmId,
        },
      };
      stripeCustomerApiService.retrieveCustomer.mockResolvedValue(mockStripeCustomer);
      stripeCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripeCustomerRepository.updateByStripeCustomerId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);

      await service.syncCustomerFromStripe({ stripeCustomerId: TEST_IDS.customerId });

      expect(stripeCustomerRepository.updateByStripeCustomerId).toHaveBeenCalledWith({
        stripeCustomerId: TEST_IDS.customerId,
        email: mockStripeCustomer.email,
        name: mockStripeCustomer.name,
        defaultPaymentMethodId: pmId,
        balance: mockStripeCustomer.balance,
        delinquent: false,
      });
    });

    it("should default delinquent to false when null", async () => {
      const mockStripeCustomer: Stripe.Customer = {
        ...MOCK_CUSTOMER,
        delinquent: null as any,
      };
      stripeCustomerApiService.retrieveCustomer.mockResolvedValue(mockStripeCustomer);
      stripeCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripeCustomerRepository.updateByStripeCustomerId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);

      await service.syncCustomerFromStripe({ stripeCustomerId: TEST_IDS.customerId });

      expect(stripeCustomerRepository.updateByStripeCustomerId).toHaveBeenCalledWith(
        expect.objectContaining({
          delinquent: false,
        }),
      );
    });
  });

  describe("Edge Cases", () => {
    it("should handle concurrent requests for same company", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      jsonApiService.buildSingle.mockResolvedValue(MOCK_JSON_API_RESPONSE);

      const promises = [
        service.getCustomer({ companyId: TEST_IDS.companyId }),
        service.getCustomer({ companyId: TEST_IDS.companyId }),
        service.getCustomer({ companyId: TEST_IDS.companyId }),
      ];

      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);
      expect(stripeCustomerRepository.findByCompanyId).toHaveBeenCalledTimes(3);
    });

    it("should handle empty string company ID gracefully", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(null);

      await expect(service.getCustomerOrFail({ companyId: "" })).rejects.toThrow(
        new HttpException("Stripe customer not found for this company", HttpStatus.NOT_FOUND),
      );
    });

    it("should preserve exact Stripe customer ID in all operations", async () => {
      const exactStripeId = "cus_exact_test_123456";
      const customerWithExactId = {
        ...MOCK_STRIPE_CUSTOMER,
        stripeCustomerId: exactStripeId,
      };
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(customerWithExactId);
      stripePaymentService.createSetupIntent.mockResolvedValue(MOCK_SETUP_INTENT);

      await service.createSetupIntent({ companyId: TEST_IDS.companyId });

      expect(stripePaymentService.createSetupIntent).toHaveBeenCalledWith({
        stripeCustomerId: exactStripeId,
      });
    });
  });

  describe("Service Integration", () => {
    it("should call repository methods with correct parameters", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      jsonApiService.buildSingle.mockResolvedValue(MOCK_JSON_API_RESPONSE);

      await service.getCustomer({ companyId: TEST_IDS.companyId });

      expect(stripeCustomerRepository.findByCompanyId).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
      });
    });

    it("should orchestrate multiple service calls in correct order", async () => {
      const callOrder: string[] = [];
      stripeCustomerRepository.findByCompanyId.mockImplementation(async () => {
        callOrder.push("checkExisting");
        return null;
      });
      stripeCustomerApiService.createCustomer.mockImplementation(async () => {
        callOrder.push("createStripe");
        return MOCK_CUSTOMER;
      });
      stripeCustomerRepository.create.mockImplementation(async () => {
        callOrder.push("createDatabase");
        return MOCK_STRIPE_CUSTOMER;
      });
      jsonApiService.buildSingle.mockImplementation(async () => {
        callOrder.push("formatResponse");
        return MOCK_JSON_API_RESPONSE;
      });

      await service.createCustomer({
        companyId: TEST_IDS.companyId,
        name: "Test",
        email: "test@test.com",
        currency: "usd",
      });

      expect(callOrder).toEqual(["checkExisting", "createStripe", "createDatabase", "formatResponse"]);
    });
  });
});
