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
import { FastifyReply } from "fastify";
import { StripeInvoiceController } from "../stripe-invoice.controller";
import { StripeInvoiceAdminService } from "../../services/stripe-invoice-admin.service";
import { AuthenticatedRequest } from "@carlonicora/nestjs-neo4jsonapi";

describe("StripeInvoiceController", () => {
  let controller: StripeInvoiceController;
  let adminService: vi.Mocked<StripeInvoiceAdminService>;
  let mockReply: vi.Mocked<FastifyReply>;

  // Test data constants
  const TEST_IDS = {
    companyId: "660e8400-e29b-41d4-a716-446655440001",
    userId: "550e8400-e29b-41d4-a716-446655440001",
    invoiceId: "dd0e8400-e29b-41d4-a716-446655440001",
    stripeInvoiceId: "in_stripe123",
    subscriptionId: "aa0e8400-e29b-41d4-a716-446655440001",
  };

  const MOCK_INVOICE_RESPONSE = {
    data: {
      type: "stripe-invoices",
      id: TEST_IDS.invoiceId,
      attributes: {
        stripeInvoiceId: TEST_IDS.stripeInvoiceId,
        status: "paid",
        amountDue: 1000,
        amountPaid: 1000,
        amountRemaining: 0,
        currency: "usd",
      },
    },
  };

  const MOCK_INVOICES_LIST_RESPONSE = {
    data: [MOCK_INVOICE_RESPONSE.data],
    meta: {
      total: 1,
    },
  };

  const MOCK_UPCOMING_INVOICE_RESPONSE = {
    subtotal: 1000,
    total: 1100,
    amountDue: 1100,
    currency: "usd",
    periodStart: "2024-01-01T00:00:00.000Z",
    periodEnd: "2024-02-01T00:00:00.000Z",
    lines: [
      {
        id: "line_123",
        description: "Pro Plan (monthly)",
        amount: 1000,
        currency: "usd",
        quantity: 1,
        periodStart: "2024-01-01T00:00:00.000Z",
        periodEnd: "2024-02-01T00:00:00.000Z",
      },
    ],
  };

  // Create a mock authenticated request
  const createMockRequest = (companyId: string = TEST_IDS.companyId): AuthenticatedRequest => {
    return {
      user: {
        companyId,
        userId: TEST_IDS.userId,
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
    const mockStripeInvoiceAdminService = {
      listInvoices: vi.fn(),
      getInvoice: vi.fn(),
      getUpcomingInvoice: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StripeInvoiceController],
      providers: [
        {
          provide: StripeInvoiceAdminService,
          useValue: mockStripeInvoiceAdminService,
        },
      ],
    }).compile();

    controller = module.get<StripeInvoiceController>(StripeInvoiceController);
    adminService = module.get(StripeInvoiceAdminService);

    mockReply = createMockReply();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /stripe-invoices", () => {
    it("should list invoices without status filter", async () => {
      const req = createMockRequest();
      const mockQuery = { page: { size: 10, number: 1 } };
      adminService.listInvoices.mockResolvedValue(MOCK_INVOICES_LIST_RESPONSE);

      await controller.listInvoices(req, mockReply, mockQuery, undefined);

      expect(adminService.listInvoices).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
        query: mockQuery,
        status: undefined,
      });
      expect(mockReply.send).toHaveBeenCalledWith(MOCK_INVOICES_LIST_RESPONSE);
    });

    it("should list invoices with status filter", async () => {
      const req = createMockRequest();
      const mockQuery = { page: { size: 10, number: 1 } };
      adminService.listInvoices.mockResolvedValue(MOCK_INVOICES_LIST_RESPONSE);

      await controller.listInvoices(req, mockReply, mockQuery, "paid");

      expect(adminService.listInvoices).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
        query: mockQuery,
        status: "paid",
      });
      expect(mockReply.send).toHaveBeenCalledWith(MOCK_INVOICES_LIST_RESPONSE);
    });

    it("should pass query object from query params", async () => {
      const req = createMockRequest();
      const customQuery = { filter: { paid: true }, page: { size: 20 } };
      adminService.listInvoices.mockResolvedValue({ data: [] });

      await controller.listInvoices(req, mockReply, customQuery, undefined);

      expect(adminService.listInvoices).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
        query: customQuery,
        status: undefined,
      });
    });

    it("should filter by different invoice statuses", async () => {
      const req = createMockRequest();
      const mockQuery = {};
      adminService.listInvoices.mockResolvedValue(MOCK_INVOICES_LIST_RESPONSE);

      // Test with 'open' status
      await controller.listInvoices(req, mockReply, mockQuery, "open");

      expect(adminService.listInvoices).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
        query: mockQuery,
        status: "open",
      });
    });

    it("should handle service errors", async () => {
      const req = createMockRequest();
      const error = new Error("Customer not found");
      adminService.listInvoices.mockRejectedValue(error);

      await expect(controller.listInvoices(req, mockReply, {}, undefined)).rejects.toThrow(error);
    });
  });

  describe("GET /stripe-invoices/upcoming", () => {
    it("should get upcoming invoice without subscriptionId", async () => {
      const req = createMockRequest();
      adminService.getUpcomingInvoice.mockResolvedValue(MOCK_UPCOMING_INVOICE_RESPONSE);

      await controller.getUpcomingInvoice(req, mockReply, undefined);

      expect(adminService.getUpcomingInvoice).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
        subscriptionId: undefined,
      });
      expect(mockReply.send).toHaveBeenCalledWith(MOCK_UPCOMING_INVOICE_RESPONSE);
    });

    it("should get upcoming invoice with subscriptionId", async () => {
      const req = createMockRequest();
      adminService.getUpcomingInvoice.mockResolvedValue(MOCK_UPCOMING_INVOICE_RESPONSE);

      await controller.getUpcomingInvoice(req, mockReply, TEST_IDS.subscriptionId);

      expect(adminService.getUpcomingInvoice).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
        subscriptionId: TEST_IDS.subscriptionId,
      });
      expect(mockReply.send).toHaveBeenCalledWith(MOCK_UPCOMING_INVOICE_RESPONSE);
    });

    it("should extract subscriptionId from query params", async () => {
      const req = createMockRequest();
      const customSubscriptionId = "sub_custom_456";
      adminService.getUpcomingInvoice.mockResolvedValue(MOCK_UPCOMING_INVOICE_RESPONSE);

      await controller.getUpcomingInvoice(req, mockReply, customSubscriptionId);

      expect(adminService.getUpcomingInvoice).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
        subscriptionId: customSubscriptionId,
      });
    });

    it("should handle service errors", async () => {
      const req = createMockRequest();
      const error = new Error("Stripe customer not found");
      adminService.getUpcomingInvoice.mockRejectedValue(error);

      await expect(controller.getUpcomingInvoice(req, mockReply, undefined)).rejects.toThrow(error);
    });
  });

  describe("GET /stripe-invoices/:invoiceId", () => {
    it("should get invoice by id successfully", async () => {
      const req = createMockRequest();
      adminService.getInvoice.mockResolvedValue(MOCK_INVOICE_RESPONSE);

      await controller.getInvoice(req, mockReply, TEST_IDS.invoiceId);

      expect(adminService.getInvoice).toHaveBeenCalledWith({
        id: TEST_IDS.invoiceId,
        companyId: TEST_IDS.companyId,
      });
      expect(mockReply.send).toHaveBeenCalledWith(MOCK_INVOICE_RESPONSE);
    });

    it("should extract invoiceId from path params", async () => {
      const req = createMockRequest();
      const customInvoiceId = "invoice_custom_789";
      adminService.getInvoice.mockResolvedValue(MOCK_INVOICE_RESPONSE);

      await controller.getInvoice(req, mockReply, customInvoiceId);

      expect(adminService.getInvoice).toHaveBeenCalledWith({
        id: customInvoiceId,
        companyId: TEST_IDS.companyId,
      });
    });

    it("should handle invoice not found error", async () => {
      const req = createMockRequest();
      const error = new Error("Invoice not found");
      adminService.getInvoice.mockRejectedValue(error);

      await expect(controller.getInvoice(req, mockReply, TEST_IDS.invoiceId)).rejects.toThrow(error);
    });

    it("should handle forbidden access error", async () => {
      const req = createMockRequest();
      const error = new Error("Invoice does not belong to this company");
      adminService.getInvoice.mockRejectedValue(error);

      await expect(controller.getInvoice(req, mockReply, TEST_IDS.invoiceId)).rejects.toThrow(error);
    });
  });
});
