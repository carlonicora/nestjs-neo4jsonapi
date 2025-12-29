// Mock problematic modules before any imports
jest.mock("../../../../foundations/chunker/chunker.module", () => ({
  ChunkerModule: class {},
}));
jest.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({}));

// Mock the barrel export to provide the imports that BillingService needs
jest.mock("@carlonicora/nestjs-neo4jsonapi", () => {
  const actual = jest.requireActual("@carlonicora/nestjs-neo4jsonapi");

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
import { BillingCustomerRepository } from "../../repositories/billing-customer.repository";
import {
  JsonApiService,
  StripeCustomerService,
  StripePaymentService,
  StripePortalService,
} from "@carlonicora/nestjs-neo4jsonapi";
import { BillingCustomer } from "../../entities/billing-customer.entity";
import {
  MOCK_CUSTOMER,
  MOCK_PAYMENT_METHOD,
  MOCK_SETUP_INTENT,
  MOCK_PORTAL_SESSION,
  TEST_IDS,
} from "../../__tests__/fixtures/stripe.fixtures";

describe("BillingService", () => {
  let service: BillingService;
  let billingCustomerRepository: jest.Mocked<BillingCustomerRepository>;
  let stripeCustomerService: jest.Mocked<StripeCustomerService>;
  let stripePaymentService: jest.Mocked<StripePaymentService>;
  let stripePortalService: jest.Mocked<StripePortalService>;
  let jsonApiService: jest.Mocked<JsonApiService>;

  // Test data constants
  const MOCK_BILLING_CUSTOMER: BillingCustomer = {
    id: "billing_customer_123",
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
      id: MOCK_BILLING_CUSTOMER.id,
      attributes: {
        stripeCustomerId: MOCK_BILLING_CUSTOMER.stripeCustomerId,
        email: MOCK_BILLING_CUSTOMER.email,
        name: MOCK_BILLING_CUSTOMER.name,
        currency: MOCK_BILLING_CUSTOMER.currency,
        balance: MOCK_BILLING_CUSTOMER.balance,
        delinquent: MOCK_BILLING_CUSTOMER.delinquent,
        defaultPaymentMethodId: MOCK_BILLING_CUSTOMER.defaultPaymentMethodId,
      },
    },
  };

  beforeEach(async () => {
    const mockBillingCustomerRepository = {
      findByCompanyId: jest.fn(),
      findByStripeCustomerId: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateByStripeCustomerId: jest.fn(),
    };

    const mockStripeCustomerService = {
      createCustomer: jest.fn(),
      retrieveCustomer: jest.fn(),
      updateCustomer: jest.fn(),
      listPaymentMethods: jest.fn(),
      detachPaymentMethod: jest.fn(),
    };

    const mockStripePaymentService = {
      createSetupIntent: jest.fn(),
      retrievePaymentMethod: jest.fn(),
    };

    const mockStripePortalService = {
      createPortalSession: jest.fn(),
    };

    const mockJsonApiService = {
      buildSingle: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        {
          provide: BillingCustomerRepository,
          useValue: mockBillingCustomerRepository,
        },
        {
          provide: StripeCustomerService,
          useValue: mockStripeCustomerService,
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
    billingCustomerRepository = module.get(BillingCustomerRepository);
    stripeCustomerService = module.get(StripeCustomerService);
    stripePaymentService = module.get(StripePaymentService);
    stripePortalService = module.get(StripePortalService);
    jsonApiService = module.get(JsonApiService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("getCustomerByCompanyId", () => {
    it("should return billing customer when found", async () => {
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);

      const result = await service.getCustomerByCompanyId({ companyId: TEST_IDS.companyId });

      expect(billingCustomerRepository.findByCompanyId).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
      });
      expect(result).toEqual(MOCK_BILLING_CUSTOMER);
    });

    it("should return null when customer not found", async () => {
      billingCustomerRepository.findByCompanyId.mockResolvedValue(null);

      const result = await service.getCustomerByCompanyId({ companyId: TEST_IDS.companyId });

      expect(result).toBeNull();
      expect(billingCustomerRepository.findByCompanyId).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
      });
    });

    it("should delegate to repository without transformation", async () => {
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);

      await service.getCustomerByCompanyId({ companyId: "test_company_id" });

      expect(billingCustomerRepository.findByCompanyId).toHaveBeenCalledWith({
        companyId: "test_company_id",
      });
    });
  });

  describe("getCustomerOrFail", () => {
    it("should return billing customer when found", async () => {
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);

      const result = await service.getCustomerOrFail({ companyId: TEST_IDS.companyId });

      expect(billingCustomerRepository.findByCompanyId).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
      });
      expect(result).toEqual(MOCK_BILLING_CUSTOMER);
    });

    it("should throw NOT_FOUND exception when customer not found", async () => {
      billingCustomerRepository.findByCompanyId.mockResolvedValue(null);

      await expect(service.getCustomerOrFail({ companyId: TEST_IDS.companyId })).rejects.toThrow(
        new HttpException("Billing customer not found for this company", HttpStatus.NOT_FOUND),
      );

      expect(billingCustomerRepository.findByCompanyId).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
      });
    });

    it("should throw NOT_FOUND with correct status code", async () => {
      billingCustomerRepository.findByCompanyId.mockResolvedValue(null);

      try {
        await service.getCustomerOrFail({ companyId: TEST_IDS.companyId });
        fail("Should have thrown HttpException");
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(HttpStatus.NOT_FOUND);
        expect((error as HttpException).message).toBe("Billing customer not found for this company");
      }
    });

    it("should throw NOT_FOUND with correct message", async () => {
      billingCustomerRepository.findByCompanyId.mockResolvedValue(null);

      await expect(service.getCustomerOrFail({ companyId: "nonexistent_company" })).rejects.toThrow(
        "Billing customer not found for this company",
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
      billingCustomerRepository.findByCompanyId.mockResolvedValue(null);
      stripeCustomerService.createCustomer.mockResolvedValue(MOCK_CUSTOMER);
      billingCustomerRepository.create.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE);

      const result = await service.createCustomer(validCreateParams);

      expect(billingCustomerRepository.findByCompanyId).toHaveBeenCalledWith({
        companyId: validCreateParams.companyId,
      });
      expect(stripeCustomerService.createCustomer).toHaveBeenCalledWith({
        companyId: validCreateParams.companyId,
        email: validCreateParams.email,
        name: validCreateParams.name,
      });
      expect(billingCustomerRepository.create).toHaveBeenCalledWith({
        companyId: validCreateParams.companyId,
        stripeCustomerId: MOCK_CUSTOMER.id,
        email: validCreateParams.email,
        name: validCreateParams.name,
        currency: validCreateParams.currency,
      });
      expect(jsonApiService.buildSingle).toHaveBeenCalledWith(expect.any(Object), MOCK_BILLING_CUSTOMER);
      expect(result).toEqual(MOCK_JSON_API_RESPONSE);
    });

    it("should throw CONFLICT when customer already exists", async () => {
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);

      await expect(service.createCustomer(validCreateParams)).rejects.toThrow(
        new HttpException("Billing customer already exists for this company", HttpStatus.CONFLICT),
      );

      expect(billingCustomerRepository.findByCompanyId).toHaveBeenCalledWith({
        companyId: validCreateParams.companyId,
      });
      expect(stripeCustomerService.createCustomer).not.toHaveBeenCalled();
      expect(billingCustomerRepository.create).not.toHaveBeenCalled();
    });

    it("should throw CONFLICT with correct status code", async () => {
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);

      try {
        await service.createCustomer(validCreateParams);
        fail("Should have thrown HttpException");
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(HttpStatus.CONFLICT);
        expect((error as HttpException).message).toBe("Billing customer already exists for this company");
      }
    });

    it("should create customer in Stripe before database", async () => {
      const callOrder: string[] = [];
      billingCustomerRepository.findByCompanyId.mockResolvedValue(null);
      stripeCustomerService.createCustomer.mockImplementation(async () => {
        callOrder.push("stripe");
        return MOCK_CUSTOMER;
      });
      billingCustomerRepository.create.mockImplementation(async () => {
        callOrder.push("database");
        return MOCK_BILLING_CUSTOMER;
      });
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE);

      await service.createCustomer(validCreateParams);

      expect(callOrder).toEqual(["stripe", "database"]);
    });

    it("should pass Stripe customer ID to database creation", async () => {
      const customStripeId = "cus_custom_12345";
      billingCustomerRepository.findByCompanyId.mockResolvedValue(null);
      stripeCustomerService.createCustomer.mockResolvedValue({
        ...MOCK_CUSTOMER,
        id: customStripeId,
      });
      billingCustomerRepository.create.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE);

      await service.createCustomer(validCreateParams);

      expect(billingCustomerRepository.create).toHaveBeenCalledWith({
        companyId: validCreateParams.companyId,
        stripeCustomerId: customStripeId,
        email: validCreateParams.email,
        name: validCreateParams.name,
        currency: validCreateParams.currency,
      });
    });

    it("should return JSON:API formatted response", async () => {
      billingCustomerRepository.findByCompanyId.mockResolvedValue(null);
      stripeCustomerService.createCustomer.mockResolvedValue(MOCK_CUSTOMER);
      billingCustomerRepository.create.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE);

      const result = await service.createCustomer(validCreateParams);

      expect(result).toEqual(MOCK_JSON_API_RESPONSE);
      expect(jsonApiService.buildSingle).toHaveBeenCalledWith(expect.any(Object), MOCK_BILLING_CUSTOMER);
    });

    it("should preserve exact parameter values", async () => {
      const exactParams = {
        companyId: "exact_company_123",
        name: "Exact Name Test",
        email: "exact@test.com",
        currency: "eur",
      };
      billingCustomerRepository.findByCompanyId.mockResolvedValue(null);
      stripeCustomerService.createCustomer.mockResolvedValue(MOCK_CUSTOMER);
      billingCustomerRepository.create.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE);

      await service.createCustomer(exactParams);

      expect(stripeCustomerService.createCustomer).toHaveBeenCalledWith({
        companyId: exactParams.companyId,
        email: exactParams.email,
        name: exactParams.name,
      });
      expect(billingCustomerRepository.create).toHaveBeenCalledWith({
        companyId: exactParams.companyId,
        stripeCustomerId: MOCK_CUSTOMER.id,
        email: exactParams.email,
        name: exactParams.name,
        currency: exactParams.currency,
      });
    });

    it("should handle Stripe customer creation failure", async () => {
      billingCustomerRepository.findByCompanyId.mockResolvedValue(null);
      const stripeError = new Error("Stripe API error");
      stripeCustomerService.createCustomer.mockRejectedValue(stripeError);

      await expect(service.createCustomer(validCreateParams)).rejects.toThrow("Stripe API error");

      expect(billingCustomerRepository.create).not.toHaveBeenCalled();
    });

    it("should handle database creation failure", async () => {
      billingCustomerRepository.findByCompanyId.mockResolvedValue(null);
      stripeCustomerService.createCustomer.mockResolvedValue(MOCK_CUSTOMER);
      const dbError = new Error("Database error");
      billingCustomerRepository.create.mockRejectedValue(dbError);

      await expect(service.createCustomer(validCreateParams)).rejects.toThrow("Database error");

      expect(stripeCustomerService.createCustomer).toHaveBeenCalled();
    });
  });

  describe("getCustomer", () => {
    it("should get customer and format as JSON:API", async () => {
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE);

      const result = await service.getCustomer({ companyId: TEST_IDS.companyId });

      expect(billingCustomerRepository.findByCompanyId).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
      });
      expect(jsonApiService.buildSingle).toHaveBeenCalledWith(expect.any(Object), MOCK_BILLING_CUSTOMER);
      expect(result).toEqual(MOCK_JSON_API_RESPONSE);
    });

    it("should throw NOT_FOUND when customer does not exist", async () => {
      billingCustomerRepository.findByCompanyId.mockResolvedValue(null);

      await expect(service.getCustomer({ companyId: TEST_IDS.companyId })).rejects.toThrow(
        new HttpException("Billing customer not found for this company", HttpStatus.NOT_FOUND),
      );

      expect(jsonApiService.buildSingle).not.toHaveBeenCalled();
    });

    it("should use getCustomerOrFail internally", async () => {
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE);

      await service.getCustomer({ companyId: TEST_IDS.companyId });

      expect(billingCustomerRepository.findByCompanyId).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
      });
    });
  });

  describe("createSetupIntent", () => {
    it("should create setup intent successfully", async () => {
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripePaymentService.createSetupIntent.mockResolvedValue(MOCK_SETUP_INTENT);

      const result = await service.createSetupIntent({ companyId: TEST_IDS.companyId });

      expect(billingCustomerRepository.findByCompanyId).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
      });
      expect(stripePaymentService.createSetupIntent).toHaveBeenCalledWith({
        stripeCustomerId: MOCK_BILLING_CUSTOMER.stripeCustomerId,
      });
      expect(result).toEqual({
        clientSecret: MOCK_SETUP_INTENT.client_secret,
      });
    });

    it("should throw NOT_FOUND when customer does not exist", async () => {
      billingCustomerRepository.findByCompanyId.mockResolvedValue(null);

      await expect(service.createSetupIntent({ companyId: TEST_IDS.companyId })).rejects.toThrow(
        new HttpException("Billing customer not found for this company", HttpStatus.NOT_FOUND),
      );

      expect(stripePaymentService.createSetupIntent).not.toHaveBeenCalled();
    });

    it("should return client secret from setup intent", async () => {
      const customClientSecret = "seti_custom_secret_123";
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripePaymentService.createSetupIntent.mockResolvedValue({
        ...MOCK_SETUP_INTENT,
        client_secret: customClientSecret,
      });

      const result = await service.createSetupIntent({ companyId: TEST_IDS.companyId });

      expect(result.clientSecret).toBe(customClientSecret);
    });

    it("should accept optional paymentMethodType parameter", async () => {
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripePaymentService.createSetupIntent.mockResolvedValue(MOCK_SETUP_INTENT);

      await service.createSetupIntent({
        companyId: TEST_IDS.companyId,
        paymentMethodType: "card",
      });

      expect(stripePaymentService.createSetupIntent).toHaveBeenCalledWith({
        stripeCustomerId: MOCK_BILLING_CUSTOMER.stripeCustomerId,
      });
    });
  });

  describe("createPortalSession", () => {
    it("should create portal session with default return URL", async () => {
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripePortalService.createPortalSession.mockResolvedValue(MOCK_PORTAL_SESSION);

      const result = await service.createPortalSession({ companyId: TEST_IDS.companyId });

      expect(billingCustomerRepository.findByCompanyId).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
      });
      expect(stripePortalService.createPortalSession).toHaveBeenCalledWith(
        MOCK_BILLING_CUSTOMER.stripeCustomerId,
        undefined,
      );
      expect(result).toEqual({
        url: MOCK_PORTAL_SESSION.url,
      });
    });

    it("should create portal session with custom return URL", async () => {
      const customReturnUrl = "https://custom.com/billing";
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripePortalService.createPortalSession.mockResolvedValue({
        ...MOCK_PORTAL_SESSION,
        return_url: customReturnUrl,
      });

      const result = await service.createPortalSession({
        companyId: TEST_IDS.companyId,
        returnUrl: customReturnUrl,
      });

      expect(stripePortalService.createPortalSession).toHaveBeenCalledWith(
        MOCK_BILLING_CUSTOMER.stripeCustomerId,
        customReturnUrl,
      );
      expect(result.url).toBe(MOCK_PORTAL_SESSION.url);
    });

    it("should throw NOT_FOUND when customer does not exist", async () => {
      billingCustomerRepository.findByCompanyId.mockResolvedValue(null);

      await expect(service.createPortalSession({ companyId: TEST_IDS.companyId })).rejects.toThrow(
        new HttpException("Billing customer not found for this company", HttpStatus.NOT_FOUND),
      );

      expect(stripePortalService.createPortalSession).not.toHaveBeenCalled();
    });

    it("should return portal session URL", async () => {
      const customUrl = "https://billing.stripe.com/custom_session";
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
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
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripeCustomerService.listPaymentMethods.mockResolvedValue(mockPaymentMethods);

      const result = await service.listPaymentMethods({ companyId: TEST_IDS.companyId });

      expect(billingCustomerRepository.findByCompanyId).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
      });
      expect(stripeCustomerService.listPaymentMethods).toHaveBeenCalledWith(
        MOCK_BILLING_CUSTOMER.stripeCustomerId,
        "card",
      );
      expect(result).toEqual({ data: mockPaymentMethods });
    });

    it("should throw NOT_FOUND when customer does not exist", async () => {
      billingCustomerRepository.findByCompanyId.mockResolvedValue(null);

      await expect(service.listPaymentMethods({ companyId: TEST_IDS.companyId })).rejects.toThrow(
        new HttpException("Billing customer not found for this company", HttpStatus.NOT_FOUND),
      );

      expect(stripeCustomerService.listPaymentMethods).not.toHaveBeenCalled();
    });

    it("should return empty array when no payment methods", async () => {
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripeCustomerService.listPaymentMethods.mockResolvedValue([]);

      const result = await service.listPaymentMethods({ companyId: TEST_IDS.companyId });

      expect(result).toEqual({ data: [] });
    });

    it("should always use card as payment method type", async () => {
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripeCustomerService.listPaymentMethods.mockResolvedValue([]);

      await service.listPaymentMethods({ companyId: TEST_IDS.companyId });

      expect(stripeCustomerService.listPaymentMethods).toHaveBeenCalledWith(
        MOCK_BILLING_CUSTOMER.stripeCustomerId,
        "card",
      );
    });

    it("should return multiple payment methods", async () => {
      const multiplePaymentMethods = [
        MOCK_PAYMENT_METHOD,
        { ...MOCK_PAYMENT_METHOD, id: "pm_second_123" },
        { ...MOCK_PAYMENT_METHOD, id: "pm_third_456" },
      ];
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripeCustomerService.listPaymentMethods.mockResolvedValue(multiplePaymentMethods);

      const result = await service.listPaymentMethods({ companyId: TEST_IDS.companyId });

      expect(result.data).toHaveLength(3);
      expect(result.data).toEqual(multiplePaymentMethods);
    });
  });

  describe("setDefaultPaymentMethod", () => {
    it("should set default payment method in Stripe and database", async () => {
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripeCustomerService.updateCustomer.mockResolvedValue(MOCK_CUSTOMER);
      billingCustomerRepository.update.mockResolvedValue(MOCK_BILLING_CUSTOMER);

      await service.setDefaultPaymentMethod({
        companyId: TEST_IDS.companyId,
        paymentMethodId: "pm_new_123",
      });

      expect(billingCustomerRepository.findByCompanyId).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
      });
      expect(stripeCustomerService.updateCustomer).toHaveBeenCalledWith({
        stripeCustomerId: MOCK_BILLING_CUSTOMER.stripeCustomerId,
        defaultPaymentMethodId: "pm_new_123",
      });
      expect(billingCustomerRepository.update).toHaveBeenCalledWith({
        id: MOCK_BILLING_CUSTOMER.id,
        defaultPaymentMethodId: "pm_new_123",
      });
    });

    it("should throw NOT_FOUND when customer does not exist", async () => {
      billingCustomerRepository.findByCompanyId.mockResolvedValue(null);

      await expect(
        service.setDefaultPaymentMethod({
          companyId: TEST_IDS.companyId,
          paymentMethodId: "pm_test_123",
        }),
      ).rejects.toThrow(new HttpException("Billing customer not found for this company", HttpStatus.NOT_FOUND));

      expect(stripeCustomerService.updateCustomer).not.toHaveBeenCalled();
      expect(billingCustomerRepository.update).not.toHaveBeenCalled();
    });

    it("should update Stripe before database", async () => {
      const callOrder: string[] = [];
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripeCustomerService.updateCustomer.mockImplementation(async () => {
        callOrder.push("stripe");
        return MOCK_CUSTOMER;
      });
      billingCustomerRepository.update.mockImplementation(async () => {
        callOrder.push("database");
        return MOCK_BILLING_CUSTOMER;
      });

      await service.setDefaultPaymentMethod({
        companyId: TEST_IDS.companyId,
        paymentMethodId: "pm_test_123",
      });

      expect(callOrder).toEqual(["stripe", "database"]);
    });

    it("should not update database if Stripe update fails", async () => {
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      const stripeError = new Error("Stripe update failed");
      stripeCustomerService.updateCustomer.mockRejectedValue(stripeError);

      await expect(
        service.setDefaultPaymentMethod({
          companyId: TEST_IDS.companyId,
          paymentMethodId: "pm_test_123",
        }),
      ).rejects.toThrow("Stripe update failed");

      expect(billingCustomerRepository.update).not.toHaveBeenCalled();
    });

    it("should preserve exact payment method ID", async () => {
      const exactPaymentMethodId = "pm_exact_test_456789";
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripeCustomerService.updateCustomer.mockResolvedValue(MOCK_CUSTOMER);
      billingCustomerRepository.update.mockResolvedValue(MOCK_BILLING_CUSTOMER);

      await service.setDefaultPaymentMethod({
        companyId: TEST_IDS.companyId,
        paymentMethodId: exactPaymentMethodId,
      });

      expect(stripeCustomerService.updateCustomer).toHaveBeenCalledWith({
        stripeCustomerId: MOCK_BILLING_CUSTOMER.stripeCustomerId,
        defaultPaymentMethodId: exactPaymentMethodId,
      });
      expect(billingCustomerRepository.update).toHaveBeenCalledWith({
        id: MOCK_BILLING_CUSTOMER.id,
        defaultPaymentMethodId: exactPaymentMethodId,
      });
    });
  });

  describe("removePaymentMethod", () => {
    it("should remove payment method successfully", async () => {
      const mockPaymentMethod: Stripe.PaymentMethod = {
        ...MOCK_PAYMENT_METHOD,
        customer: MOCK_BILLING_CUSTOMER.stripeCustomerId,
      };
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripePaymentService.retrievePaymentMethod.mockResolvedValue(mockPaymentMethod);
      stripeCustomerService.detachPaymentMethod.mockResolvedValue(MOCK_PAYMENT_METHOD);

      await service.removePaymentMethod({
        companyId: TEST_IDS.companyId,
        paymentMethodId: TEST_IDS.paymentMethodId,
      });

      expect(billingCustomerRepository.findByCompanyId).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
      });
      expect(stripePaymentService.retrievePaymentMethod).toHaveBeenCalledWith(TEST_IDS.paymentMethodId);
      expect(stripeCustomerService.detachPaymentMethod).toHaveBeenCalledWith(TEST_IDS.paymentMethodId);
    });

    it("should throw FORBIDDEN when payment method does not belong to customer", async () => {
      const mockPaymentMethod: Stripe.PaymentMethod = {
        ...MOCK_PAYMENT_METHOD,
        customer: "cus_different_customer",
      };
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripePaymentService.retrievePaymentMethod.mockResolvedValue(mockPaymentMethod);

      await expect(
        service.removePaymentMethod({
          companyId: TEST_IDS.companyId,
          paymentMethodId: TEST_IDS.paymentMethodId,
        }),
      ).rejects.toThrow(new HttpException("Payment method does not belong to this customer", HttpStatus.FORBIDDEN));

      expect(stripeCustomerService.detachPaymentMethod).not.toHaveBeenCalled();
    });

    it("should throw FORBIDDEN with correct status code", async () => {
      const mockPaymentMethod: Stripe.PaymentMethod = {
        ...MOCK_PAYMENT_METHOD,
        customer: "cus_different_customer",
      };
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripePaymentService.retrievePaymentMethod.mockResolvedValue(mockPaymentMethod);

      try {
        await service.removePaymentMethod({
          companyId: TEST_IDS.companyId,
          paymentMethodId: TEST_IDS.paymentMethodId,
        });
        fail("Should have thrown HttpException");
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(HttpStatus.FORBIDDEN);
      }
    });

    it("should throw NOT_FOUND when customer does not exist", async () => {
      billingCustomerRepository.findByCompanyId.mockResolvedValue(null);

      await expect(
        service.removePaymentMethod({
          companyId: TEST_IDS.companyId,
          paymentMethodId: TEST_IDS.paymentMethodId,
        }),
      ).rejects.toThrow(new HttpException("Billing customer not found for this company", HttpStatus.NOT_FOUND));

      expect(stripePaymentService.retrievePaymentMethod).not.toHaveBeenCalled();
    });

    it("should clear defaultPaymentMethodId when removing default payment method", async () => {
      const customerWithDefaultPM = {
        ...MOCK_BILLING_CUSTOMER,
        defaultPaymentMethodId: TEST_IDS.paymentMethodId,
      };
      const mockPaymentMethod: Stripe.PaymentMethod = {
        ...MOCK_PAYMENT_METHOD,
        customer: MOCK_BILLING_CUSTOMER.stripeCustomerId,
      };
      billingCustomerRepository.findByCompanyId.mockResolvedValue(customerWithDefaultPM);
      stripePaymentService.retrievePaymentMethod.mockResolvedValue(mockPaymentMethod);
      stripeCustomerService.detachPaymentMethod.mockResolvedValue(MOCK_PAYMENT_METHOD);
      billingCustomerRepository.update.mockResolvedValue(customerWithDefaultPM);

      await service.removePaymentMethod({
        companyId: TEST_IDS.companyId,
        paymentMethodId: TEST_IDS.paymentMethodId,
      });

      expect(stripeCustomerService.detachPaymentMethod).toHaveBeenCalledWith(TEST_IDS.paymentMethodId);
      expect(billingCustomerRepository.update).toHaveBeenCalledWith({
        id: customerWithDefaultPM.id,
        defaultPaymentMethodId: null,
      });
    });

    it("should not update database when removing non-default payment method", async () => {
      const customerWithDifferentDefaultPM = {
        ...MOCK_BILLING_CUSTOMER,
        defaultPaymentMethodId: "pm_different_123",
      };
      const mockPaymentMethod: Stripe.PaymentMethod = {
        ...MOCK_PAYMENT_METHOD,
        customer: MOCK_BILLING_CUSTOMER.stripeCustomerId,
      };
      billingCustomerRepository.findByCompanyId.mockResolvedValue(customerWithDifferentDefaultPM);
      stripePaymentService.retrievePaymentMethod.mockResolvedValue(mockPaymentMethod);
      stripeCustomerService.detachPaymentMethod.mockResolvedValue(MOCK_PAYMENT_METHOD);

      await service.removePaymentMethod({
        companyId: TEST_IDS.companyId,
        paymentMethodId: TEST_IDS.paymentMethodId,
      });

      expect(stripeCustomerService.detachPaymentMethod).toHaveBeenCalledWith(TEST_IDS.paymentMethodId);
      expect(billingCustomerRepository.update).not.toHaveBeenCalled();
    });

    it("should validate ownership before detaching", async () => {
      const mockPaymentMethod: Stripe.PaymentMethod = {
        ...MOCK_PAYMENT_METHOD,
        customer: MOCK_BILLING_CUSTOMER.stripeCustomerId,
      };
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripePaymentService.retrievePaymentMethod.mockResolvedValue(mockPaymentMethod);
      stripeCustomerService.detachPaymentMethod.mockResolvedValue(MOCK_PAYMENT_METHOD);

      await service.removePaymentMethod({
        companyId: TEST_IDS.companyId,
        paymentMethodId: TEST_IDS.paymentMethodId,
      });

      // Verify ownership validation by checking retrievePaymentMethod was called
      expect(stripePaymentService.retrievePaymentMethod).toHaveBeenCalledWith(TEST_IDS.paymentMethodId);
      expect(stripeCustomerService.detachPaymentMethod).toHaveBeenCalledWith(TEST_IDS.paymentMethodId);
    });

    it("should handle payment method with null customer", async () => {
      const mockPaymentMethod: Stripe.PaymentMethod = {
        ...MOCK_PAYMENT_METHOD,
        customer: null,
      };
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
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
      stripeCustomerService.retrieveCustomer.mockResolvedValue(mockStripeCustomer);
      billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      billingCustomerRepository.updateByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);

      await service.syncCustomerFromStripe({ stripeCustomerId: TEST_IDS.customerId });

      expect(stripeCustomerService.retrieveCustomer).toHaveBeenCalledWith(TEST_IDS.customerId);
      expect(billingCustomerRepository.findByStripeCustomerId).toHaveBeenCalledWith({
        stripeCustomerId: TEST_IDS.customerId,
      });
      expect(billingCustomerRepository.updateByStripeCustomerId).toHaveBeenCalledWith({
        stripeCustomerId: TEST_IDS.customerId,
        email: "updated@example.com",
        name: "Updated Name",
        defaultPaymentMethodId: "pm_updated_123",
        balance: 100,
        delinquent: true,
      });
    });

    it("should not update when customer does not exist in database", async () => {
      stripeCustomerService.retrieveCustomer.mockResolvedValue(MOCK_CUSTOMER);
      billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(null);

      await service.syncCustomerFromStripe({ stripeCustomerId: TEST_IDS.customerId });

      expect(stripeCustomerService.retrieveCustomer).toHaveBeenCalledWith(TEST_IDS.customerId);
      expect(billingCustomerRepository.findByStripeCustomerId).toHaveBeenCalledWith({
        stripeCustomerId: TEST_IDS.customerId,
      });
      expect(billingCustomerRepository.updateByStripeCustomerId).not.toHaveBeenCalled();
    });

    it("should silently ignore 'Customer has been deleted' error", async () => {
      const deletedError = new Error("Customer has been deleted");
      stripeCustomerService.retrieveCustomer.mockRejectedValue(deletedError);

      await expect(service.syncCustomerFromStripe({ stripeCustomerId: TEST_IDS.customerId })).resolves.not.toThrow();

      expect(stripeCustomerService.retrieveCustomer).toHaveBeenCalledWith(TEST_IDS.customerId);
      expect(billingCustomerRepository.updateByStripeCustomerId).not.toHaveBeenCalled();
    });

    it("should rethrow other errors", async () => {
      const otherError = new Error("Some other Stripe error");
      stripeCustomerService.retrieveCustomer.mockRejectedValue(otherError);

      await expect(service.syncCustomerFromStripe({ stripeCustomerId: TEST_IDS.customerId })).rejects.toThrow(
        "Some other Stripe error",
      );

      expect(billingCustomerRepository.updateByStripeCustomerId).not.toHaveBeenCalled();
    });

    it("should use existing email when Stripe customer has null email", async () => {
      const mockStripeCustomer: Stripe.Customer = {
        ...MOCK_CUSTOMER,
        email: null,
        name: "Updated Name",
      };
      stripeCustomerService.retrieveCustomer.mockResolvedValue(mockStripeCustomer);
      billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      billingCustomerRepository.updateByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);

      await service.syncCustomerFromStripe({ stripeCustomerId: TEST_IDS.customerId });

      expect(billingCustomerRepository.updateByStripeCustomerId).toHaveBeenCalledWith({
        stripeCustomerId: TEST_IDS.customerId,
        email: MOCK_BILLING_CUSTOMER.email,
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
      stripeCustomerService.retrieveCustomer.mockResolvedValue(mockStripeCustomer);
      billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      billingCustomerRepository.updateByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);

      await service.syncCustomerFromStripe({ stripeCustomerId: TEST_IDS.customerId });

      expect(billingCustomerRepository.updateByStripeCustomerId).toHaveBeenCalledWith({
        stripeCustomerId: TEST_IDS.customerId,
        email: "updated@example.com",
        name: MOCK_BILLING_CUSTOMER.name,
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
      stripeCustomerService.retrieveCustomer.mockResolvedValue(mockStripeCustomer);
      billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      billingCustomerRepository.updateByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);

      await service.syncCustomerFromStripe({ stripeCustomerId: TEST_IDS.customerId });

      expect(billingCustomerRepository.updateByStripeCustomerId).toHaveBeenCalledWith({
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
      stripeCustomerService.retrieveCustomer.mockResolvedValue(mockStripeCustomer);
      billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      billingCustomerRepository.updateByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);

      await service.syncCustomerFromStripe({ stripeCustomerId: TEST_IDS.customerId });

      expect(billingCustomerRepository.updateByStripeCustomerId).toHaveBeenCalledWith({
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
      stripeCustomerService.retrieveCustomer.mockResolvedValue(mockStripeCustomer);
      billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      billingCustomerRepository.updateByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);

      await service.syncCustomerFromStripe({ stripeCustomerId: TEST_IDS.customerId });

      expect(billingCustomerRepository.updateByStripeCustomerId).toHaveBeenCalledWith(
        expect.objectContaining({
          delinquent: false,
        }),
      );
    });
  });

  describe("Edge Cases", () => {
    it("should handle concurrent requests for same company", async () => {
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE);

      const promises = [
        service.getCustomer({ companyId: TEST_IDS.companyId }),
        service.getCustomer({ companyId: TEST_IDS.companyId }),
        service.getCustomer({ companyId: TEST_IDS.companyId }),
      ];

      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);
      expect(billingCustomerRepository.findByCompanyId).toHaveBeenCalledTimes(3);
    });

    it("should handle empty string company ID gracefully", async () => {
      billingCustomerRepository.findByCompanyId.mockResolvedValue(null);

      await expect(service.getCustomerOrFail({ companyId: "" })).rejects.toThrow(
        new HttpException("Billing customer not found for this company", HttpStatus.NOT_FOUND),
      );
    });

    it("should preserve exact Stripe customer ID in all operations", async () => {
      const exactStripeId = "cus_exact_test_123456";
      const customerWithExactId = {
        ...MOCK_BILLING_CUSTOMER,
        stripeCustomerId: exactStripeId,
      };
      billingCustomerRepository.findByCompanyId.mockResolvedValue(customerWithExactId);
      stripePaymentService.createSetupIntent.mockResolvedValue(MOCK_SETUP_INTENT);

      await service.createSetupIntent({ companyId: TEST_IDS.companyId });

      expect(stripePaymentService.createSetupIntent).toHaveBeenCalledWith({
        stripeCustomerId: exactStripeId,
      });
    });
  });

  describe("Service Integration", () => {
    it("should call repository methods with correct parameters", async () => {
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE);

      await service.getCustomer({ companyId: TEST_IDS.companyId });

      expect(billingCustomerRepository.findByCompanyId).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
      });
    });

    it("should orchestrate multiple service calls in correct order", async () => {
      const callOrder: string[] = [];
      billingCustomerRepository.findByCompanyId.mockImplementation(async () => {
        callOrder.push("checkExisting");
        return null;
      });
      stripeCustomerService.createCustomer.mockImplementation(async () => {
        callOrder.push("createStripe");
        return MOCK_CUSTOMER;
      });
      billingCustomerRepository.create.mockImplementation(async () => {
        callOrder.push("createDatabase");
        return MOCK_BILLING_CUSTOMER;
      });
      jsonApiService.buildSingle.mockImplementation(() => {
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
