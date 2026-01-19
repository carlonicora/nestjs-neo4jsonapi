/**
 * Test fixtures for Stripe objects
 *
 * These fixtures provide realistic Stripe API response shapes for testing.
 * All IDs use Stripe's test mode prefixes (cus_test, sub_test, etc.)
 */

import Stripe from "stripe";

// Test IDs
// Internal IDs use UUID v4 format, Stripe external IDs use Stripe's test prefixes
export const TEST_IDS = {
  customerId: "cus_test_12345678", // Stripe external ID
  companyId: "660e8400-e29b-41d4-a716-446655440001", // Internal UUID
  subscriptionId: "sub_test_12345678", // Stripe external ID
  productId: "prod_test_12345678", // Stripe external ID
  priceId: "price_test_12345678", // Stripe external ID
  paymentIntentId: "pi_test_12345678", // Stripe external ID
  paymentMethodId: "pm_test_12345678", // Stripe external ID
  setupIntentId: "seti_test_12345678", // Stripe external ID
  invoiceId: "in_test_12345678", // Stripe external ID
  couponId: "coupon_test_12345678", // Stripe external ID
  refundId: "re_test_12345678", // Stripe external ID
  taxRateId: "txr_test_12345678", // Stripe external ID
  disputeId: "dp_test_12345678", // Stripe external ID
  meterId: "meter_test_12345678", // Stripe external ID
};

// Mock Customer
export const MOCK_CUSTOMER: Stripe.Customer = {
  id: TEST_IDS.customerId,
  object: "customer",
  address: null,
  balance: 0,
  created: Math.floor(Date.now() / 1000),
  currency: "usd",
  default_source: null,
  delinquent: false,
  description: "Test customer",
  discount: null,
  email: "test@example.com",
  invoice_prefix: "INV",
  invoice_settings: {
    custom_fields: null,
    default_payment_method: null,
    footer: null,
    rendering_options: null,
  },
  livemode: false,
  metadata: {
    companyId: TEST_IDS.companyId,
  },
  name: "Test Customer",
  phone: null,
  preferred_locales: [],
  shipping: null,
  tax_exempt: "none",
  test_clock: null,
};

// Mock Deleted Customer
export const MOCK_DELETED_CUSTOMER: Stripe.DeletedCustomer = {
  id: TEST_IDS.customerId,
  object: "customer",
  deleted: true,
};

// Mock Payment Method
export const MOCK_PAYMENT_METHOD: Stripe.PaymentMethod = {
  id: TEST_IDS.paymentMethodId,
  object: "payment_method",
  allow_redisplay: "unspecified",
  billing_details: {
    address: null,
    email: "test@example.com",
    name: "Test Customer",
    phone: null,
    tax_id: null,
  },
  card: {
    brand: "visa",
    checks: {
      address_line1_check: null,
      address_postal_code_check: null,
      cvc_check: "pass",
    },
    country: "US",
    display_brand: null,
    exp_month: 12,
    exp_year: 2025,
    fingerprint: "test_fingerprint",
    funding: "credit",
    generated_from: null,
    last4: "4242",
    networks: {
      available: ["visa"],
      preferred: null,
    },
    three_d_secure_usage: {
      supported: true,
    },
    wallet: null,
    regulated_status: null,
  },
  created: Math.floor(Date.now() / 1000),
  customer: TEST_IDS.customerId,
  customer_account: null,
  livemode: false,
  metadata: {},
  type: "card",
};

// Mock Product
export const MOCK_PRODUCT: Stripe.Product = {
  id: TEST_IDS.productId,
  object: "product",
  active: true,
  created: Math.floor(Date.now() / 1000),
  default_price: null,
  description: "Test product description",
  images: [],
  livemode: false,
  marketing_features: [],
  metadata: {},
  name: "Test Product",
  package_dimensions: null,
  shippable: null,
  statement_descriptor: null,
  tax_code: null,
  type: "service",
  unit_label: null,
  updated: Math.floor(Date.now() / 1000),
  url: null,
};

