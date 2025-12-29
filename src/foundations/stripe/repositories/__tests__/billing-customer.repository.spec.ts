// Mock problematic modules before any imports
jest.mock("../../../../foundations/chunker/chunker.module", () => ({
  ChunkerModule: class {},
}));
jest.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({}));

// Mock the barrel export to provide only what we need
jest.mock("@carlonicora/nestjs-neo4jsonapi", () => {
  // Create a mock Neo4jService class
  class Neo4jService {
    writeOne = jest.fn();
    readOne = jest.fn();
    initQuery = jest.fn();
  }

  // Create a mock AbstractJsonApiSerialiser class
  class AbstractJsonApiSerialiser {}

  return {
    Neo4jService,
    AbstractJsonApiSerialiser,
    companyMeta: {
      type: "companies",
      endpoint: "companies",
      nodeName: "company",
      labelName: "Company",
    },
  };
});

import { Test, TestingModule } from "@nestjs/testing";
import { Neo4jService } from "@carlonicora/nestjs-neo4jsonapi";
import { BillingCustomerRepository } from "../billing-customer.repository";
import { billingCustomerMeta } from "../../entities/billing-customer.meta";
import { BillingCustomer } from "../../entities/billing-customer.entity";

// Get companyMeta from the mocked module
const { companyMeta } = jest.requireMock("@carlonicora/nestjs-neo4jsonapi");

