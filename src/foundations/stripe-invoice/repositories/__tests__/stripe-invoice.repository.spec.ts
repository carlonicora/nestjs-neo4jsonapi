import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
// Mock problematic modules before any imports
vi.mock("../../../../foundations/chunker/chunker.module", () => ({
  ChunkerModule: class {},
}));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({}));

import { Test, TestingModule } from "@nestjs/testing";
import { Neo4jService } from "../../../../core/neo4j";
import { StripeInvoiceRepository } from "../stripe-invoice.repository";
import { stripeInvoiceMeta } from "../../entities/stripe-invoice.meta";
import { stripeCustomerMeta } from "../../../stripe-customer/entities/stripe-customer.meta";
import { stripeSubscriptionMeta } from "../../../stripe-subscription/entities/stripe-subscription.meta";
import { StripeInvoice, StripeInvoiceStatus } from "../../entities/stripe-invoice.entity";

describe("StripeInvoiceRepository", () => {
  let repository: StripeInvoiceRepository;
  let neo4jService: vi.Mocked<Neo4jService>;

  // Test data constants
  const TEST_IDS = {
    invoiceId: "550e8400-e29b-41d4-a716-446655440000",
    stripeCustomerId: "660e8400-e29b-41d4-a716-446655440001",
    subscriptionId: "770e8400-e29b-41d4-a716-446655440002",
    stripeInvoiceId: "in_test123",
  };

  const MOCK_DATES = {
    periodStart: new Date("2025-01-01T00:00:00Z"),
    periodEnd: new Date("2025-02-01T00:00:00Z"),
    dueDate: new Date("2025-02-05T00:00:00Z"),
    paidAt: new Date("2025-01-15T12:30:00Z"),
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
  };

  const MOCK_INVOICE: StripeInvoice = {
    id: TEST_IDS.invoiceId,
    stripeInvoiceId: TEST_IDS.stripeInvoiceId,
    stripeInvoiceNumber: "ABC-1234",
    stripeHostedInvoiceUrl: "https://stripe.com/invoice/test123",
    stripePdfUrl: "https://stripe.com/invoice/test123.pdf",
    status: "paid",
    currency: "usd",
    amountDue: 5000,
    amountPaid: 5000,
    amountRemaining: 0,
    subtotal: 5000,
    total: 5000,
    tax: 0,
    periodStart: MOCK_DATES.periodStart,
    periodEnd: MOCK_DATES.periodEnd,
    dueDate: MOCK_DATES.dueDate,
    paidAt: MOCK_DATES.paidAt,
    attemptCount: 1,
    attempted: true,
    createdAt: MOCK_DATES.createdAt,
    updatedAt: MOCK_DATES.updatedAt,
    billingCustomer: {} as any,
  };

  const createMockQuery = () => ({
    query: "",
    queryParams: {},
  });

  beforeEach(async () => {
    const mockNeo4jService = {
      writeOne: vi.fn(),
      readOne: vi.fn(),
      readMany: vi.fn(),
      initQuery: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeInvoiceRepository,
        {
          provide: Neo4jService,
          useValue: mockNeo4jService,
        },
      ],
    }).compile();

    repository = module.get<StripeInvoiceRepository>(StripeInvoiceRepository);
    neo4jService = module.get<Neo4jService>(Neo4jService) as vi.Mocked<Neo4jService>;

    // Reset mocks before each test
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("onModuleInit", () => {
    it("should create unique constraint on id field", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.onModuleInit();

      expect(neo4jService.writeOne).toHaveBeenCalledWith({
        query: `CREATE CONSTRAINT ${stripeInvoiceMeta.nodeName}_id IF NOT EXISTS FOR (${stripeInvoiceMeta.nodeName}:${stripeInvoiceMeta.labelName}) REQUIRE ${stripeInvoiceMeta.nodeName}.id IS UNIQUE`,
      });
    });

    it("should create unique constraint on stripeInvoiceId field", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.onModuleInit();

      expect(neo4jService.writeOne).toHaveBeenCalledWith({
        query: `CREATE CONSTRAINT ${stripeInvoiceMeta.nodeName}_stripeInvoiceId IF NOT EXISTS FOR (${stripeInvoiceMeta.nodeName}:${stripeInvoiceMeta.labelName}) REQUIRE ${stripeInvoiceMeta.nodeName}.stripeInvoiceId IS UNIQUE`,
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

  describe("findByStripeCustomerId", () => {
    it("should find invoices by billing customer ID without status filter", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_INVOICE]);

      const result = await repository.findByStripeCustomerId({
        stripeCustomerId: TEST_IDS.stripeCustomerId,
      });

      expect(neo4jService.initQuery).toHaveBeenCalledWith({
        serialiser: expect.anything(),
        cursor: undefined,
      });
      expect(mockQuery.queryParams.stripeCustomerId).toBe(TEST_IDS.stripeCustomerId);
      expect(mockQuery.query).toContain(
        `MATCH (${stripeInvoiceMeta.nodeName}:${stripeInvoiceMeta.labelName})-[:BELONGS_TO]->(${stripeCustomerMeta.nodeName}:${stripeCustomerMeta.labelName} {id: $stripeCustomerId})`,
      );
      expect(mockQuery.query).toContain(
        `OPTIONAL MATCH (${stripeInvoiceMeta.nodeName})-[:FOR_SUBSCRIPTION]->(${stripeSubscriptionMeta.nodeName}:${stripeSubscriptionMeta.labelName})`,
      );
      expect(mockQuery.query).toContain(`WHERE 1=1`);
      expect(mockQuery.query).not.toContain(`${stripeInvoiceMeta.nodeName}.status = $status`);
      expect(mockQuery.query).toContain(`RETURN ${stripeInvoiceMeta.nodeName}, ${stripeSubscriptionMeta.nodeName}`);
      expect(mockQuery.query).toContain(`ORDER BY ${stripeInvoiceMeta.nodeName}.createdAt DESC`);
      expect(neo4jService.readMany).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual([MOCK_INVOICE]);
    });

    it("should find invoices by billing customer ID with status filter", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_INVOICE]);

      const result = await repository.findByStripeCustomerId({
        stripeCustomerId: TEST_IDS.stripeCustomerId,
        status: "paid",
      });

      expect(mockQuery.queryParams.stripeCustomerId).toBe(TEST_IDS.stripeCustomerId);
      expect(mockQuery.queryParams.status).toBe("paid");
      expect(mockQuery.query).toContain(`WHERE 1=1 AND ${stripeInvoiceMeta.nodeName}.status = $status`);
      expect(result).toEqual([MOCK_INVOICE]);
    });

    it("should return empty array when no invoices found", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      const result = await repository.findByStripeCustomerId({
        stripeCustomerId: TEST_IDS.stripeCustomerId,
      });

      expect(result).toEqual([]);
      expect(neo4jService.readMany).toHaveBeenCalledWith(mockQuery);
    });

    it("should filter by specific status values", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_INVOICE]);

      const statuses: StripeInvoiceStatus[] = ["draft", "open", "paid", "uncollectible", "void"];

      for (const status of statuses) {
        vi.clearAllMocks();
        neo4jService.initQuery.mockReturnValue(createMockQuery());

        await repository.findByStripeCustomerId({
          stripeCustomerId: TEST_IDS.stripeCustomerId,
          status,
        });

        expect(neo4jService.initQuery().queryParams.status).toBe(status);
      }
    });

    it("should handle database errors", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      const error = new Error("Database error");
      neo4jService.readMany.mockRejectedValue(error);

      await expect(repository.findByStripeCustomerId({ stripeCustomerId: TEST_IDS.stripeCustomerId })).rejects.toThrow(
        "Database error",
      );
    });

    it("should order results by createdAt DESC", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_INVOICE]);

      await repository.findByStripeCustomerId({
        stripeCustomerId: TEST_IDS.stripeCustomerId,
      });

      expect(mockQuery.query).toContain(`ORDER BY ${stripeInvoiceMeta.nodeName}.createdAt DESC`);
    });

    it("should use OPTIONAL MATCH for subscription relationship", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_INVOICE]);

      await repository.findByStripeCustomerId({
        stripeCustomerId: TEST_IDS.stripeCustomerId,
      });

      expect(mockQuery.query).toContain("OPTIONAL MATCH");
      expect(mockQuery.query).toContain(
        `(${stripeInvoiceMeta.nodeName})-[:FOR_SUBSCRIPTION]->(${stripeSubscriptionMeta.nodeName}:${stripeSubscriptionMeta.labelName})`,
      );
    });
  });

  describe("findById", () => {
    it("should find invoice by ID with relationships", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_INVOICE);

      const result = await repository.findById({ id: TEST_IDS.invoiceId });

      expect(neo4jService.initQuery).toHaveBeenCalledWith({
        serialiser: expect.anything(),
      });
      expect(mockQuery.queryParams).toEqual({
        id: TEST_IDS.invoiceId,
      });
      expect(mockQuery.query).toContain(
        `MATCH (${stripeInvoiceMeta.nodeName}:${stripeInvoiceMeta.labelName} {id: $id})-[:BELONGS_TO]->(${stripeCustomerMeta.nodeName}:${stripeCustomerMeta.labelName})`,
      );
      expect(mockQuery.query).toContain(
        `OPTIONAL MATCH (${stripeInvoiceMeta.nodeName})-[:FOR_SUBSCRIPTION]->(${stripeSubscriptionMeta.nodeName}:${stripeSubscriptionMeta.labelName})`,
      );
      expect(mockQuery.query).toContain(
        `RETURN ${stripeInvoiceMeta.nodeName}, ${stripeCustomerMeta.nodeName}, ${stripeSubscriptionMeta.nodeName}`,
      );
      expect(neo4jService.readOne).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual(MOCK_INVOICE);
    });

    it("should return null when invoice not found", async () => {
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

      await expect(repository.findById({ id: TEST_IDS.invoiceId })).rejects.toThrow("Read operation failed");
    });

    it("should include billing customer in MATCH clause", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_INVOICE);

      await repository.findById({ id: TEST_IDS.invoiceId });

      expect(mockQuery.query).toContain(
        `MATCH (${stripeInvoiceMeta.nodeName}:${stripeInvoiceMeta.labelName} {id: $id})-[:BELONGS_TO]->(${stripeCustomerMeta.nodeName}:${stripeCustomerMeta.labelName})`,
      );
    });

    it("should use OPTIONAL MATCH for subscription relationship", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_INVOICE);

      await repository.findById({ id: TEST_IDS.invoiceId });

      expect(mockQuery.query).toContain("OPTIONAL MATCH");
    });
  });

  describe("findByStripeInvoiceId", () => {
    it("should find invoice by Stripe invoice ID", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_INVOICE);

      const result = await repository.findByStripeInvoiceId({
        stripeInvoiceId: TEST_IDS.stripeInvoiceId,
      });

      expect(neo4jService.initQuery).toHaveBeenCalledWith({
        serialiser: expect.anything(),
      });
      expect(mockQuery.queryParams).toEqual({
        stripeInvoiceId: TEST_IDS.stripeInvoiceId,
      });
      expect(mockQuery.query).toContain(
        `MATCH (${stripeInvoiceMeta.nodeName}:${stripeInvoiceMeta.labelName} {stripeInvoiceId: $stripeInvoiceId})`,
      );
      expect(mockQuery.query).toContain(`RETURN ${stripeInvoiceMeta.nodeName}`);
      expect(neo4jService.readOne).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual(MOCK_INVOICE);
    });

    it("should return null when invoice not found by Stripe ID", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(null);

      const result = await repository.findByStripeInvoiceId({ stripeInvoiceId: "in_nonexistent" });

      expect(result).toBeNull();
      expect(neo4jService.readOne).toHaveBeenCalledWith(mockQuery);
    });

    it("should handle database errors", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      const error = new Error("Database connection error");
      neo4jService.readOne.mockRejectedValue(error);

      await expect(repository.findByStripeInvoiceId({ stripeInvoiceId: TEST_IDS.stripeInvoiceId })).rejects.toThrow(
        "Database connection error",
      );
    });

    it("should preserve exact Stripe invoice ID format", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_INVOICE);

      const exactStripeId = "in_1MvN8z3FkJ0LJ6p";

      await repository.findByStripeInvoiceId({ stripeInvoiceId: exactStripeId });

      expect(mockQuery.queryParams.stripeInvoiceId).toBe(exactStripeId);
    });
  });

  describe("create", () => {
    const validCreateParams = {
      stripeCustomerId: TEST_IDS.stripeCustomerId,
      stripeInvoiceId: TEST_IDS.stripeInvoiceId,
      stripeInvoiceNumber: "ABC-1234",
      stripeHostedInvoiceUrl: "https://stripe.com/invoice/test123",
      stripePdfUrl: "https://stripe.com/invoice/test123.pdf",
      status: "open" as StripeInvoiceStatus,
      currency: "usd",
      amountDue: 5000,
      amountPaid: 0,
      amountRemaining: 5000,
      subtotal: 5000,
      total: 5000,
      tax: 0,
      periodStart: MOCK_DATES.periodStart,
      periodEnd: MOCK_DATES.periodEnd,
      dueDate: MOCK_DATES.dueDate,
      paidAt: null,
      attemptCount: 0,
      attempted: false,
    };

    it("should create invoice without subscription relationship", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_INVOICE);

      const result = await repository.create(validCreateParams);

      expect(neo4jService.initQuery).toHaveBeenCalledWith({
        serialiser: expect.anything(),
      });
      expect(mockQuery.queryParams).toMatchObject({
        stripeCustomerId: validCreateParams.stripeCustomerId,
        subscriptionId: null,
        stripeInvoiceId: validCreateParams.stripeInvoiceId,
        stripeInvoiceNumber: validCreateParams.stripeInvoiceNumber,
        stripeHostedInvoiceUrl: validCreateParams.stripeHostedInvoiceUrl,
        stripePdfUrl: validCreateParams.stripePdfUrl,
        status: validCreateParams.status,
        currency: validCreateParams.currency,
        amountDue: validCreateParams.amountDue,
        amountPaid: validCreateParams.amountPaid,
        amountRemaining: validCreateParams.amountRemaining,
        subtotal: validCreateParams.subtotal,
        total: validCreateParams.total,
        tax: validCreateParams.tax,
        periodStart: MOCK_DATES.periodStart.toISOString(),
        periodEnd: MOCK_DATES.periodEnd.toISOString(),
        dueDate: MOCK_DATES.dueDate.toISOString(),
        paidAt: null,
        attemptCount: 0,
        attempted: false,
      });
      expect(mockQuery.queryParams.id).toBeDefined();
      expect(mockQuery.query).toContain(
        `MATCH (${stripeCustomerMeta.nodeName}:${stripeCustomerMeta.labelName} {id: $stripeCustomerId})`,
      );
      expect(mockQuery.query).not.toContain(
        `MATCH (${stripeSubscriptionMeta.nodeName}:${stripeSubscriptionMeta.labelName} {id: $subscriptionId})`,
      );
      expect(mockQuery.query).toContain(`CREATE (${stripeInvoiceMeta.nodeName}:${stripeInvoiceMeta.labelName}`);
      expect(mockQuery.query).toContain("createdAt: datetime()");
      expect(mockQuery.query).toContain("updatedAt: datetime()");
      expect(mockQuery.query).toContain(
        `CREATE (${stripeInvoiceMeta.nodeName})-[:BELONGS_TO]->(${stripeCustomerMeta.nodeName})`,
      );
      expect(mockQuery.query).not.toContain(
        `CREATE (${stripeInvoiceMeta.nodeName})-[:FOR_SUBSCRIPTION]->(${stripeSubscriptionMeta.nodeName})`,
      );
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual(MOCK_INVOICE);
    });

    it("should create invoice with subscription relationship", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_INVOICE);

      const paramsWithSubscription = {
        ...validCreateParams,
        subscriptionId: TEST_IDS.subscriptionId,
      };

      await repository.create(paramsWithSubscription);

      expect(mockQuery.queryParams.subscriptionId).toBe(TEST_IDS.subscriptionId);
      expect(mockQuery.query).toContain(
        `MATCH (${stripeSubscriptionMeta.nodeName}:${stripeSubscriptionMeta.labelName} {id: $subscriptionId})`,
      );
      expect(mockQuery.query).toContain(
        `CREATE (${stripeInvoiceMeta.nodeName})-[:FOR_SUBSCRIPTION]->(${stripeSubscriptionMeta.nodeName})`,
      );
    });

    it("should handle nullable stripeInvoiceNumber", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_INVOICE);

      const paramsWithNullInvoiceNumber = {
        ...validCreateParams,
        stripeInvoiceNumber: null,
      };

      await repository.create(paramsWithNullInvoiceNumber);

      expect(mockQuery.queryParams.stripeInvoiceNumber).toBeNull();
    });

    it("should handle nullable stripeHostedInvoiceUrl", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_INVOICE);

      const paramsWithNullUrl = {
        ...validCreateParams,
        stripeHostedInvoiceUrl: null,
      };

      await repository.create(paramsWithNullUrl);

      expect(mockQuery.queryParams.stripeHostedInvoiceUrl).toBeNull();
    });

    it("should handle nullable stripePdfUrl", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_INVOICE);

      const paramsWithNullPdfUrl = {
        ...validCreateParams,
        stripePdfUrl: null,
      };

      await repository.create(paramsWithNullPdfUrl);

      expect(mockQuery.queryParams.stripePdfUrl).toBeNull();
    });

    it("should handle nullable tax", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_INVOICE);

      const paramsWithNullTax = {
        ...validCreateParams,
        tax: null,
      };

      await repository.create(paramsWithNullTax);

      expect(mockQuery.queryParams.tax).toBeNull();
    });

    it("should handle nullable dueDate with CASE WHEN", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_INVOICE);

      const paramsWithNullDueDate = {
        ...validCreateParams,
        dueDate: null,
      };

      await repository.create(paramsWithNullDueDate);

      expect(mockQuery.queryParams.dueDate).toBeNull();
      expect(mockQuery.query).toContain(
        "dueDate: CASE WHEN $dueDate IS NOT NULL THEN datetime($dueDate) ELSE null END",
      );
    });

    it("should handle nullable paidAt with CASE WHEN", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_INVOICE);

      await repository.create(validCreateParams);

      expect(mockQuery.queryParams.paidAt).toBeNull();
      expect(mockQuery.query).toContain("paidAt: CASE WHEN $paidAt IS NOT NULL THEN datetime($paidAt) ELSE null END");
    });

    it("should convert Date objects to ISO strings for Neo4j datetime", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_INVOICE);

      await repository.create(validCreateParams);

      expect(mockQuery.queryParams.periodStart).toBe(MOCK_DATES.periodStart.toISOString());
      expect(mockQuery.queryParams.periodEnd).toBe(MOCK_DATES.periodEnd.toISOString());
      expect(mockQuery.query).toContain("periodStart: datetime($periodStart)");
      expect(mockQuery.query).toContain("periodEnd: datetime($periodEnd)");
    });

    it("should generate unique UUID for each invoice", async () => {
      const mockQuery1 = createMockQuery();
      const mockQuery2 = createMockQuery();
      neo4jService.initQuery.mockReturnValueOnce(mockQuery1).mockReturnValueOnce(mockQuery2);
      neo4jService.writeOne.mockResolvedValue(MOCK_INVOICE);

      await repository.create(validCreateParams);
      await repository.create(validCreateParams);

      expect(mockQuery1.queryParams.id).toBeDefined();
      expect(mockQuery2.queryParams.id).toBeDefined();
      expect(mockQuery1.queryParams.id).not.toEqual(mockQuery2.queryParams.id);
    });

    it("should handle creation errors", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      const error = new Error("Creation failed - billing customer not found");
      neo4jService.writeOne.mockRejectedValue(error);

      await expect(repository.create(validCreateParams)).rejects.toThrow(
        "Creation failed - billing customer not found",
      );
    });

    it("should handle all numeric amount fields", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_INVOICE);

      await repository.create(validCreateParams);

      expect(mockQuery.queryParams.amountDue).toBe(5000);
      expect(mockQuery.queryParams.amountPaid).toBe(0);
      expect(mockQuery.queryParams.amountRemaining).toBe(5000);
      expect(mockQuery.queryParams.subtotal).toBe(5000);
      expect(mockQuery.queryParams.total).toBe(5000);
    });

    it("should create invoice with all StripeInvoiceStatus values", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_INVOICE);

      const statuses: StripeInvoiceStatus[] = ["draft", "open", "paid", "uncollectible", "void"];

      for (const status of statuses) {
        vi.clearAllMocks();
        neo4jService.initQuery.mockReturnValue(createMockQuery());

        await repository.create({
          ...validCreateParams,
          status,
        });

        expect(neo4jService.initQuery().queryParams.status).toBe(status);
      }
    });

    it("should set paidAt when creating paid invoice", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_INVOICE);

      const paramsWithPaidAt = {
        ...validCreateParams,
        status: "paid" as StripeInvoiceStatus,
        paidAt: MOCK_DATES.paidAt,
        amountPaid: 5000,
        amountRemaining: 0,
      };

      await repository.create(paramsWithPaidAt);

      expect(mockQuery.queryParams.paidAt).toBe(MOCK_DATES.paidAt.toISOString());
    });

    it("should handle attemptCount and attempted flags", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_INVOICE);

      const paramsWithAttempts = {
        ...validCreateParams,
        attemptCount: 3,
        attempted: true,
      };

      await repository.create(paramsWithAttempts);

      expect(mockQuery.queryParams.attemptCount).toBe(3);
      expect(mockQuery.queryParams.attempted).toBe(true);
    });
  });

  describe("updateByStripeInvoiceId", () => {
    it("should update status field", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_INVOICE);

      const params = {
        stripeInvoiceId: TEST_IDS.stripeInvoiceId,
        status: "paid" as StripeInvoiceStatus,
      };

      const result = await repository.updateByStripeInvoiceId(params);

      expect(mockQuery.queryParams.stripeInvoiceId).toBe(TEST_IDS.stripeInvoiceId);
      expect(mockQuery.queryParams.status).toBe("paid");
      expect(mockQuery.query).toContain(`${stripeInvoiceMeta.nodeName}.updatedAt = datetime()`);
      expect(mockQuery.query).toContain(`${stripeInvoiceMeta.nodeName}.status = $status`);
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual(MOCK_INVOICE);
    });

    it("should update amountDue field", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_INVOICE);

      const params = {
        stripeInvoiceId: TEST_IDS.stripeInvoiceId,
        amountDue: 6000,
      };

      await repository.updateByStripeInvoiceId(params);

      expect(mockQuery.queryParams.amountDue).toBe(6000);
      expect(mockQuery.query).toContain(`${stripeInvoiceMeta.nodeName}.amountDue = $amountDue`);
    });

    it("should update amountPaid field", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_INVOICE);

      const params = {
        stripeInvoiceId: TEST_IDS.stripeInvoiceId,
        amountPaid: 5000,
      };

      await repository.updateByStripeInvoiceId(params);

      expect(mockQuery.queryParams.amountPaid).toBe(5000);
      expect(mockQuery.query).toContain(`${stripeInvoiceMeta.nodeName}.amountPaid = $amountPaid`);
    });

    it("should update amountRemaining field", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_INVOICE);

      const params = {
        stripeInvoiceId: TEST_IDS.stripeInvoiceId,
        amountRemaining: 0,
      };

      await repository.updateByStripeInvoiceId(params);

      expect(mockQuery.queryParams.amountRemaining).toBe(0);
      expect(mockQuery.query).toContain(`${stripeInvoiceMeta.nodeName}.amountRemaining = $amountRemaining`);
    });

    it("should update paidAt field with Date value", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_INVOICE);

      const params = {
        stripeInvoiceId: TEST_IDS.stripeInvoiceId,
        paidAt: MOCK_DATES.paidAt,
      };

      await repository.updateByStripeInvoiceId(params);

      expect(mockQuery.queryParams.paidAt).toBe(MOCK_DATES.paidAt.toISOString());
      expect(mockQuery.query).toContain(
        `${stripeInvoiceMeta.nodeName}.paidAt = CASE WHEN $paidAt IS NOT NULL THEN datetime($paidAt) ELSE null END`,
      );
    });

    it("should update paidAt field with null value", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_INVOICE);

      const params = {
        stripeInvoiceId: TEST_IDS.stripeInvoiceId,
        paidAt: null,
      };

      await repository.updateByStripeInvoiceId(params);

      expect(mockQuery.queryParams.paidAt).toBeNull();
      expect(mockQuery.query).toContain(
        `${stripeInvoiceMeta.nodeName}.paidAt = CASE WHEN $paidAt IS NOT NULL THEN datetime($paidAt) ELSE null END`,
      );
    });

    it("should update attemptCount field", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_INVOICE);

      const params = {
        stripeInvoiceId: TEST_IDS.stripeInvoiceId,
        attemptCount: 2,
      };

      await repository.updateByStripeInvoiceId(params);

      expect(mockQuery.queryParams.attemptCount).toBe(2);
      expect(mockQuery.query).toContain(`${stripeInvoiceMeta.nodeName}.attemptCount = $attemptCount`);
    });

    it("should update attempted field", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_INVOICE);

      const params = {
        stripeInvoiceId: TEST_IDS.stripeInvoiceId,
        attempted: true,
      };

      await repository.updateByStripeInvoiceId(params);

      expect(mockQuery.queryParams.attempted).toBe(true);
      expect(mockQuery.query).toContain(`${stripeInvoiceMeta.nodeName}.attempted = $attempted`);
    });

    it("should update stripeHostedInvoiceUrl field", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_INVOICE);

      const params = {
        stripeInvoiceId: TEST_IDS.stripeInvoiceId,
        stripeHostedInvoiceUrl: "https://stripe.com/invoice/updated",
      };

      await repository.updateByStripeInvoiceId(params);

      expect(mockQuery.queryParams.stripeHostedInvoiceUrl).toBe("https://stripe.com/invoice/updated");
      expect(mockQuery.query).toContain(
        `${stripeInvoiceMeta.nodeName}.stripeHostedInvoiceUrl = $stripeHostedInvoiceUrl`,
      );
    });

    it("should update stripePdfUrl field", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_INVOICE);

      const params = {
        stripeInvoiceId: TEST_IDS.stripeInvoiceId,
        stripePdfUrl: "https://stripe.com/invoice/updated.pdf",
      };

      await repository.updateByStripeInvoiceId(params);

      expect(mockQuery.queryParams.stripePdfUrl).toBe("https://stripe.com/invoice/updated.pdf");
      expect(mockQuery.query).toContain(`${stripeInvoiceMeta.nodeName}.stripePdfUrl = $stripePdfUrl`);
    });

    it("should update multiple fields at once", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_INVOICE);

      const params = {
        stripeInvoiceId: TEST_IDS.stripeInvoiceId,
        status: "paid" as StripeInvoiceStatus,
        amountPaid: 5000,
        amountRemaining: 0,
        paidAt: MOCK_DATES.paidAt,
        attemptCount: 1,
        attempted: true,
      };

      await repository.updateByStripeInvoiceId(params);

      expect(mockQuery.query).toContain(`${stripeInvoiceMeta.nodeName}.status = $status`);
      expect(mockQuery.query).toContain(`${stripeInvoiceMeta.nodeName}.amountPaid = $amountPaid`);
      expect(mockQuery.query).toContain(`${stripeInvoiceMeta.nodeName}.amountRemaining = $amountRemaining`);
      expect(mockQuery.query).toContain(
        `${stripeInvoiceMeta.nodeName}.paidAt = CASE WHEN $paidAt IS NOT NULL THEN datetime($paidAt) ELSE null END`,
      );
      expect(mockQuery.query).toContain(`${stripeInvoiceMeta.nodeName}.attemptCount = $attemptCount`);
      expect(mockQuery.query).toContain(`${stripeInvoiceMeta.nodeName}.attempted = $attempted`);
      expect(mockQuery.queryParams).toMatchObject({
        status: "paid",
        amountPaid: 5000,
        amountRemaining: 0,
        paidAt: MOCK_DATES.paidAt.toISOString(),
        attemptCount: 1,
        attempted: true,
      });
    });

    it("should only update updatedAt when no optional fields provided", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_INVOICE);

      const params = {
        stripeInvoiceId: TEST_IDS.stripeInvoiceId,
      };

      await repository.updateByStripeInvoiceId(params);

      expect(mockQuery.query).toContain(`${stripeInvoiceMeta.nodeName}.updatedAt = datetime()`);
      expect(mockQuery.query).not.toContain(`${stripeInvoiceMeta.nodeName}.status = $status`);
      expect(mockQuery.query).not.toContain(`${stripeInvoiceMeta.nodeName}.amountDue = $amountDue`);
    });

    it("should always update updatedAt timestamp", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_INVOICE);

      await repository.updateByStripeInvoiceId({
        stripeInvoiceId: TEST_IDS.stripeInvoiceId,
        status: "paid",
      });

      expect(mockQuery.query).toContain(`${stripeInvoiceMeta.nodeName}.updatedAt = datetime()`);
    });

    it("should handle update errors", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      const error = new Error("Update failed - invoice not found");
      neo4jService.writeOne.mockRejectedValue(error);

      await expect(
        repository.updateByStripeInvoiceId({ stripeInvoiceId: TEST_IDS.stripeInvoiceId, status: "paid" }),
      ).rejects.toThrow("Update failed - invoice not found");
    });

    it("should handle zero values for numeric fields", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_INVOICE);

      await repository.updateByStripeInvoiceId({
        stripeInvoiceId: TEST_IDS.stripeInvoiceId,
        amountDue: 0,
        amountPaid: 0,
        amountRemaining: 0,
        attemptCount: 0,
      });

      expect(mockQuery.query).toContain(`${stripeInvoiceMeta.nodeName}.amountDue = $amountDue`);
      expect(mockQuery.query).toContain(`${stripeInvoiceMeta.nodeName}.amountPaid = $amountPaid`);
      expect(mockQuery.query).toContain(`${stripeInvoiceMeta.nodeName}.amountRemaining = $amountRemaining`);
      expect(mockQuery.query).toContain(`${stripeInvoiceMeta.nodeName}.attemptCount = $attemptCount`);
      expect(mockQuery.queryParams.amountDue).toBe(0);
      expect(mockQuery.queryParams.amountPaid).toBe(0);
      expect(mockQuery.queryParams.amountRemaining).toBe(0);
      expect(mockQuery.queryParams.attemptCount).toBe(0);
    });

    it("should handle attempted as false", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_INVOICE);

      await repository.updateByStripeInvoiceId({
        stripeInvoiceId: TEST_IDS.stripeInvoiceId,
        attempted: false,
      });

      expect(mockQuery.query).toContain(`${stripeInvoiceMeta.nodeName}.attempted = $attempted`);
      expect(mockQuery.queryParams.attempted).toBe(false);
    });

    it("should update all StripeInvoiceStatus values", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_INVOICE);

      const statuses: StripeInvoiceStatus[] = ["draft", "open", "paid", "uncollectible", "void"];

      for (const status of statuses) {
        vi.clearAllMocks();
        neo4jService.initQuery.mockReturnValue(createMockQuery());

        await repository.updateByStripeInvoiceId({
          stripeInvoiceId: TEST_IDS.stripeInvoiceId,
          status,
        });

        expect(neo4jService.initQuery().queryParams.status).toBe(status);
      }
    });

    it("should handle setting paidAt to null when invoice is voided", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_INVOICE);

      const params = {
        stripeInvoiceId: TEST_IDS.stripeInvoiceId,
        status: "void" as StripeInvoiceStatus,
        paidAt: null,
      };

      await repository.updateByStripeInvoiceId(params);

      expect(mockQuery.queryParams.paidAt).toBeNull();
      expect(mockQuery.query).toContain(
        `${stripeInvoiceMeta.nodeName}.paidAt = CASE WHEN $paidAt IS NOT NULL THEN datetime($paidAt) ELSE null END`,
      );
    });
  });

  describe("Edge Cases", () => {
    it("should handle very large amount values", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_INVOICE);

      await repository.updateByStripeInvoiceId({
        stripeInvoiceId: TEST_IDS.stripeInvoiceId,
        amountDue: 999999999,
      });

      expect(mockQuery.queryParams.amountDue).toBe(999999999);
    });

    it("should handle negative amount values", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_INVOICE);

      await repository.updateByStripeInvoiceId({
        stripeInvoiceId: TEST_IDS.stripeInvoiceId,
        amountDue: -1000,
      });

      expect(mockQuery.queryParams.amountDue).toBe(-1000);
    });

    it("should handle future dates for dueDate", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_INVOICE);

      const futureDate = new Date("2099-12-31T23:59:59Z");

      await repository.create({
        stripeCustomerId: TEST_IDS.stripeCustomerId,
        stripeInvoiceId: TEST_IDS.stripeInvoiceId,
        stripeInvoiceNumber: "ABC-1234",
        stripeHostedInvoiceUrl: "https://stripe.com/invoice/test123",
        stripePdfUrl: "https://stripe.com/invoice/test123.pdf",
        status: "open",
        currency: "usd",
        amountDue: 5000,
        amountPaid: 0,
        amountRemaining: 5000,
        subtotal: 5000,
        total: 5000,
        tax: 0,
        periodStart: MOCK_DATES.periodStart,
        periodEnd: MOCK_DATES.periodEnd,
        dueDate: futureDate,
        paidAt: null,
        attemptCount: 0,
        attempted: false,
      });

      expect(mockQuery.queryParams.dueDate).toBe(futureDate.toISOString());
    });

    it("should handle past dates for paidAt", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_INVOICE);

      const pastDate = new Date("2000-01-01T00:00:00Z");

      await repository.updateByStripeInvoiceId({
        stripeInvoiceId: TEST_IDS.stripeInvoiceId,
        paidAt: pastDate,
      });

      expect(mockQuery.queryParams.paidAt).toBe(pastDate.toISOString());
    });

    it("should handle empty string for currency", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_INVOICE);

      await repository.create({
        stripeCustomerId: TEST_IDS.stripeCustomerId,
        stripeInvoiceId: TEST_IDS.stripeInvoiceId,
        stripeInvoiceNumber: "ABC-1234",
        stripeHostedInvoiceUrl: "https://stripe.com/invoice/test123",
        stripePdfUrl: "https://stripe.com/invoice/test123.pdf",
        status: "open",
        currency: "",
        amountDue: 5000,
        amountPaid: 0,
        amountRemaining: 5000,
        subtotal: 5000,
        total: 5000,
        tax: 0,
        periodStart: MOCK_DATES.periodStart,
        periodEnd: MOCK_DATES.periodEnd,
        dueDate: null,
        paidAt: null,
        attemptCount: 0,
        attempted: false,
      });

      expect(mockQuery.queryParams.currency).toBe("");
    });

    it("should handle high attemptCount values", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_INVOICE);

      await repository.updateByStripeInvoiceId({
        stripeInvoiceId: TEST_IDS.stripeInvoiceId,
        attemptCount: 100,
      });

      expect(mockQuery.queryParams.attemptCount).toBe(100);
    });
  });

  describe("Parameter Validation", () => {
    it("should preserve exact UUID values", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_INVOICE);

      const exactId = "123e4567-e89b-12d3-a456-426614174000";

      await repository.findById({ id: exactId });

      expect(mockQuery.queryParams.id).toBe(exactId);
    });

    it("should preserve exact Stripe invoice ID format", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_INVOICE);

      const exactStripeId = "in_1MvN8z3FkJ0LJ6p";

      await repository.findByStripeInvoiceId({ stripeInvoiceId: exactStripeId });

      expect(mockQuery.queryParams.stripeInvoiceId).toBe(exactStripeId);
    });

    it("should preserve exact datetime values after ISO conversion", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_INVOICE);

      const exactDate = new Date("2025-06-15T14:30:00.000Z");

      await repository.create({
        stripeCustomerId: TEST_IDS.stripeCustomerId,
        stripeInvoiceId: TEST_IDS.stripeInvoiceId,
        stripeInvoiceNumber: "ABC-1234",
        stripeHostedInvoiceUrl: "https://stripe.com/invoice/test123",
        stripePdfUrl: "https://stripe.com/invoice/test123.pdf",
        status: "open",
        currency: "usd",
        amountDue: 5000,
        amountPaid: 0,
        amountRemaining: 5000,
        subtotal: 5000,
        total: 5000,
        tax: 0,
        periodStart: exactDate,
        periodEnd: exactDate,
        dueDate: null,
        paidAt: null,
        attemptCount: 0,
        attempted: false,
      });

      expect(mockQuery.queryParams.periodStart).toBe("2025-06-15T14:30:00.000Z");
      expect(mockQuery.queryParams.periodEnd).toBe("2025-06-15T14:30:00.000Z");
    });
  });

  describe("Service Integration", () => {
    it("should call Neo4jService.initQuery with serialiser for read operations", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_INVOICE);
      neo4jService.readMany.mockResolvedValue([MOCK_INVOICE]);

      await repository.findById({ id: TEST_IDS.invoiceId });
      await repository.findByStripeInvoiceId({ stripeInvoiceId: TEST_IDS.stripeInvoiceId });
      await repository.findByStripeCustomerId({ stripeCustomerId: TEST_IDS.stripeCustomerId });

      expect(neo4jService.initQuery).toHaveBeenCalledTimes(3);
      expect(neo4jService.initQuery).toHaveBeenCalledWith({ serialiser: expect.anything() });
    });

    it("should call Neo4jService.writeOne for create and update operations", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_INVOICE);

      await repository.create({
        stripeCustomerId: TEST_IDS.stripeCustomerId,
        stripeInvoiceId: TEST_IDS.stripeInvoiceId,
        stripeInvoiceNumber: "ABC-1234",
        stripeHostedInvoiceUrl: "https://stripe.com/invoice/test123",
        stripePdfUrl: "https://stripe.com/invoice/test123.pdf",
        status: "open",
        currency: "usd",
        amountDue: 5000,
        amountPaid: 0,
        amountRemaining: 5000,
        subtotal: 5000,
        total: 5000,
        tax: 0,
        periodStart: MOCK_DATES.periodStart,
        periodEnd: MOCK_DATES.periodEnd,
        dueDate: null,
        paidAt: null,
        attemptCount: 0,
        attempted: false,
      });

      await repository.updateByStripeInvoiceId({ stripeInvoiceId: TEST_IDS.stripeInvoiceId, status: "paid" });

      expect(neo4jService.writeOne).toHaveBeenCalledTimes(2);
    });

    it("should use readMany for findByStripeCustomerId", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_INVOICE]);

      await repository.findByStripeCustomerId({ stripeCustomerId: TEST_IDS.stripeCustomerId });

      expect(neo4jService.readMany).toHaveBeenCalledWith(mockQuery);
    });

    it("should use readOne for findById and findByStripeInvoiceId", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_INVOICE);

      await repository.findById({ id: TEST_IDS.invoiceId });
      await repository.findByStripeInvoiceId({ stripeInvoiceId: TEST_IDS.stripeInvoiceId });

      expect(neo4jService.readOne).toHaveBeenCalledTimes(2);
    });
  });

  describe("Conditional Query Building", () => {
    it("should build query without subscription MATCH when subscriptionId not provided", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_INVOICE);

      await repository.create({
        stripeCustomerId: TEST_IDS.stripeCustomerId,
        stripeInvoiceId: TEST_IDS.stripeInvoiceId,
        stripeInvoiceNumber: "ABC-1234",
        stripeHostedInvoiceUrl: "https://stripe.com/invoice/test123",
        stripePdfUrl: "https://stripe.com/invoice/test123.pdf",
        status: "open",
        currency: "usd",
        amountDue: 5000,
        amountPaid: 0,
        amountRemaining: 5000,
        subtotal: 5000,
        total: 5000,
        tax: 0,
        periodStart: MOCK_DATES.periodStart,
        periodEnd: MOCK_DATES.periodEnd,
        dueDate: null,
        paidAt: null,
        attemptCount: 0,
        attempted: false,
      });

      expect(mockQuery.query).not.toContain(
        `MATCH (${stripeSubscriptionMeta.nodeName}:${stripeSubscriptionMeta.labelName}`,
      );
      expect(mockQuery.query).not.toContain(`CREATE (${stripeInvoiceMeta.nodeName})-[:FOR_SUBSCRIPTION]->`);
    });

    it("should build query with subscription MATCH when subscriptionId provided", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_INVOICE);

      await repository.create({
        stripeCustomerId: TEST_IDS.stripeCustomerId,
        subscriptionId: TEST_IDS.subscriptionId,
        stripeInvoiceId: TEST_IDS.stripeInvoiceId,
        stripeInvoiceNumber: "ABC-1234",
        stripeHostedInvoiceUrl: "https://stripe.com/invoice/test123",
        stripePdfUrl: "https://stripe.com/invoice/test123.pdf",
        status: "open",
        currency: "usd",
        amountDue: 5000,
        amountPaid: 0,
        amountRemaining: 5000,
        subtotal: 5000,
        total: 5000,
        tax: 0,
        periodStart: MOCK_DATES.periodStart,
        periodEnd: MOCK_DATES.periodEnd,
        dueDate: null,
        paidAt: null,
        attemptCount: 0,
        attempted: false,
      });

      expect(mockQuery.query).toContain(
        `MATCH (${stripeSubscriptionMeta.nodeName}:${stripeSubscriptionMeta.labelName} {id: $subscriptionId})`,
      );
      expect(mockQuery.query).toContain(
        `CREATE (${stripeInvoiceMeta.nodeName})-[:FOR_SUBSCRIPTION]->(${stripeSubscriptionMeta.nodeName})`,
      );
    });

    it("should build query without status filter when status not provided", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_INVOICE]);

      await repository.findByStripeCustomerId({
        stripeCustomerId: TEST_IDS.stripeCustomerId,
      });

      expect(mockQuery.query).toContain("WHERE 1=1");
      expect(mockQuery.query).not.toContain(`${stripeInvoiceMeta.nodeName}.status = $status`);
    });

    it("should build query with status filter when status provided", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_INVOICE]);

      await repository.findByStripeCustomerId({
        stripeCustomerId: TEST_IDS.stripeCustomerId,
        status: "paid",
      });

      expect(mockQuery.query).toContain("WHERE 1=1 AND");
      expect(mockQuery.query).toContain(`${stripeInvoiceMeta.nodeName}.status = $status`);
    });
  });
});