// Mock Price (Recurring)
export const MOCK_PRICE_RECURRING: Stripe.Price = {
  id: TEST_IDS.priceId,
  object: "price",
  active: true,
  billing_scheme: "per_unit",
  created: Math.floor(Date.now() / 1000),
  currency: "usd",
  currency_options: null,
  custom_unit_amount: null,
  livemode: false,
  lookup_key: null,
  metadata: {},
  nickname: "Monthly Plan",
  product: TEST_IDS.productId,
  recurring: {
    interval: "month",
    interval_count: 1,
    meter: null,
    trial_period_days: null,
    usage_type: "licensed",
  },
  tax_behavior: "unspecified",
  tiers_mode: null,
  transform_quantity: null,
  type: "recurring",
  unit_amount: 999,
  unit_amount_decimal: "999",
};

// Mock Subscription
export const MOCK_SUBSCRIPTION: Stripe.Subscription = {
  id: TEST_IDS.subscriptionId,
  object: "subscription",
  application: null,
  application_fee_percent: null,
  automatic_tax: {
    enabled: false,
    disabled_reason: null,
    liability: null,
  },
  billing_cycle_anchor: Math.floor(Date.now() / 1000),
  billing_cycle_anchor_config: null,
  billing_mode: null,
  billing_thresholds: null,
  cancel_at: null,
  cancel_at_period_end: false,
  canceled_at: null,
  cancellation_details: {
    comment: null,
    feedback: null,
    reason: null,
  },
  collection_method: "charge_automatically",
  created: Math.floor(Date.now() / 1000),
  currency: "usd",
  customer: TEST_IDS.customerId,
  customer_account: null,
  days_until_due: null,
  default_payment_method: TEST_IDS.paymentMethodId,
  default_source: null,
  default_tax_rates: [],
  description: null,
  discounts: [],
  ended_at: null,
  invoice_settings: {
    account_tax_ids: null,
    issuer: {
      type: "self",
    },
  },
  items: {
    object: "list",
    data: [
      {
        id: "si_test_123",
        object: "subscription_item",
        billing_thresholds: null,
        created: Math.floor(Date.now() / 1000),
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
        current_period_start: Math.floor(Date.now() / 1000),
        discounts: [],
        metadata: {},
        plan: null,
        price: MOCK_PRICE_RECURRING,
        quantity: 1,
        subscription: TEST_IDS.subscriptionId,
        tax_rates: [],
      },
    ],
    has_more: false,
    url: "/v1/subscription_items",
  },
  latest_invoice: null,
  livemode: false,
  metadata: {
    companyId: TEST_IDS.companyId,
  },
  next_pending_invoice_item_invoice: null,
  on_behalf_of: null,
  pause_collection: null,
  payment_settings: {
    payment_method_options: null,
    payment_method_types: null,
    save_default_payment_method: "off",
  },
  pending_invoice_item_interval: null,
  pending_setup_intent: null,
  pending_update: null,
  schedule: null,
  start_date: Math.floor(Date.now() / 1000),
  status: "active",
  test_clock: null,
  transfer_data: null,
  trial_end: null,
  trial_settings: {
    end_behavior: {
      missing_payment_method: "create_invoice",
    },
  },
  trial_start: null,
};

// Mock Payment Intent
export const MOCK_PAYMENT_INTENT: Stripe.PaymentIntent = {
  id: TEST_IDS.paymentIntentId,
  object: "payment_intent",
  amount: 1000,
  amount_capturable: 0,
  amount_details: {
    tip: {},
  },
  amount_received: 0,
  application: null,
  application_fee_amount: null,
  automatic_payment_methods: {
    allow_redirects: "always",
    enabled: true,
  },
  canceled_at: null,
  cancellation_reason: null,
  capture_method: "automatic_async",
  client_secret: "pi_test_secret_123",
  confirmation_method: "automatic",
  created: Math.floor(Date.now() / 1000),
  currency: "usd",
  customer: TEST_IDS.customerId,
  customer_account: null,
  description: "Test payment",
  excluded_payment_method_types: [],
  last_payment_error: null,
  latest_charge: null,
  livemode: false,
  metadata: {},
  next_action: null,
  on_behalf_of: null,
  payment_method: null,
  payment_method_configuration_details: null,
  payment_method_options: {},
  payment_method_types: ["card"],
  processing: null,
  receipt_email: null,
  review: null,
  setup_future_usage: null,
  shipping: null,
  source: null,
  statement_descriptor: null,
  statement_descriptor_suffix: null,
  status: "requires_payment_method",
  transfer_data: null,
  transfer_group: null,
};

