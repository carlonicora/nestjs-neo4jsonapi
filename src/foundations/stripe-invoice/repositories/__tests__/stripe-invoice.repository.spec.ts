import { vi, describe, it, expect, beforeEach, afterEach, type Mocked } from "vitest";
// Mock problematic modules before any imports
vi.mock("../../../../foundations/chunker/chunker.module", () => ({
  ChunkerModule: class {},
}));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({}));

import { Test, TestingModule } from "@nestjs/testing";
import { ClsService } from "nestjs-cls";
import { Neo4jService } from "../../../../core/neo4j";
import { SecurityService } from "../../../../core/security/services/security.service";
import { StripeInvoiceRepository } from "../stripe-invoice.repository";
import { StripeInvoiceDescriptor } from "../../entities/stripe-invoice";
import { stripeInvoiceMeta } from "../../entities/stripe-invoice.meta";
import { stripeCustomerMeta } from "../../../stripe-customer/entities/stripe-customer.meta";
import { stripeSubscriptionMeta } from "../../../stripe-subscription/entities/stripe-subscription.meta";
import { StripeInvoice, StripeInvoiceStatus } from "../../entities/stripe-invoice.entity";
import { StripeCustomer } from "../../../stripe-customer/entities/stripe-customer.entity";

describe("StripeInvoiceRepository", () => {
  let repository: StripeInvoiceRepository;
  let neo4jService: Mocked<Neo4jService>;

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
    type: "stripe-invoices",
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
    stripeCustomer: {} as StripeCustomer,
  };

  const createMockQuery = () => ({
    query: "",
    queryParams: {} as Record<string, unknown>,
  });

  beforeEach(async () => {
    const mockNeo4jService = {
      writeOne: vi.fn(),
      readOne: vi.fn(),
      readMany: vi.fn(),
      readCount: vi.fn(),
      readScalars: vi.fn(),
      validateRelatedNodes: vi.fn(),
      initQuery: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeInvoiceRepository,
        {
          provide: Neo4jService,
          useValue: mockNeo4jService,
        },
        { provide: SecurityService, useValue: {} },
        { provide: ClsService, useValue: { get: vi.fn(() => undefined), has: vi.fn(() => false) } },
      ],
    }).compile();

    repository = module.get<StripeInvoiceRepository>(StripeInvoiceRepository);
    neo4jService = module.get<Neo4jService>(Neo4jService) as Mocked<Neo4jService>;

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
    it("starts from buildDefaultMatch, joins the customer by id and returns only the invoice column", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_INVOICE]);

      const result = await repository.findByStripeCustomerId({
        stripeCustomerId: TEST_IDS.stripeCustomerId,
      });

      expect(neo4jService.initQuery).toHaveBeenCalledWith({
        serialiser: StripeInvoiceDescriptor.model,
        cursor: undefined,
      });
      expect(mockQuery.queryParams.stripeCustomerId).toBe(TEST_IDS.stripeCustomerId);
      expect(mockQuery.query).toContain(`MATCH (${stripeInvoiceMeta.nodeName}:${stripeInvoiceMeta.labelName})`);
      expect(mockQuery.query).toContain(`WHERE $companyId IS NULL`);
      expect(mockQuery.query).toContain(
        `MATCH (${stripeInvoiceMeta.nodeName})-[:BELONGS_TO]->(:${stripeCustomerMeta.labelName} {id: $stripeCustomerId})`,
      );
      expect(mockQuery.query).toContain("{CURSOR}");
      expect(mockQuery.query).toMatch(/RETURN stripeInvoice\s+ORDER BY stripeInvoice\.createdAt DESC\s*$/);
      expect(neo4jService.readMany).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual([MOCK_INVOICE]);
    });

    it("accepts a status but applies no filter (kept quirk)", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_INVOICE]);

      const result = await repository.findByStripeCustomerId({
        stripeCustomerId: TEST_IDS.stripeCustomerId,
        status: "paid",
      });

      expect(mockQuery.queryParams.status).toBeUndefined();
      expect(mockQuery.query).not.toContain(`${stripeInvoiceMeta.nodeName}.status`);
      expect(result).toEqual([MOCK_INVOICE]);
    });

    it("passes the cursor to initQuery", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);
      const cursor = { cursor: "25", take: 25 } as any;

      await repository.findByStripeCustomerId({ stripeCustomerId: TEST_IDS.stripeCustomerId, cursor });

      expect(neo4jService.initQuery).toHaveBeenCalledWith({ serialiser: StripeInvoiceDescriptor.model, cursor });
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

    it("should handle database errors", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      const error = new Error("Database error");
      neo4jService.readMany.mockRejectedValue(error);

      await expect(repository.findByStripeCustomerId({ stripeCustomerId: TEST_IDS.stripeCustomerId })).rejects.toThrow(
        "Database error",
      );
    });
  });

  describe("findById", () => {
    it("matches the invoice by id through buildDefaultMatch, keeps the mandatory customer join, returns only the invoice", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_INVOICE);

      const result = await repository.findById({ id: TEST_IDS.invoiceId });

      expect(neo4jService.initQuery).toHaveBeenCalledWith({ serialiser: StripeInvoiceDescriptor.model });
      expect(mockQuery.queryParams.searchValue).toBe(TEST_IDS.invoiceId);
      expect(mockQuery.query).toContain(
        `MATCH (${stripeInvoiceMeta.nodeName}:${stripeInvoiceMeta.labelName} {id: $searchValue})`,
      );
      expect(mockQuery.query).toContain(
        `MATCH (${stripeInvoiceMeta.nodeName})-[:BELONGS_TO]->(:${stripeCustomerMeta.labelName})`,
      );
      expect(mockQuery.query).toMatch(/RETURN stripeInvoice\s*$/);
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
  });

  describe("findByStripeInvoiceId", () => {
    it("matches the Stripe invoice id through buildDefaultMatch and returns only the invoice", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_INVOICE);

      const result = await repository.findByStripeInvoiceId({
        stripeInvoiceId: TEST_IDS.stripeInvoiceId,
      });

      expect(neo4jService.initQuery).toHaveBeenCalledWith({ serialiser: StripeInvoiceDescriptor.model });
      expect(mockQuery.queryParams.searchValue).toBe(TEST_IDS.stripeInvoiceId);
      expect(mockQuery.query).toContain(
        `MATCH (${stripeInvoiceMeta.nodeName}:${stripeInvoiceMeta.labelName} {stripeInvoiceId: $searchValue})`,
      );
      expect(mockQuery.query).toMatch(/RETURN stripeInvoice\s*$/);
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
  });

  describe("customer-facing finders: faithful RETURN", () => {
    const finders = [
      ["findByStripeCustomerId", () => repository.findByStripeCustomerId({ stripeCustomerId: "c" })],
      ["findById", () => repository.findById({ id: "i" })],
      ["findByStripeInvoiceId", () => repository.findByStripeInvoiceId({ stripeInvoiceId: "in_1" })],
    ] as const;

    for (const [name, call] of finders) {
      it(`${name} appends to the initQuery prefix and returns neither the customer nor the subscription column`, async () => {
        const mockQuery = { query: "PREFIX\n", queryParams: { companyId: null } as Record<string, unknown> };
        neo4jService.initQuery.mockReturnValue(mockQuery);
        neo4jService.readMany.mockResolvedValue([]);
        neo4jService.readOne.mockResolvedValue(null);

        await call();

        expect(mockQuery.query.startsWith("PREFIX\n")).toBe(true);
        expect(mockQuery.queryParams).toHaveProperty("companyId", null);
        expect(mockQuery.query).toMatch(/RETURN stripeInvoice(\s+ORDER BY stripeInvoice\.createdAt DESC)?\s*$/);
        expect(mockQuery.query).not.toContain("stripeInvoice_stripeCustomer");
        expect(mockQuery.query).not.toContain("stripeInvoice_subscription");
        expect(mockQuery.query).not.toContain(stripeSubscriptionMeta.labelName);
      });
    }
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
      expect(mockQuery.query).toContain(
        `MERGE (${stripeInvoiceMeta.nodeName}:${stripeInvoiceMeta.labelName} {stripeInvoiceId: $stripeInvoiceId})`,
      );
      expect(mockQuery.query).not.toContain(`CREATE (${stripeInvoiceMeta.nodeName}:`);
      expect(mockQuery.query).toContain(`${stripeInvoiceMeta.nodeName}.createdAt = datetime()`);
      expect(mockQuery.query).toContain(`${stripeInvoiceMeta.nodeName}.updatedAt = datetime()`);
      expect(mockQuery.query).toContain(
        `MERGE (${stripeInvoiceMeta.nodeName})-[:BELONGS_TO]->(${stripeCustomerMeta.nodeName})`,
      );
      expect(mockQuery.query).not.toContain(
        `MERGE (${stripeInvoiceMeta.nodeName})-[:FOR_SUBSCRIPTION]->(${stripeSubscriptionMeta.nodeName})`,
      );
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual(MOCK_INVOICE);
    });

    it("sets only the fixed fields on create and refreshes the changing ones on every write", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_INVOICE);

      await repository.create(validCreateParams);

      const invoice = stripeInvoiceMeta.nodeName;
      const [onCreate, onEveryWrite] = mockQuery.query.split(/\n\s*SET\n/);
      expect(onCreate).toContain("ON CREATE SET");
      expect(onCreate).toContain(`${invoice}.id = $id`);
      expect(onCreate).toContain(`${invoice}.periodStart = datetime($periodStart)`);
      expect(onEveryWrite).toContain(`${invoice}.status = $status`);
      expect(onEveryWrite).toContain(`${invoice}.amountPaid = $amountPaid`);
      expect(onEveryWrite).toContain(
        `${invoice}.paidAt = CASE WHEN $paidAt IS NOT NULL THEN datetime($paidAt) ELSE null END`,
      );
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
        `MERGE (${stripeInvoiceMeta.nodeName})-[:FOR_SUBSCRIPTION]->(${stripeSubscriptionMeta.nodeName})`,
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
        `${stripeInvoiceMeta.nodeName}.dueDate = CASE WHEN $dueDate IS NOT NULL THEN datetime($dueDate) ELSE null END`,
      );
    });

    it("should handle nullable paidAt with CASE WHEN", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_INVOICE);

      await repository.create(validCreateParams);

      expect(mockQuery.queryParams.paidAt).toBeNull();
      expect(mockQuery.query).toContain(
        `${stripeInvoiceMeta.nodeName}.paidAt = CASE WHEN $paidAt IS NOT NULL THEN datetime($paidAt) ELSE null END`,
      );
    });

    it("should convert Date objects to ISO strings for Neo4j datetime", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_INVOICE);

      await repository.create(validCreateParams);

      expect(mockQuery.queryParams.periodStart).toBe(MOCK_DATES.periodStart.toISOString());
      expect(mockQuery.queryParams.periodEnd).toBe(MOCK_DATES.periodEnd.toISOString());
      expect(mockQuery.query).toContain(`${stripeInvoiceMeta.nodeName}.periodStart = datetime($periodStart)`);
      expect(mockQuery.query).toContain(`${stripeInvoiceMeta.nodeName}.periodEnd = datetime($periodEnd)`);
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

      expect(mockQuery.queryParams.searchValue).toBe(exactId);
    });

    it("should preserve exact Stripe invoice ID format", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_INVOICE);

      const exactStripeId = "in_1MvN8z3FkJ0LJ6p";

      await repository.findByStripeInvoiceId({ stripeInvoiceId: exactStripeId });

      expect(mockQuery.queryParams.searchValue).toBe(exactStripeId);
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
      expect(mockQuery.query).not.toContain(`MERGE (${stripeInvoiceMeta.nodeName})-[:FOR_SUBSCRIPTION]->`);
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
        `MERGE (${stripeInvoiceMeta.nodeName})-[:FOR_SUBSCRIPTION]->(${stripeSubscriptionMeta.nodeName})`,
      );
    });

    it("builds the same query with or without a status (kept quirk: the status never filters)", async () => {
      const withoutStatus = createMockQuery();
      const withStatus = createMockQuery();
      neo4jService.initQuery.mockReturnValueOnce(withoutStatus).mockReturnValueOnce(withStatus);
      neo4jService.readMany.mockResolvedValue([MOCK_INVOICE]);

      await repository.findByStripeCustomerId({ stripeCustomerId: TEST_IDS.stripeCustomerId });
      await repository.findByStripeCustomerId({ stripeCustomerId: TEST_IDS.stripeCustomerId, status: "paid" });

      expect(withStatus.query).toBe(withoutStatus.query);
      expect(withStatus.queryParams).toEqual(withoutStatus.queryParams);
    });
  });

  describe("recordServiceLines", () => {
    const base = {
      stripeInvoiceId: TEST_IDS.stripeInvoiceId,
      servicePeriodStart: new Date("2026-10-14T09:00:00.000Z"),
      servicePeriodEnd: new Date("2026-11-14T09:00:00.000Z"),
    };

    it("writes the covered period with datetime casts and marks the invoice checked", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.recordServiceLines({ ...base, markChecked: true });

      expect(mockQuery.queryParams).toMatchObject({
        stripeInvoiceId: TEST_IDS.stripeInvoiceId,
        servicePeriodStart: "2026-10-14T09:00:00.000Z",
        servicePeriodEnd: "2026-11-14T09:00:00.000Z",
      });
      expect(mockQuery.query).toContain(
        `MATCH (${stripeInvoiceMeta.nodeName}:${stripeInvoiceMeta.labelName} {stripeInvoiceId: $stripeInvoiceId})`,
      );
      expect(mockQuery.query).toContain("datetime($servicePeriodStart)");
      expect(mockQuery.query).toContain("datetime($servicePeriodEnd)");
      expect(mockQuery.query).toContain("SET stripeInvoice.serviceLinesCheckedAt = datetime()");
      expect(mockQuery.query).not.toContain("FOR_PRICE");
      expect(mockQuery.query).not.toContain("FOR_PURCHASE");
      expect(neo4jService.readScalars).not.toHaveBeenCalled();
      expect(neo4jService.validateRelatedNodes).toHaveBeenCalledWith({ nodes: [] });
      expect(mockQuery.query).not.toContain("`");
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
    });

    it("does not mark the invoice checked when markChecked is false", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);

      await repository.recordServiceLines({ ...base, markChecked: false });

      expect(mockQuery.query).not.toContain("serviceLinesCheckedAt");
    });

    it("clears the period when none is given (all-proration invoice)", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);

      await repository.recordServiceLines({ stripeInvoiceId: TEST_IDS.stripeInvoiceId, markChecked: true });

      expect(mockQuery.queryParams.servicePeriodStart).toBeNull();
      expect(mockQuery.queryParams.servicePeriodEnd).toBeNull();
    });

    it("links the local price when a Stripe price id is given", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);

      neo4jService.readScalars.mockResolvedValueOnce(["price-node-1"]);

      await repository.recordServiceLines({ ...base, stripePriceId: "price_monthly", markChecked: true });

      const lookup = neo4jService.readScalars.mock.calls[0][0];
      expect(lookup.query).toContain("MATCH (price:StripePrice {stripePriceId: $stripePriceId})");
      expect(lookup.queryParams).toEqual({ stripePriceId: "price_monthly" });
      expect(neo4jService.validateRelatedNodes).toHaveBeenCalledWith({
        nodes: [{ id: "price-node-1", label: "StripePrice" }],
      });
      expect(neo4jService.validateRelatedNodes.mock.invocationCallOrder[0]).toBeLessThan(
        neo4jService.writeOne.mock.invocationCallOrder[0],
      );
      expect(mockQuery.queryParams.priceId).toBe("price-node-1");
      expect(mockQuery.query).toContain("MATCH (price:StripePrice {id: $priceId})");
      expect(mockQuery.query).toContain(`MERGE (${stripeInvoiceMeta.nodeName})-[:FOR_PRICE]->(price)`);
    });

    it("does not link a price that is not stored locally", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readScalars.mockResolvedValueOnce([]);

      await repository.recordServiceLines({ ...base, stripePriceId: "price_missing", markChecked: false });

      expect(neo4jService.validateRelatedNodes).toHaveBeenCalledWith({ nodes: [] });
      expect(mockQuery.query).not.toContain("FOR_PRICE");
    });

    it("links the one-time purchase by its internal id", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);

      await repository.recordServiceLines({ ...base, purchaseSubscriptionId: "purchase-node-1", markChecked: true });

      expect(neo4jService.readScalars).not.toHaveBeenCalled();
      expect(neo4jService.validateRelatedNodes).toHaveBeenCalledWith({
        nodes: [{ id: "purchase-node-1", label: "StripeSubscription" }],
      });
      expect(mockQuery.queryParams.purchaseId).toBe("purchase-node-1");
      expect(mockQuery.query).toContain("MATCH (purchase:StripeSubscription {id: $purchaseId})");
      expect(mockQuery.query).toContain(`MERGE (${stripeInvoiceMeta.nodeName})-[:FOR_PURCHASE]->(purchase)`);
    });
  });

  describe("findWithoutServiceLines", () => {
    it("returns the Stripe ids of the invoices never checked", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([
        { ...MOCK_INVOICE, stripeInvoiceId: "in_a" },
        { ...MOCK_INVOICE, stripeInvoiceId: "in_b" },
      ]);

      const result = await repository.findWithoutServiceLines();

      expect(neo4jService.initQuery).toHaveBeenCalledWith({
        serialiser: StripeInvoiceDescriptor.model,
        fetchAll: true,
      });
      expect(mockQuery.query).toContain(`WHERE ${stripeInvoiceMeta.nodeName}.serviceLinesCheckedAt IS NULL`);
      expect(result).toEqual(["in_a", "in_b"]);
    });
  });

  describe("priceExists", () => {
    it("counts the local StripePrice with that Stripe price id", async () => {
      neo4jService.readCount.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

      await expect(repository.priceExists({ stripePriceId: "price_monthly" })).resolves.toBe(true);
      await expect(repository.priceExists({ stripePriceId: "price_missing" })).resolves.toBe(false);

      const [query, params] = neo4jService.readCount.mock.calls[0];
      expect(query).toContain("{stripePriceId: $stripePriceId}");
      expect(query).toContain("AS total");
      expect(params).toEqual({ stripePriceId: "price_monthly" });
    });
  });

  describe("findForCompanyAdmin", () => {
    it("joins the URL company through its customer, skips drafts, returns price, product and forSubscription, newest first", async () => {
      const mockQuery = { query: "PREFIX\n", queryParams: { companyId: null } as Record<string, unknown> };
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_INVOICE]);

      const result = await repository.findForCompanyAdmin({ companyId: "company-9" });

      expect(neo4jService.initQuery).toHaveBeenCalledWith({
        serialiser: StripeInvoiceDescriptor.model,
        fetchAll: true,
      });
      expect(mockQuery.query.startsWith("PREFIX\n")).toBe(true);
      expect(mockQuery.queryParams.adminCompanyId).toBe("company-9");
      expect(mockQuery.queryParams.companyId).toBeNull();
      // buildDefaultMatch() first (it lets every row through with no CLS company), then the URL company.
      const defaultMatch = mockQuery.query.indexOf("MATCH (stripeInvoice:StripeInvoice)");
      const urlCompany = mockQuery.query.indexOf(
        "MATCH (stripeInvoice)-[:BELONGS_TO]->(:StripeCustomer)-[:BELONGS_TO]->(:Company {id: $adminCompanyId})",
      );
      expect(defaultMatch).toBeGreaterThan(-1);
      expect(mockQuery.query).toContain("WHERE $companyId IS NULL");
      expect(urlCompany).toBeGreaterThan(defaultMatch);
      expect(mockQuery.query).toContain("stripeInvoice.status <> 'draft'");
      expect(mockQuery.query).toContain(
        "EXISTS { MATCH (stripeInvoice)-[:FOR_SUBSCRIPTION]->(:StripeSubscription) } AS forSubscription",
      );
      const order = mockQuery.query.indexOf("ORDER BY coalesce(stripeInvoice.paidAt, stripeInvoice.periodStart) DESC");
      const ret = mockQuery.query.lastIndexOf("RETURN");
      expect(order).toBeGreaterThan(-1);
      expect(order).toBeLessThan(ret);
      const returnClause = mockQuery.query.slice(ret);
      expect(returnClause).toContain("stripeInvoice_stripePrice");
      expect(returnClause).toContain("stripeInvoice_stripePrice_stripeProduct");
      expect(returnClause).toContain("forSubscription");
      expect(mockQuery.query).not.toContain("{CURSOR}");
      expect(mockQuery.query).not.toContain("`");
      expect(result).toEqual([MOCK_INVOICE]);
    });
  });
});
