/**
 * Comprehensive Stripe SDK mock for testing
 *
 * This mock provides jest.fn() implementations for all Stripe SDK methods
 * used across the Stripe services in this module.
 */

export const createMockStripeClient = () => ({
  // Customer methods
  customers: {
    create: jest.fn(),
    retrieve: jest.fn(),
    update: jest.fn(),
    del: jest.fn(),
    list: jest.fn(),
  },

  // Subscription methods
  subscriptions: {
    create: jest.fn(),
    retrieve: jest.fn(),
    update: jest.fn(),
    cancel: jest.fn(),
    pause: jest.fn(),
    resume: jest.fn(),
    list: jest.fn(),
  },

  // Product methods
  products: {
    create: jest.fn(),
    retrieve: jest.fn(),
    update: jest.fn(),
    list: jest.fn(),
  },

  // Price methods
  prices: {
    create: jest.fn(),
    retrieve: jest.fn(),
    update: jest.fn(),
    list: jest.fn(),
  },

  // Payment Intent methods
  paymentIntents: {
    create: jest.fn(),
    retrieve: jest.fn(),
    confirm: jest.fn(),
    cancel: jest.fn(),
  },

  // Setup Intent methods
  setupIntents: {
    create: jest.fn(),
    retrieve: jest.fn(),
  },

  // Payment Method methods
  paymentMethods: {
    retrieve: jest.fn(),
    list: jest.fn(),
    attach: jest.fn(),
    detach: jest.fn(),
  },

  // Invoice methods
  invoices: {
    retrieve: jest.fn(),
    list: jest.fn(),
    pay: jest.fn(),
    voidInvoice: jest.fn(),
    retrieveUpcoming: jest.fn(),
    createPreview: jest.fn(),
  },

  // Billing Portal methods
  billingPortal: {
    sessions: {
      create: jest.fn(),
    },
  },

  // Webhook methods
  webhooks: {
    constructEvent: jest.fn(),
  },

  // Billing Meters (v2 API) methods
  v2: {
    billing: {
      meterEvents: {
        create: jest.fn(),
      },
      meterEventSummaries: {
        list: jest.fn(),
      },
    },
  },

  // Billing Meters (v1 API) methods
  billing: {
    meters: {
      list: jest.fn(),
      retrieve: jest.fn(),
      listEventSummaries: jest.fn(),
    },
  },

  // Coupon methods
  coupons: {
    create: jest.fn(),
    retrieve: jest.fn(),
    update: jest.fn(),
    del: jest.fn(),
    list: jest.fn(),
  },

  // Refund methods
  refunds: {
    create: jest.fn(),
    retrieve: jest.fn(),
    update: jest.fn(),
    list: jest.fn(),
    cancel: jest.fn(),
  },

  // Tax Rate methods
  taxRates: {
    create: jest.fn(),
    retrieve: jest.fn(),
    update: jest.fn(),
    list: jest.fn(),
  },

  // Tax Calculation methods (Tax v2 API)
  tax: {
    calculations: {
      create: jest.fn(),
    },
  },

  // Dispute methods
  disputes: {
    retrieve: jest.fn(),
    update: jest.fn(),
    close: jest.fn(),
    list: jest.fn(),
  },
});

/**
 * Type helper for the mocked Stripe client
 */
export type MockStripeClient = ReturnType<typeof createMockStripeClient>;