// Mock Setup Intent
export const MOCK_SETUP_INTENT: Stripe.SetupIntent = {
  id: TEST_IDS.setupIntentId,
  object: "setup_intent",
  application: null,
  attach_to_self: false,
  automatic_payment_methods: null,
  cancellation_reason: null,
  client_secret: "seti_test_secret_123",
  created: Math.floor(Date.now() / 1000),
  customer: TEST_IDS.customerId,
  description: null,
  excluded_payment_method_types: [],
  flow_directions: null,
  last_setup_error: null,
  latest_attempt: null,
  livemode: false,
  mandate: null,
  metadata: {},
  next_action: null,
  on_behalf_of: null,
  payment_method: null,
  payment_method_configuration_details: null,
  payment_method_options: {},
  payment_method_types: ["card"],
  single_use_mandate: null,
  status: "requires_payment_method",
  usage: "off_session",
};

// Mock Invoice
export const MOCK_INVOICE: Stripe.Invoice = {
  id: TEST_IDS.invoiceId,
  object: "invoice",
  account_country: "US",
  account_name: "Test Account",
  account_tax_ids: null,
  amount_due: 999,
  amount_overpaid: null,
  amount_paid: 0,
  amount_remaining: 999,
  amount_shipping: 0,
  application: null,
  attempt_count: 0,
  attempted: false,
  auto_advance: true,
  automatically_finalizes_at: null,
  automatic_tax: {
    enabled: false,
    disabled_reason: null,
    liability: null,
    provider: null,
    status: null,
  },
  billing_reason: "subscription_create",
  collection_method: "charge_automatically",
  created: Math.floor(Date.now() / 1000),
  currency: "usd",
  custom_fields: null,
  customer: TEST_IDS.customerId,
  customer_account: null,
  customer_address: null,
  customer_email: "test@example.com",
  customer_name: "Test Customer",
  customer_phone: null,
  customer_shipping: null,
  customer_tax_exempt: "none",
  customer_tax_ids: [],
  default_payment_method: null,
  default_source: null,
  default_tax_rates: [],
  description: null,
  discounts: [],
  due_date: null,
  effective_at: null,
  ending_balance: 0,
  footer: null,
  from_invoice: null,
  hosted_invoice_url: null,
  invoice_pdf: null,
  issuer: {
    type: "self",
  },
  last_finalization_error: null,
  latest_revision: null,
  lines: {
    object: "list",
    data: [],
    has_more: false,
    url: "/v1/invoices/in_test_123/lines",
  },
  livemode: false,
  metadata: {},
  next_payment_attempt: null,
  number: null,
  on_behalf_of: null,
  parent: null,
  payment_settings: {
    default_mandate: null,
    payment_method_options: null,
    payment_method_types: null,
  },
  period_end: Math.floor(Date.now() / 1000),
  period_start: Math.floor(Date.now() / 1000),
  post_payment_credit_notes_amount: 0,
  pre_payment_credit_notes_amount: 0,
  receipt_number: null,
  rendering: null,
  shipping_cost: null,
  shipping_details: null,
  starting_balance: 0,
  statement_descriptor: null,
  status: "draft",
  status_transitions: {
    finalized_at: null,
    marked_uncollectible_at: null,
    paid_at: null,
    voided_at: null,
  },
  subtotal: 999,
  subtotal_excluding_tax: null,
  test_clock: null,
  total: 999,
  total_discount_amounts: [],
  total_excluding_tax: null,
  total_pretax_credit_amounts: [],
  total_taxes: [],
  webhooks_delivered_at: null,
};

