import { vi } from "vitest";
/**
 * Comprehensive Stripe SDK mock for testing
 *
 * This mock provides vi.fn() implementations for all Stripe SDK methods
 * used across the Stripe services in this module.
 */

export const createMockStripeClient = () => ({
  // Customer methods
  customers: {
    create: vi.fn(),
    retrieve: vi.fn(),
    update: vi.fn(),
    del: vi.fn(),
    list: vi.fn(),
  },

  // Subscription methods
  subscriptions: {
    create: vi.fn(),
    retrieve: vi.fn(),
    update: vi.fn(),
    cancel: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    list: vi.fn(),
  },

  // Product methods
  products: {
    create: vi.fn(),
    retrieve: vi.fn(),
    update: vi.fn(),
    list: vi.fn(),
  },

  // Price methods
  prices: {
    create: vi.fn(),
    retrieve: vi.fn(),
    update: vi.fn(),
    list: vi.fn(),
  },

  // Payment Intent methods
  paymentIntents: {
    create: vi.fn(),
    retrieve: vi.fn(),
    confirm: vi.fn(),
    cancel: vi.fn(),
  },

  // Setup Intent methods
  setupIntents: {
    create: vi.fn(),
    retrieve: vi.fn(),
  },

  // Payment Method methods
  paymentMethods: {
    retrieve: vi.fn(),
    list: vi.fn(),
    attach: vi.fn(),
    detach: vi.fn(),
  },

  // Invoice methods
  invoices: {
    retrieve: vi.fn(),
    list: vi.fn(),
    pay: vi.fn(),
    voidInvoice: vi.fn(),
    retrieveUpcoming: vi.fn(),
    createPreview: vi.fn(),
  },

  // Billing Portal methods
  billingPortal: {
    sessions: {
      create: vi.fn(),
    },
  },

  // Webhook methods
  webhooks: {
    constructEvent: vi.fn(),
  },

  // Billing Meters (v2 API) methods
  v2: {
    billing: {
      meterEvents: {
        create: vi.fn(),
      },
      meterEventSummaries: {
        list: vi.fn(),
      },
    },
  },

  // Billing Meters (v1 API) methods
  billing: {
    meters: {
      list: vi.fn(),
      retrieve: vi.fn(),
      listEventSummaries: vi.fn(),
    },
  },

  // Coupon methods
  coupons: {
    create: vi.fn(),
    retrieve: vi.fn(),
    update: vi.fn(),
    del: vi.fn(),
    list: vi.fn(),
  },

  // Promotion code methods
  promotionCodes: {
    create: vi.fn(),
    retrieve: vi.fn(),
    update: vi.fn(),
    list: vi.fn(),
  },

  // Refund methods
  refunds: {
    create: vi.fn(),
    retrieve: vi.fn(),
    update: vi.fn(),
    list: vi.fn(),
    cancel: vi.fn(),
  },

  // Tax Rate methods
  taxRates: {
    create: vi.fn(),
    retrieve: vi.fn(),
    update: vi.fn(),
    list: vi.fn(),
  },

  // Tax Calculation methods (Tax v2 API)
  tax: {
    calculations: {
      create: vi.fn(),
    },
  },

  // Dispute methods
  disputes: {
    retrieve: vi.fn(),
    update: vi.fn(),
    close: vi.fn(),
    list: vi.fn(),
  },
});

/**
 * Type helper for the mocked Stripe client
 */
export type MockStripeClient = ReturnType<typeof createMockStripeClient>;