describe("BillingCustomerRepository", () => {
  let repository: BillingCustomerRepository;
  let neo4jService: jest.Mocked<Neo4jService>;

  // Test data constants
  const TEST_IDS = {
    customerId: "550e8400-e29b-41d4-a716-446655440000",
    companyId: "660e8400-e29b-41d4-a716-446655440001",
    stripeCustomerId: "cus_test123",
    paymentMethodId: "pm_test456",
  };

  const MOCK_BILLING_CUSTOMER: BillingCustomer = {
    id: TEST_IDS.customerId,
    stripeCustomerId: TEST_IDS.stripeCustomerId,
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

  const createMockQuery = () => ({
    query: "",
    queryParams: {},
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [BillingCustomerRepository, Neo4jService],
    }).compile();

    repository = module.get<BillingCustomerRepository>(BillingCustomerRepository);
    neo4jService = module.get<Neo4jService>(Neo4jService) as jest.Mocked<Neo4jService>;

    // Reset mocks before each test
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("onModuleInit", () => {
    it("should create unique constraint on id field", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.onModuleInit();

      expect(neo4jService.writeOne).toHaveBeenCalledWith({
        query: `CREATE CONSTRAINT ${billingCustomerMeta.nodeName}_id IF NOT EXISTS FOR (${billingCustomerMeta.nodeName}:${billingCustomerMeta.labelName}) REQUIRE ${billingCustomerMeta.nodeName}.id IS UNIQUE`,
      });
    });

    it("should create unique constraint on stripeCustomerId field", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.onModuleInit();

      expect(neo4jService.writeOne).toHaveBeenCalledWith({
        query: `CREATE CONSTRAINT ${billingCustomerMeta.nodeName}_stripeCustomerId IF NOT EXISTS FOR (${billingCustomerMeta.nodeName}:${billingCustomerMeta.labelName}) REQUIRE ${billingCustomerMeta.nodeName}.stripeCustomerId IS UNIQUE`,
      });
    });

    it("should create both constraints in sequence", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.onModuleInit();

      expect(neo4jService.writeOne).toHaveBeenCalledTimes(2);
    });

    it("should handle constraint creation errors", async () => {
      const error = new Error("Constraint creation failed");
      neo4jService.writeOne.mockRejectedValue(error);

      await expect(repository.onModuleInit()).rejects.toThrow("Constraint creation failed");
    });
  });

  describe("findByCompanyId", () => {
    it("should find billing customer by company ID successfully", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_BILLING_CUSTOMER);

      const result = await repository.findByCompanyId({ companyId: TEST_IDS.companyId });

      expect(neo4jService.initQuery).toHaveBeenCalledWith({
        serialiser: expect.anything(),
      });
      expect(mockQuery.queryParams).toEqual({
        companyId: TEST_IDS.companyId,
      });
      expect(mockQuery.query).toContain(`MATCH (${billingCustomerMeta.nodeName}:${billingCustomerMeta.labelName})`);
      expect(mockQuery.query).toContain(`BELONGS_TO`);
      expect(mockQuery.query).toContain(`${companyMeta.nodeName}:${companyMeta.labelName} {id: $companyId}`);
      expect(mockQuery.query).toContain(`RETURN ${billingCustomerMeta.nodeName}`);
      expect(neo4jService.readOne).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual(MOCK_BILLING_CUSTOMER);
    });

    it("should return null when billing customer not found", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(null);

      const result = await repository.findByCompanyId({ companyId: TEST_IDS.companyId });

      expect(result).toBeNull();
      expect(neo4jService.readOne).toHaveBeenCalledWith(mockQuery);
    });

    it("should handle database errors", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      const error = new Error("Database error");
      neo4jService.readOne.mockRejectedValue(error);

      await expect(repository.findByCompanyId({ companyId: TEST_IDS.companyId })).rejects.toThrow("Database error");
    });
  });

  describe("findByStripeCustomerId", () => {
    it("should find billing customer by Stripe customer ID successfully", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_BILLING_CUSTOMER);

      const result = await repository.findByStripeCustomerId({ stripeCustomerId: TEST_IDS.stripeCustomerId });

      expect(neo4jService.initQuery).toHaveBeenCalledWith({
        serialiser: expect.anything(),
      });
      expect(mockQuery.queryParams).toEqual({
        stripeCustomerId: TEST_IDS.stripeCustomerId,
      });
      expect(mockQuery.query).toContain(
        `MATCH (${billingCustomerMeta.nodeName}:${billingCustomerMeta.labelName} {stripeCustomerId: $stripeCustomerId})`,
      );
      expect(mockQuery.query).toContain(`RETURN ${billingCustomerMeta.nodeName}`);
      expect(neo4jService.readOne).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual(MOCK_BILLING_CUSTOMER);
    });

    it("should return null when billing customer not found by Stripe ID", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(null);

      const result = await repository.findByStripeCustomerId({ stripeCustomerId: "cus_nonexistent" });

      expect(result).toBeNull();
      expect(neo4jService.readOne).toHaveBeenCalledWith(mockQuery);
    });

    it("should handle database errors", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      const error = new Error("Database connection error");
      neo4jService.readOne.mockRejectedValue(error);

      await expect(repository.findByStripeCustomerId({ stripeCustomerId: TEST_IDS.stripeCustomerId })).rejects.toThrow(
        "Database connection error",
      );
    });
  });

  describe("findById", () => {
    it("should find billing customer by ID successfully", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_BILLING_CUSTOMER);

      const result = await repository.findById({ id: TEST_IDS.customerId });

      expect(neo4jService.initQuery).toHaveBeenCalledWith({
        serialiser: expect.anything(),
      });
      expect(mockQuery.queryParams).toEqual({
        id: TEST_IDS.customerId,
      });
      expect(mockQuery.query).toContain(
        `MATCH (${billingCustomerMeta.nodeName}:${billingCustomerMeta.labelName} {id: $id})`,
      );
      expect(mockQuery.query).toContain(`RETURN ${billingCustomerMeta.nodeName}`);
      expect(neo4jService.readOne).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual(MOCK_BILLING_CUSTOMER);
    });

    it("should return null when billing customer not found by ID", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(null);

      const result = await repository.findById({ id: "nonexistent-id" });

      expect(result).toBeNull();
      expect(neo4jService.readOne).toHaveBeenCalledWith(mockQuery);
    });

    it("should handle database errors", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      const error = new Error("Read operation failed");
      neo4jService.readOne.mockRejectedValue(error);

      await expect(repository.findById({ id: TEST_IDS.customerId })).rejects.toThrow("Read operation failed");
    });
  });

  describe("create", () => {
    const validCreateParams = {
      companyId: TEST_IDS.companyId,
      stripeCustomerId: TEST_IDS.stripeCustomerId,
      email: "newcustomer@example.com",
      name: "New Customer",
      currency: "usd",
    };

    it("should create billing customer with required fields only", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_BILLING_CUSTOMER);

      const result = await repository.create(validCreateParams);

      expect(neo4jService.initQuery).toHaveBeenCalledWith({
        serialiser: expect.anything(),
      });
      expect(mockQuery.queryParams).toMatchObject({
        companyId: validCreateParams.companyId,
        stripeCustomerId: validCreateParams.stripeCustomerId,
        email: validCreateParams.email,
        name: validCreateParams.name,
        currency: validCreateParams.currency,
        defaultPaymentMethodId: null,
      });
      expect(mockQuery.queryParams.id).toBeDefined();
      expect(mockQuery.query).toContain(`MATCH (${companyMeta.nodeName}:${companyMeta.labelName} {id: $companyId})`);
      expect(mockQuery.query).toContain(`CREATE (${billingCustomerMeta.nodeName}:${billingCustomerMeta.labelName}`);
      expect(mockQuery.query).toContain("balance: 0");
      expect(mockQuery.query).toContain("delinquent: false");
      expect(mockQuery.query).toContain("createdAt: datetime()");
      expect(mockQuery.query).toContain("updatedAt: datetime()");
      expect(mockQuery.query).toContain(
        `CREATE (${billingCustomerMeta.nodeName})-[:BELONGS_TO]->(${companyMeta.nodeName})`,
      );
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual(MOCK_BILLING_CUSTOMER);
    });

    it("should create billing customer with optional defaultPaymentMethodId", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_BILLING_CUSTOMER);

      const paramsWithPaymentMethod = {
        ...validCreateParams,
        defaultPaymentMethodId: TEST_IDS.paymentMethodId,
      };

      await repository.create(paramsWithPaymentMethod);

      expect(mockQuery.queryParams).toMatchObject({
        defaultPaymentMethodId: TEST_IDS.paymentMethodId,
      });
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
    });

    it("should set defaultPaymentMethodId to null when not provided", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_BILLING_CUSTOMER);

      await repository.create(validCreateParams);

      expect(mockQuery.queryParams.defaultPaymentMethodId).toBeNull();
    });

    it("should generate unique UUID for each customer", async () => {
      const mockQuery1 = createMockQuery();
      const mockQuery2 = createMockQuery();
      neo4jService.initQuery.mockReturnValueOnce(mockQuery1).mockReturnValueOnce(mockQuery2);
      neo4jService.writeOne.mockResolvedValue(MOCK_BILLING_CUSTOMER);

      await repository.create(validCreateParams);
      await repository.create(validCreateParams);

      expect(mockQuery1.queryParams.id).toBeDefined();
      expect(mockQuery2.queryParams.id).toBeDefined();
      expect(mockQuery1.queryParams.id).not.toEqual(mockQuery2.queryParams.id);
    });

    it("should handle creation errors", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      const error = new Error("Creation failed - company not found");
      neo4jService.writeOne.mockRejectedValue(error);

      await expect(repository.create(validCreateParams)).rejects.toThrow("Creation failed - company not found");
    });

    it("should preserve exact parameter values", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_BILLING_CUSTOMER);

      const exactParams = {
        companyId: "exact_company_123",
        stripeCustomerId: "cus_exact_456",
        email: "exact@test.com",
        name: "Exact Name Test",
        currency: "eur",
        defaultPaymentMethodId: "pm_exact_789",
      };

      await repository.create(exactParams);

      expect(mockQuery.queryParams).toMatchObject(exactParams);
    });
  });

  describe("update", () => {
    it("should update email field", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_BILLING_CUSTOMER);

      const params = {
        id: TEST_IDS.customerId,
        email: "newemail@example.com",
      };

      const result = await repository.update(params);

      expect(mockQuery.queryParams).toEqual({
        id: TEST_IDS.customerId,
        email: "newemail@example.com",
        name: undefined,
        defaultPaymentMethodId: undefined,
        balance: undefined,
        delinquent: undefined,
      });
      expect(mockQuery.query).toContain(
        `MATCH (${billingCustomerMeta.nodeName}:${billingCustomerMeta.labelName} {id: $id})`,
      );
      expect(mockQuery.query).toContain(`${billingCustomerMeta.nodeName}.updatedAt = datetime()`);
      expect(mockQuery.query).toContain(`${billingCustomerMeta.nodeName}.email = $email`);
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual(MOCK_BILLING_CUSTOMER);
    });

    it("should update name field", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_BILLING_CUSTOMER);

      const params = {
        id: TEST_IDS.customerId,
        name: "Updated Name",
      };

      await repository.update(params);

      expect(mockQuery.query).toContain(`${billingCustomerMeta.nodeName}.name = $name`);
      expect(mockQuery.queryParams.name).toBe("Updated Name");
    });

    it("should update defaultPaymentMethodId field", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_BILLING_CUSTOMER);

      const params = {
        id: TEST_IDS.customerId,
        defaultPaymentMethodId: "pm_new_method",
      };

      await repository.update(params);

      expect(mockQuery.query).toContain(
        `${billingCustomerMeta.nodeName}.defaultPaymentMethodId = $defaultPaymentMethodId`,
      );
      expect(mockQuery.queryParams.defaultPaymentMethodId).toBe("pm_new_method");
    });

    it("should update balance field", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_BILLING_CUSTOMER);

      const params = {
        id: TEST_IDS.customerId,
        balance: 1000,
      };

      await repository.update(params);

      expect(mockQuery.query).toContain(`${billingCustomerMeta.nodeName}.balance = $balance`);
      expect(mockQuery.queryParams.balance).toBe(1000);
    });

    it("should update delinquent field", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_BILLING_CUSTOMER);

      const params = {
        id: TEST_IDS.customerId,
        delinquent: true,
      };

      await repository.update(params);

      expect(mockQuery.query).toContain(`${billingCustomerMeta.nodeName}.delinquent = $delinquent`);
      expect(mockQuery.queryParams.delinquent).toBe(true);
    });

    it("should update multiple fields at once", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_BILLING_CUSTOMER);

      const params = {
        id: TEST_IDS.customerId,
        email: "multi@update.com",
        name: "Multi Update",
        defaultPaymentMethodId: "pm_multi",
        balance: 500,
        delinquent: true,
      };

      await repository.update(params);

      expect(mockQuery.query).toContain(`${billingCustomerMeta.nodeName}.email = $email`);
      expect(mockQuery.query).toContain(`${billingCustomerMeta.nodeName}.name = $name`);
      expect(mockQuery.query).toContain(
        `${billingCustomerMeta.nodeName}.defaultPaymentMethodId = $defaultPaymentMethodId`,
      );
      expect(mockQuery.query).toContain(`${billingCustomerMeta.nodeName}.balance = $balance`);
      expect(mockQuery.query).toContain(`${billingCustomerMeta.nodeName}.delinquent = $delinquent`);
      expect(mockQuery.queryParams).toMatchObject({
        email: "multi@update.com",
        name: "Multi Update",
        defaultPaymentMethodId: "pm_multi",
        balance: 500,
        delinquent: true,
      });
    });

    it("should only update id when no optional fields provided", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_BILLING_CUSTOMER);

      const params = {
        id: TEST_IDS.customerId,
      };

      await repository.update(params);

      expect(mockQuery.query).toContain(`${billingCustomerMeta.nodeName}.updatedAt = datetime()`);
      expect(mockQuery.query).not.toContain(`${billingCustomerMeta.nodeName}.email = $email`);
      expect(mockQuery.query).not.toContain(`${billingCustomerMeta.nodeName}.name = $name`);
    });

    it("should always update updatedAt timestamp", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_BILLING_CUSTOMER);

      await repository.update({ id: TEST_IDS.customerId, email: "test@test.com" });

      expect(mockQuery.query).toContain(`${billingCustomerMeta.nodeName}.updatedAt = datetime()`);
    });

    it("should handle update errors", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      const error = new Error("Update failed - customer not found");
      neo4jService.writeOne.mockRejectedValue(error);

      await expect(repository.update({ id: TEST_IDS.customerId, email: "test@test.com" })).rejects.toThrow(
        "Update failed - customer not found",
      );
    });

    it("should handle balance as zero", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_BILLING_CUSTOMER);

      await repository.update({ id: TEST_IDS.customerId, balance: 0 });

      expect(mockQuery.query).toContain(`${billingCustomerMeta.nodeName}.balance = $balance`);
      expect(mockQuery.queryParams.balance).toBe(0);
    });

    it("should handle delinquent as false", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_BILLING_CUSTOMER);

      await repository.update({ id: TEST_IDS.customerId, delinquent: false });

      expect(mockQuery.query).toContain(`${billingCustomerMeta.nodeName}.delinquent = $delinquent`);
      expect(mockQuery.queryParams.delinquent).toBe(false);
    });
  });

  describe("updateByStripeCustomerId", () => {
    it("should update email field by Stripe customer ID", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_BILLING_CUSTOMER);

      const params = {
        stripeCustomerId: TEST_IDS.stripeCustomerId,
        email: "newemail@example.com",
      };

      const result = await repository.updateByStripeCustomerId(params);

      expect(mockQuery.queryParams).toEqual({
        stripeCustomerId: TEST_IDS.stripeCustomerId,
        email: "newemail@example.com",
        name: undefined,
        defaultPaymentMethodId: undefined,
        balance: undefined,
        delinquent: undefined,
      });
      expect(mockQuery.query).toContain(
        `MATCH (${billingCustomerMeta.nodeName}:${billingCustomerMeta.labelName} {stripeCustomerId: $stripeCustomerId})`,
      );
      expect(mockQuery.query).toContain(`${billingCustomerMeta.nodeName}.updatedAt = datetime()`);
      expect(mockQuery.query).toContain(`${billingCustomerMeta.nodeName}.email = $email`);
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual(MOCK_BILLING_CUSTOMER);
    });

    it("should update name field by Stripe customer ID", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_BILLING_CUSTOMER);

      await repository.updateByStripeCustomerId({
        stripeCustomerId: TEST_IDS.stripeCustomerId,
        name: "Updated Name",
      });

      expect(mockQuery.query).toContain(`${billingCustomerMeta.nodeName}.name = $name`);
      expect(mockQuery.queryParams.name).toBe("Updated Name");
    });

    it("should update defaultPaymentMethodId by Stripe customer ID", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_BILLING_CUSTOMER);

      await repository.updateByStripeCustomerId({
        stripeCustomerId: TEST_IDS.stripeCustomerId,
        defaultPaymentMethodId: "pm_new",
      });

      expect(mockQuery.query).toContain(
        `${billingCustomerMeta.nodeName}.defaultPaymentMethodId = $defaultPaymentMethodId`,
      );
      expect(mockQuery.queryParams.defaultPaymentMethodId).toBe("pm_new");
    });

    it("should update balance by Stripe customer ID", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_BILLING_CUSTOMER);

      await repository.updateByStripeCustomerId({
        stripeCustomerId: TEST_IDS.stripeCustomerId,
        balance: 2000,
      });

      expect(mockQuery.query).toContain(`${billingCustomerMeta.nodeName}.balance = $balance`);
      expect(mockQuery.queryParams.balance).toBe(2000);
    });

    it("should update delinquent by Stripe customer ID", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_BILLING_CUSTOMER);

      await repository.updateByStripeCustomerId({
        stripeCustomerId: TEST_IDS.stripeCustomerId,
        delinquent: true,
      });

      expect(mockQuery.query).toContain(`${billingCustomerMeta.nodeName}.delinquent = $delinquent`);
      expect(mockQuery.queryParams.delinquent).toBe(true);
    });

    it("should update multiple fields at once by Stripe customer ID", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_BILLING_CUSTOMER);

      const params = {
        stripeCustomerId: TEST_IDS.stripeCustomerId,
        email: "multi@update.com",
        name: "Multi Update",
        defaultPaymentMethodId: "pm_multi",
        balance: 1500,
        delinquent: false,
      };

      await repository.updateByStripeCustomerId(params);

      expect(mockQuery.query).toContain(`${billingCustomerMeta.nodeName}.email = $email`);
      expect(mockQuery.query).toContain(`${billingCustomerMeta.nodeName}.name = $name`);
      expect(mockQuery.query).toContain(
        `${billingCustomerMeta.nodeName}.defaultPaymentMethodId = $defaultPaymentMethodId`,
      );
      expect(mockQuery.query).toContain(`${billingCustomerMeta.nodeName}.balance = $balance`);
      expect(mockQuery.query).toContain(`${billingCustomerMeta.nodeName}.delinquent = $delinquent`);
      expect(mockQuery.queryParams).toMatchObject({
        email: "multi@update.com",
        name: "Multi Update",
        defaultPaymentMethodId: "pm_multi",
        balance: 1500,
        delinquent: false,
      });
    });

    it("should only update stripeCustomerId when no optional fields provided", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_BILLING_CUSTOMER);

      await repository.updateByStripeCustomerId({
        stripeCustomerId: TEST_IDS.stripeCustomerId,
      });

      expect(mockQuery.query).toContain(`${billingCustomerMeta.nodeName}.updatedAt = datetime()`);
      expect(mockQuery.query).not.toContain(`${billingCustomerMeta.nodeName}.email = $email`);
      expect(mockQuery.query).not.toContain(`${billingCustomerMeta.nodeName}.name = $name`);
    });

    it("should always update updatedAt timestamp", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_BILLING_CUSTOMER);

      await repository.updateByStripeCustomerId({
        stripeCustomerId: TEST_IDS.stripeCustomerId,
        email: "test@test.com",
      });

      expect(mockQuery.query).toContain(`${billingCustomerMeta.nodeName}.updatedAt = datetime()`);
    });

    it("should handle update errors", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      const error = new Error("Update failed - customer not found");
      neo4jService.writeOne.mockRejectedValue(error);

      await expect(
        repository.updateByStripeCustomerId({
          stripeCustomerId: TEST_IDS.stripeCustomerId,
          email: "test@test.com",
        }),
      ).rejects.toThrow("Update failed - customer not found");
    });
  });

  describe("delete", () => {
    it("should delete billing customer by ID", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.delete({ id: TEST_IDS.customerId });

      expect(neo4jService.initQuery).toHaveBeenCalledWith();
      expect(mockQuery.queryParams).toEqual({
        id: TEST_IDS.customerId,
      });
      expect(mockQuery.query).toContain(
        `MATCH (${billingCustomerMeta.nodeName}:${billingCustomerMeta.labelName} {id: $id})`,
      );
      expect(mockQuery.query).toContain(`DETACH DELETE ${billingCustomerMeta.nodeName}`);
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
    });

    it("should not return a value after deletion", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      const result = await repository.delete({ id: TEST_IDS.customerId });

      expect(result).toBeUndefined();
    });

    it("should handle deletion errors", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      const error = new Error("Deletion failed");
      neo4jService.writeOne.mockRejectedValue(error);

      await expect(repository.delete({ id: TEST_IDS.customerId })).rejects.toThrow("Deletion failed");
    });

    it("should delete customer with all relationships using DETACH DELETE", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.delete({ id: TEST_IDS.customerId });

      expect(mockQuery.query).toContain("DETACH DELETE");
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty string values in create", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_BILLING_CUSTOMER);

      const params = {
        companyId: TEST_IDS.companyId,
        stripeCustomerId: TEST_IDS.stripeCustomerId,
        email: "",
        name: "",
        currency: "usd",
      };

      await repository.create(params);

      expect(mockQuery.queryParams.email).toBe("");
      expect(mockQuery.queryParams.name).toBe("");
    });

    it("should handle special characters in customer name", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_BILLING_CUSTOMER);

      await repository.update({
        id: TEST_IDS.customerId,
        name: "O'Brien & Co. (Test)",
      });

      expect(mockQuery.queryParams.name).toBe("O'Brien & Co. (Test)");
    });

    it("should handle negative balance values", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_BILLING_CUSTOMER);

      await repository.update({
        id: TEST_IDS.customerId,
        balance: -500,
      });

      expect(mockQuery.queryParams.balance).toBe(-500);
    });

    it("should handle very long email addresses", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_BILLING_CUSTOMER);

      const longEmail = "a".repeat(100) + "@example.com";

      await repository.update({
        id: TEST_IDS.customerId,
        email: longEmail,
      });

      expect(mockQuery.queryParams.email).toBe(longEmail);
    });

    it("should handle null return from findByCompanyId gracefully", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(null);

      const result = await repository.findByCompanyId({ companyId: "nonexistent" });

      expect(result).toBeNull();
    });
  });

  describe("Parameter Validation", () => {
    it("should preserve exact UUID values", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_BILLING_CUSTOMER);

      const exactId = "123e4567-e89b-12d3-a456-426614174000";

      await repository.findById({ id: exactId });

      expect(mockQuery.queryParams.id).toBe(exactId);
    });

    it("should preserve exact Stripe customer ID format", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_BILLING_CUSTOMER);

      const exactStripeId = "cus_MvN8z3FkJ0LJ6p";

      await repository.findByStripeCustomerId({ stripeCustomerId: exactStripeId });

      expect(mockQuery.queryParams.stripeCustomerId).toBe(exactStripeId);
    });

    it("should preserve currency code case sensitivity", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_BILLING_CUSTOMER);

      await repository.create({
        companyId: TEST_IDS.companyId,
        stripeCustomerId: TEST_IDS.stripeCustomerId,
        email: "test@test.com",
        name: "Test",
        currency: "EUR",
      });

      expect(mockQuery.queryParams.currency).toBe("EUR");
    });
  });

  describe("Service Integration", () => {
    it("should call Neo4jService.initQuery before each read operation", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_BILLING_CUSTOMER);

      await repository.findById({ id: TEST_IDS.customerId });
      await repository.findByCompanyId({ companyId: TEST_IDS.companyId });
      await repository.findByStripeCustomerId({ stripeCustomerId: TEST_IDS.stripeCustomerId });

      expect(neo4jService.initQuery).toHaveBeenCalledTimes(3);
    });

    it("should call Neo4jService.writeOne for create, update, and delete operations", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_BILLING_CUSTOMER);

      await repository.create({
        companyId: TEST_IDS.companyId,
        stripeCustomerId: TEST_IDS.stripeCustomerId,
        email: "test@test.com",
        name: "Test",
        currency: "usd",
      });

      await repository.update({ id: TEST_IDS.customerId, email: "new@test.com" });

      neo4jService.writeOne.mockResolvedValue(undefined);
      await repository.delete({ id: TEST_IDS.customerId });

      expect(neo4jService.writeOne).toHaveBeenCalledTimes(3);
    });
  });
});