// Mock Webhook Event
export const MOCK_WEBHOOK_EVENT: Stripe.Event = {
  id: "evt_test_12345678",
  object: "event",
  api_version: "2024-11-20.acacia",
  created: Math.floor(Date.now() / 1000),
  data: {
    object: MOCK_SUBSCRIPTION,
    previous_attributes: undefined,
  },
  livemode: false,
  pending_webhooks: 1,
  request: {
    id: "req_test_123",
    idempotency_key: "test_key",
  },
  type: "customer.subscription.created",
};

// Mock Coupon
export const MOCK_COUPON: Stripe.Coupon = {
  id: TEST_IDS.couponId,
  object: "coupon",
  amount_off: null,
  applies_to: {
    products: [],
  },
  created: Math.floor(Date.now() / 1000),
  currency: "usd",
  currency_options: null,
  duration: "repeating",
  duration_in_months: 3,
  livemode: false,
  max_redemptions: null,
  metadata: {},
  name: "Test Coupon",
  percent_off: 20,
  redeem_by: null,
  times_redeemed: 0,
  valid: true,
};

// Mock Refund
export const MOCK_REFUND: Stripe.Refund = {
  id: TEST_IDS.refundId,
  object: "refund",
  amount: 1000,
  balance_transaction: null,
  charge: "ch_test_123",
  created: Math.floor(Date.now() / 1000),
  currency: "usd",
  destination_details: {
    card: {
      reference: null,
      reference_status: null,
      reference_type: null,
      type: "refund",
    },
    type: "card",
  },
  metadata: {},
  payment_intent: TEST_IDS.paymentIntentId,
  reason: null,
  receipt_number: null,
  source_transfer_reversal: null,
  status: "succeeded",
  transfer_reversal: null,
};

// Mock Tax Rate
export const MOCK_TAX_RATE: Stripe.TaxRate = {
  id: TEST_IDS.taxRateId,
  object: "tax_rate",
  active: true,
  country: "US",
  created: Math.floor(Date.now() / 1000),
  description: "Sales Tax",
  display_name: "Sales Tax",
  effective_percentage: null,
  flat_amount: null,
  inclusive: false,
  jurisdiction: "US",
  jurisdiction_level: null,
  livemode: false,
  metadata: {},
  percentage: 8.25,
  rate_type: null,
  state: "CA",
  tax_type: "sales_tax",
};

// Mock Dispute
export const MOCK_DISPUTE: Stripe.Dispute = {
  id: TEST_IDS.disputeId,
  object: "dispute",
  amount: 1000,
  balance_transactions: [],
  charge: "ch_test_123",
  created: Math.floor(Date.now() / 1000),
  currency: "usd",
  enhanced_eligibility_types: [],
  evidence: {
    access_activity_log: null,
    billing_address: null,
    cancellation_policy: null,
    cancellation_policy_disclosure: null,
    cancellation_rebuttal: null,
    customer_communication: null,
    customer_email_address: null,
    customer_name: null,
    customer_purchase_ip: null,
    customer_signature: null,
    duplicate_charge_documentation: null,
    duplicate_charge_explanation: null,
    duplicate_charge_id: null,
    enhanced_evidence: {
      visa_compelling_evidence_3: {
        disputed_transaction: null,
        prior_undisputed_transactions: null,
      },
    },
    product_description: null,
    receipt: null,
    refund_policy: null,
    refund_policy_disclosure: null,
    refund_refusal_explanation: null,
    service_date: null,
    service_documentation: null,
    shipping_address: null,
    shipping_carrier: null,
    shipping_date: null,
    shipping_documentation: null,
    shipping_tracking_number: null,
    uncategorized_file: null,
    uncategorized_text: null,
  },
  evidence_details: {
    due_by: Math.floor(Date.now() / 1000) + 14 * 24 * 60 * 60,
    enhanced_eligibility: null,
    has_evidence: false,
    past_due: false,
    submission_count: 0,
  },
  is_charge_refundable: true,
  livemode: false,
  metadata: {},
  network_reason_code: null,
  payment_intent: TEST_IDS.paymentIntentId,
  payment_method_details: {
    card: {
      brand: null,
      case_type: null,
      network_reason_code: null,
    },
    type: "card",
  },
  reason: "general",
  status: "needs_response",
};

// Mock Billing Portal Session
export const MOCK_PORTAL_SESSION: Stripe.BillingPortal.Session = {
  id: "bps_test_12345678",
  object: "billing_portal.session",
  configuration: "bpc_test_12345678",
  created: Math.floor(Date.now() / 1000),
  customer: TEST_IDS.customerId,
  customer_account: null,
  flow: null,
  livemode: false,
  locale: null,
  on_behalf_of: null,
  return_url: "https://example.com/billing",
  url: "https://billing.stripe.com/session/test_12345678",
};

// Mock Invoice Event
export const MOCK_INVOICE_EVENT: Stripe.Event = {
  id: "evt_invoice_test_12345678",
  object: "event",
  api_version: "2024-11-20.acacia",
  created: Math.floor(Date.now() / 1000),
  data: {
    object: MOCK_INVOICE,
    previous_attributes: undefined,
  },
  livemode: false,
  pending_webhooks: 1,
  request: {
    id: "req_test_123",
    idempotency_key: "test_key",
  },
  type: "invoice.payment_succeeded",
};

// Mock Payment Intent Event
export const MOCK_PAYMENT_EVENT: Stripe.Event = {
  id: "evt_payment_test_12345678",
  object: "event",
  api_version: "2024-11-20.acacia",
  created: Math.floor(Date.now() / 1000),
  data: {
    object: MOCK_PAYMENT_INTENT,
    previous_attributes: undefined,
  },
  livemode: false,
  pending_webhooks: 1,
  request: {
    id: "req_test_123",
    idempotency_key: "test_key",
  },
  type: "payment_intent.succeeded",
};

// Mock Customer Event
export const MOCK_CUSTOMER_EVENT: Stripe.Event = {
  id: "evt_customer_test_12345678",
  object: "event",
  api_version: "2024-11-20.acacia",
  created: Math.floor(Date.now() / 1000),
  data: {
    object: MOCK_CUSTOMER,
    previous_attributes: undefined,
  },
  livemode: false,
  pending_webhooks: 1,
  request: {
    id: "req_test_123",
    idempotency_key: "test_key",
  },
  type: "customer.updated",
};

// Stripe Error Fixtures
export const STRIPE_CARD_ERROR = {
  type: "StripeCardError",
  message: "Your card was declined",
  code: "card_declined",
  decline_code: "insufficient_funds",
  param: "card",
};

export const STRIPE_RATE_LIMIT_ERROR = {
  type: "StripeRateLimitError",
  message: "Too many requests",
  code: "rate_limit",
};

export const STRIPE_INVALID_REQUEST_ERROR = {
  type: "StripeInvalidRequestError",
  message: "Invalid request",
  code: "parameter_invalid_empty",
  param: "email",
};

export const STRIPE_API_ERROR = {
  type: "StripeAPIError",
  message: "An error occurred with our API",
  code: "api_error",
};

export const STRIPE_CONNECTION_ERROR = {
  type: "StripeConnectionError",
  message: "Could not connect to Stripe",
  code: "connection_error",
};

export const STRIPE_AUTHENTICATION_ERROR = {
  type: "StripeAuthenticationError",
  message: "Invalid API key",
  code: "invalid_api_key",
};

export const STRIPE_IDEMPOTENCY_ERROR = {
  type: "StripeIdempotencyError",
  message: "Duplicate request detected",
  code: "idempotency_error",
};
