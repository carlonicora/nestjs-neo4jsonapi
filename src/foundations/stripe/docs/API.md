# Stripe Module API Reference

Complete API documentation for all Stripe services.

## Table of Contents

- [StripeService](#stripeservice)
- [StripeCustomerService](#stripecustomerservice)
- [StripeSubscriptionService](#stripesubscriptionservice)
- [StripeProductService](#stripeproductservice)
- [StripePaymentService](#stripepaymentservice)
- [StripeInvoiceService](#stripeinvoiceservice)
- [StripeUsageService](#stripeusageservice)
- [StripePortalService](#stripeportalservice)
- [StripeWebhookService](#stripewebhookservice)
- [Error Handling](#error-handling)

---

## StripeService

Core service for Stripe SDK initialization and configuration.

### getClient()

Get the initialized Stripe client instance.

**Returns:** `Stripe`

**Throws:** `Error` if Stripe is not initialized

**Example:**
```typescript
const stripe = this.stripeService.getClient();
const customer = await stripe.customers.retrieve('cus_123');
```

### isConfigured()

Check if Stripe SDK is initialized and configured.

**Returns:** `boolean`

**Example:**
```typescript
if (this.stripeService.isConfigured()) {
  // Stripe operations available
}
```

### getPublishableKey()

Get the Stripe publishable key for frontend use.

**Returns:** `string`

**Throws:** `Error` if configuration is not available

**Example:**
```typescript
const publishableKey = this.stripeService.getPublishableKey();
// Send to frontend for Stripe.js initialization
```

### getWebhookSecret()

Get the webhook signing secret for webhook verification.

**Returns:** `string`

**Throws:** `Error` if configuration is not available

**Example:**
```typescript
const webhookSecret = this.stripeService.getWebhookSecret();
```

### getPortalReturnUrl()

Get the customer portal return URL.

**Returns:** `string`

**Throws:** `Error` if configuration is not available

**Example:**
```typescript
const returnUrl = this.stripeService.getPortalReturnUrl();
```

### getPortalConfigurationId()

Get the customer portal configuration ID (if configured).

**Returns:** `string | undefined`

**Example:**
```typescript
const configId = this.stripeService.getPortalConfigurationId();
```

---

## StripeCustomerService

Customer and payment method management.

### createCustomer()

Create a new Stripe customer.

**Parameters:**
```typescript
{
  companyId: string;        // Internal company ID (stored in metadata)
  email: string;            // Customer email
  name?: string;            // Customer name
  phone?: string;           // Customer phone
  description?: string;     // Customer description
  metadata?: Record<string, string>;  // Additional metadata
}
```

**Returns:** `Promise<Stripe.Customer>`

**Example:**
```typescript
const customer = await this.stripeCustomer.createCustomer({
  companyId: 'company_123',
  email: 'user@example.com',
  name: 'John Doe',
  metadata: { source: 'web_signup' },
});
```

### retrieveCustomer()

Retrieve customer details by ID.

**Parameters:**
- `customerId: string` - Stripe customer ID

**Returns:** `Promise<Stripe.Customer>`

**Example:**
```typescript
const customer = await this.stripeCustomer.retrieveCustomer('cus_123');
```

### updateCustomer()

Update customer information.

**Parameters:**
```typescript
{
  stripeCustomerId: string;  // Customer ID to update
  email?: string;            // New email
  name?: string;             // New name
  phone?: string;            // New phone
  description?: string;      // New description
  metadata?: Record<string, string>;  // Metadata to update
}
```

**Returns:** `Promise<Stripe.Customer>`

**Example:**
```typescript
const updated = await this.stripeCustomer.updateCustomer({
  stripeCustomerId: 'cus_123',
  name: 'Jane Doe',
  metadata: { plan: 'premium' },
});
```

### deleteCustomer()

Delete a customer.

**Parameters:**
- `customerId: string` - Customer ID to delete

**Returns:** `Promise<Stripe.DeletedCustomer>`

**Example:**
```typescript
await this.stripeCustomer.deleteCustomer('cus_123');
```

### listCustomers()

List customers with optional email filter.

**Parameters:**
- `email?: string` - Filter by email (optional)

**Returns:** `Promise<Stripe.Customer[]>`

**Example:**
```typescript
const customers = await this.stripeCustomer.listCustomers('user@example.com');
```

### attachPaymentMethod()

Attach a payment method to a customer.

**Parameters:**
```typescript
{
  stripeCustomerId: string;   // Customer ID
  paymentMethodId: string;    // Payment method ID
  setAsDefault?: boolean;     // Set as default payment method
}
```

**Returns:** `Promise<Stripe.PaymentMethod>`

**Example:**
```typescript
await this.stripeCustomer.attachPaymentMethod({
  stripeCustomerId: 'cus_123',
  paymentMethodId: 'pm_123',
  setAsDefault: true,
});
```

### detachPaymentMethod()

Remove a payment method from a customer.

**Parameters:**
- `paymentMethodId: string` - Payment method ID to detach

**Returns:** `Promise<Stripe.PaymentMethod>`

**Example:**
```typescript
await this.stripeCustomer.detachPaymentMethod('pm_123');
```

### listPaymentMethods()

List all payment methods for a customer.

**Parameters:**
- `customerId: string` - Customer ID

**Returns:** `Promise<Stripe.PaymentMethod[]>`

**Example:**
```typescript
const methods = await this.stripeCustomer.listPaymentMethods('cus_123');
```

### setDefaultPaymentMethod()

Set a payment method as the customer's default.

**Parameters:**
```typescript
{
  stripeCustomerId: string;   // Customer ID
  paymentMethodId: string;    // Payment method ID
}
```

**Returns:** `Promise<Stripe.Customer>`

**Example:**
```typescript
await this.stripeCustomer.setDefaultPaymentMethod({
  stripeCustomerId: 'cus_123',
  paymentMethodId: 'pm_456',
});
```

---

## StripeSubscriptionService

Complete subscription lifecycle management.

### createSubscription()

Create a new subscription for a customer.

**Parameters:**
```typescript
{
  stripeCustomerId: string;   // Customer ID
  priceId: string;            // Price ID to subscribe to
  paymentMethodId?: string;   // Payment method ID (optional if customer has default)
  trialPeriodDays?: number;   // Trial period in days
  metadata?: Record<string, string>;  // Subscription metadata
}
```

**Returns:** `Promise<Stripe.Subscription>`

**Example:**
```typescript
const subscription = await this.stripeSubscription.createSubscription({
  stripeCustomerId: 'cus_123',
  priceId: 'price_123',
  trialPeriodDays: 14,
  metadata: { plan: 'pro' },
});
```

### retrieveSubscription()

Get subscription details.

**Parameters:**
- `subscriptionId: string` - Subscription ID

**Returns:** `Promise<Stripe.Subscription>`

**Example:**
```typescript
const subscription = await this.stripeSubscription.retrieveSubscription('sub_123');
```

### updateSubscription()

Update a subscription (change plan, metadata, proration).

**Parameters:**
```typescript
{
  subscriptionId: string;     // Subscription ID
  priceId?: string;           // New price ID
  prorationBehavior?: 'create_prorations' | 'none' | 'always_invoice';
  metadata?: Record<string, string>;  // Updated metadata
}
```

**Returns:** `Promise<Stripe.Subscription>`

**Example:**
```typescript
const updated = await this.stripeSubscription.updateSubscription({
  subscriptionId: 'sub_123',
  priceId: 'price_456',
  prorationBehavior: 'create_prorations',
});
```

### cancelSubscription()

Cancel a subscription.

**Parameters:**
- `subscriptionId: string` - Subscription ID
- `cancelAtPeriodEnd?: boolean` - Cancel at period end (default: true) or immediately

**Returns:** `Promise<Stripe.Subscription>`

**Example:**
```typescript
// Cancel at end of billing period
await this.stripeSubscription.cancelSubscription('sub_123', true);

// Cancel immediately
await this.stripeSubscription.cancelSubscription('sub_123', false);
```

### pauseSubscription()

Pause a subscription.

**Parameters:**
- `subscriptionId: string` - Subscription ID
- `resumeAt?: Date` - Optional date to automatically resume

**Returns:** `Promise<Stripe.Subscription>`

**Example:**
```typescript
const resumeDate = new Date();
resumeDate.setMonth(resumeDate.getMonth() + 1);

await this.stripeSubscription.pauseSubscription('sub_123', resumeDate);
```

### resumeSubscription()

Resume a paused subscription.

**Parameters:**
- `subscriptionId: string` - Subscription ID

**Returns:** `Promise<Stripe.Subscription>`

**Example:**
```typescript
await this.stripeSubscription.resumeSubscription('sub_123');
```

### previewProration()

Preview proration amount for a subscription change.

**Parameters:**
- `subscriptionId: string` - Subscription ID
- `newPriceId: string` - New price ID to preview

**Returns:** `Promise<Stripe.UpcomingInvoice>`

**Example:**
```typescript
const preview = await this.stripeSubscription.previewProration('sub_123', 'price_456');
console.log('Proration amount:', preview.amount_due);
```

### listSubscriptions()

List subscriptions for a customer.

**Parameters:**
- `customerId: string` - Customer ID
- `status?: 'active' | 'canceled' | 'incomplete' | 'past_due' | 'trialing' | 'all'` - Filter by status

**Returns:** `Promise<Stripe.Subscription[]>`

**Example:**
```typescript
const activeSubscriptions = await this.stripeSubscription.listSubscriptions('cus_123', 'active');
```

---

## StripeProductService

Product and pricing management.

### createProduct()

Create a new product.

**Parameters:**
```typescript
{
  name: string;               // Product name
  description?: string;       // Product description
  metadata?: Record<string, string>;  // Product metadata
}
```

**Returns:** `Promise<Stripe.Product>`

**Example:**
```typescript
const product = await this.stripeProduct.createProduct({
  name: 'Pro Plan',
  description: 'Professional tier with advanced features',
  metadata: { tier: 'pro' },
});
```

### retrieveProduct()

Get product details.

**Parameters:**
- `productId: string` - Product ID

**Returns:** `Promise<Stripe.Product>`

**Example:**
```typescript
const product = await this.stripeProduct.retrieveProduct('prod_123');
```

### updateProduct()

Update product information.

**Parameters:**
```typescript
{
  productId: string;          // Product ID
  name?: string;              // New name
  description?: string;       // New description
  active?: boolean;           // Active status
  metadata?: Record<string, string>;  // Updated metadata
}
```

**Returns:** `Promise<Stripe.Product>`

**Example:**
```typescript
const updated = await this.stripeProduct.updateProduct({
  productId: 'prod_123',
  name: 'Premium Plan',
  active: true,
});
```

### archiveProduct()

Archive (deactivate) a product.

**Parameters:**
- `productId: string` - Product ID

**Returns:** `Promise<Stripe.Product>`

**Example:**
```typescript
await this.stripeProduct.archiveProduct('prod_123');
```

### listProducts()

List all products.

**Parameters:**
- `active?: boolean` - Filter by active status

**Returns:** `Promise<Stripe.Product[]>`

**Example:**
```typescript
const activeProducts = await this.stripeProduct.listProducts(true);
```

### createPrice()

Create a price for a product.

**Parameters:**
```typescript
{
  productId: string;          // Product ID
  unitAmount: number;         // Price in cents (e.g., 999 = $9.99)
  currency: string;           // Currency code (e.g., 'usd')
  nickname?: string;          // Price nickname
  lookupKey?: string;         // Lookup key for easy reference
  recurring?: {               // For recurring prices
    interval: 'day' | 'week' | 'month' | 'year';
    intervalCount?: number;   // Billing frequency (e.g., 2 = every 2 months)
    meter?: string;           // Billing meter ID for usage-based pricing
  };
  metadata?: Record<string, string>;  // Price metadata
}
```

**Returns:** `Promise<Stripe.Price>`

**Example:**
```typescript
// One-time price
const oneTimePrice = await this.stripeProduct.createPrice({
  productId: 'prod_123',
  unitAmount: 9900,  // $99.00
  currency: 'usd',
  nickname: 'One-time purchase',
});

// Recurring price
const monthlyPrice = await this.stripeProduct.createPrice({
  productId: 'prod_123',
  unitAmount: 999,  // $9.99
  currency: 'usd',
  nickname: 'Monthly subscription',
  recurring: {
    interval: 'month',
  },
});

// Usage-based price
const usagePrice = await this.stripeProduct.createPrice({
  productId: 'prod_123',
  unitAmount: 10,  // $0.10 per unit
  currency: 'usd',
  recurring: {
    interval: 'month',
    meter: 'mtr_123',  // Billing meter ID
  },
});
```

### retrievePrice()

Get price details.

**Parameters:**
- `priceId: string` - Price ID

**Returns:** `Promise<Stripe.Price>`

**Example:**
```typescript
const price = await this.stripeProduct.retrievePrice('price_123');
```

### updatePrice()

Update price metadata and active status.

**Parameters:**
```typescript
{
  priceId: string;            // Price ID
  nickname?: string;          // New nickname
  active?: boolean;           // Active status
  metadata?: Record<string, string>;  // Updated metadata
}
```

**Returns:** `Promise<Stripe.Price>`

**Example:**
```typescript
const updated = await this.stripeProduct.updatePrice({
  priceId: 'price_123',
  active: false,
  metadata: { deprecated: 'true' },
});
```

### listPrices()

List prices with optional filters.

**Parameters:**
```typescript
{
  productId?: string;         // Filter by product
  active?: boolean;           // Filter by active status
}
```

**Returns:** `Promise<Stripe.Price[]>`

**Example:**
```typescript
const prices = await this.stripeProduct.listPrices({ productId: 'prod_123' });
```

---

## StripePaymentService

Payment and setup intent management.

### createPaymentIntent()

Create a payment intent for one-time payments.

**Parameters:**
```typescript
{
  amount: number;             // Amount in cents
  currency: string;           // Currency code
  customerId?: string;        // Customer ID (optional)
  paymentMethodId?: string;   // Payment method ID (optional)
  metadata?: Record<string, string>;  // Payment metadata
}
```

**Returns:** `Promise<Stripe.PaymentIntent>`

**Example:**
```typescript
const paymentIntent = await this.stripePayment.createPaymentIntent({
  amount: 5000,  // $50.00
  currency: 'usd',
  customerId: 'cus_123',
  metadata: { orderId: 'order_456' },
});
```

### retrievePaymentIntent()

Get payment intent details.

**Parameters:**
- `paymentIntentId: string` - Payment intent ID

**Returns:** `Promise<Stripe.PaymentIntent>`

**Example:**
```typescript
const intent = await this.stripePayment.retrievePaymentIntent('pi_123');
```

### confirmPaymentIntent()

Confirm a payment intent.

**Parameters:**
- `paymentIntentId: string` - Payment intent ID

**Returns:** `Promise<Stripe.PaymentIntent>`

**Example:**
```typescript
await this.stripePayment.confirmPaymentIntent('pi_123');
```

### cancelPaymentIntent()

Cancel a payment intent.

**Parameters:**
- `paymentIntentId: string` - Payment intent ID

**Returns:** `Promise<Stripe.PaymentIntent>`

**Example:**
```typescript
await this.stripePayment.cancelPaymentIntent('pi_123');
```

### createSetupIntent()

Create a setup intent for saving payment methods without charging.

**Parameters:**
```typescript
{
  customerId: string;         // Customer ID
  paymentMethodId?: string;   // Payment method ID (optional)
  metadata?: Record<string, string>;  // Setup metadata
}
```

**Returns:** `Promise<Stripe.SetupIntent>`

**Example:**
```typescript
const setupIntent = await this.stripePayment.createSetupIntent({
  customerId: 'cus_123',
  metadata: { purpose: 'save_card' },
});
```

### retrieveSetupIntent()

Get setup intent details.

**Parameters:**
- `setupIntentId: string` - Setup intent ID

**Returns:** `Promise<Stripe.SetupIntent>`

**Example:**
```typescript
const intent = await this.stripePayment.retrieveSetupIntent('seti_123');
```

---

## StripeInvoiceService

Invoice generation and management.

### retrieveInvoice()

Get invoice details.

**Parameters:**
- `invoiceId: string` - Invoice ID

**Returns:** `Promise<Stripe.Invoice>`

**Example:**
```typescript
const invoice = await this.stripeInvoice.retrieveInvoice('in_123');
```

### listInvoices()

List invoices for a customer.

**Parameters:**
- `customerId: string` - Customer ID

**Returns:** `Promise<Stripe.Invoice[]>`

**Example:**
```typescript
const invoices = await this.stripeInvoice.listInvoices('cus_123');
```

### payInvoice()

Pay an invoice.

**Parameters:**
- `invoiceId: string` - Invoice ID

**Returns:** `Promise<Stripe.Invoice>`

**Example:**
```typescript
await this.stripeInvoice.payInvoice('in_123');
```

### voidInvoice()

Void an invoice.

**Parameters:**
- `invoiceId: string` - Invoice ID

**Returns:** `Promise<Stripe.Invoice>`

**Example:**
```typescript
await this.stripeInvoice.voidInvoice('in_123');
```

### retrieveUpcomingInvoice()

Preview the next upcoming invoice for a customer.

**Parameters:**
- `customerId: string` - Customer ID

**Returns:** `Promise<Stripe.UpcomingInvoice>`

**Example:**
```typescript
const upcomingInvoice = await this.stripeInvoice.retrieveUpcomingInvoice('cus_123');
console.log('Next charge:', upcomingInvoice.amount_due);
```

---

## StripeUsageService

Usage-based billing with Stripe Billing Meters (v20+).

### reportUsage()

Report a usage event to a billing meter.

**Parameters:**
```typescript
{
  eventName: string;          // Meter event name
  customerId: string;         // Customer ID
  value: number;              // Usage value
  timestamp?: number;         // Unix timestamp (optional, defaults to now)
  idempotencyKey?: string;    // Idempotency key (optional)
}
```

**Returns:** `Promise<Stripe.Billing.MeterEvent>`

**Example:**
```typescript
await this.stripeUsage.reportUsage({
  eventName: 'api_requests',
  customerId: 'cus_123',
  value: 100,  // 100 API requests
  timestamp: Math.floor(Date.now() / 1000),
});
```

### listUsageSummaries()

Get usage summaries for a customer within a time range.

**Parameters:**
```typescript
{
  customerId: string;         // Customer ID
  startTime: number;          // Start timestamp (Unix)
  endTime: number;            // End timestamp (Unix)
}
```

**Returns:** `Promise<Stripe.Billing.MeterEventSummary[]>`

**Example:**
```typescript
const summaries = await this.stripeUsage.listUsageSummaries({
  customerId: 'cus_123',
  startTime: Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60,  // 30 days ago
  endTime: Math.floor(Date.now() / 1000),
});
```

### listBillingMeters()

List all billing meters.

**Returns:** `Promise<Stripe.Billing.Meter[]>`

**Example:**
```typescript
const meters = await this.stripeUsage.listBillingMeters();
```

### retrieveBillingMeter()

Get billing meter details.

**Parameters:**
- `meterId: string` - Meter ID

**Returns:** `Promise<Stripe.Billing.Meter>`

**Example:**
```typescript
const meter = await this.stripeUsage.retrieveBillingMeter('mtr_123');
```

---

## StripePortalService

Customer self-service portal session management.

### createPortalSession()

Create a customer portal session.

**Parameters:**
```typescript
{
  stripeCustomerId: string;   // Customer ID
  returnUrl?: string;         // Return URL after portal session
  configurationId?: string;   // Portal configuration ID
}
```

**Returns:** `Promise<Stripe.BillingPortal.Session>`

**Example:**
```typescript
const session = await this.stripePortal.createPortalSession({
  stripeCustomerId: 'cus_123',
  returnUrl: 'https://example.com/account',
});

// Redirect user to session.url
```

### getPortalUrl()

Get a direct portal URL for a customer.

**Parameters:**
- `customerId: string` - Customer ID
- `returnUrl?: string` - Optional return URL

**Returns:** `Promise<string>` - Portal URL

**Example:**
```typescript
const portalUrl = await this.stripePortal.getPortalUrl('cus_123');
// Redirect user to portalUrl
```

---

## StripeWebhookService

Webhook verification and event categorization.

### constructEvent()

Verify and parse a Stripe webhook event.

**Parameters:**
- `payload: Buffer | string` - Raw request body
- `signature: string` - Stripe-Signature header value

**Returns:** `Stripe.Event`

**Throws:** `Error` if signature verification fails

**Example:**
```typescript
const event = this.stripeWebhook.constructEvent(
  req.rawBody,
  req.headers['stripe-signature'],
);
```

### isSubscriptionEvent()

Check if event type is subscription-related.

**Parameters:**
- `eventType: string` - Event type

**Returns:** `boolean`

**Example:**
```typescript
if (this.stripeWebhook.isSubscriptionEvent(event.type)) {
  // Handle subscription event
}
```

### isInvoiceEvent()

Check if event type is invoice-related.

**Parameters:**
- `eventType: string` - Event type

**Returns:** `boolean`

**Example:**
```typescript
if (this.stripeWebhook.isInvoiceEvent(event.type)) {
  // Handle invoice event
}
```

### isPaymentEvent()

Check if event type is payment-related.

**Parameters:**
- `eventType: string` - Event type

**Returns:** `boolean`

**Example:**
```typescript
if (this.stripeWebhook.isPaymentEvent(event.type)) {
  // Handle payment event
}
```

### isCustomerEvent()

Check if event type is customer-related.

**Parameters:**
- `eventType: string` - Event type

**Returns:** `boolean`

**Example:**
```typescript
if (this.stripeWebhook.isCustomerEvent(event.type)) {
  // Handle customer event
}
```

---

## Error Handling

All service methods use the `@HandleStripeErrors()` decorator which transforms Stripe SDK errors into `StripeError` instances with appropriate HTTP status codes.

### StripeError Class

```typescript
class StripeError extends Error {
  constructor(
    message: string,
    public readonly statusCode: HttpStatus,
    public readonly code?: string,
    public readonly param?: string,
  ) {}
}
```

### Error Types and Status Codes

| Stripe Error Type            | HTTP Status | Description                          |
|------------------------------|-------------|--------------------------------------|
| `StripeCardError`            | 402         | Card payment declined or failed      |
| `StripeRateLimitError`       | 429         | Too many requests to Stripe API      |
| `StripeInvalidRequestError`  | 400         | Invalid parameters or request        |
| `StripeAPIError`             | 500         | Stripe API internal error            |
| `StripeConnectionError`      | 503         | Network connection to Stripe failed  |
| `StripeAuthenticationError`  | 401         | Invalid API key or authentication    |
| `StripeIdempotencyError`     | 409         | Duplicate request detected           |
| Unknown/Other                | 500         | Generic error                        |

### Error Handling Example

```typescript
import { StripeError } from './core/stripe/errors/stripe.errors';

try {
  const customer = await this.stripeCustomer.createCustomer({
    companyId: 'company_123',
    email: 'invalid-email',
    name: 'Test',
  });
} catch (error) {
  if (error instanceof StripeError) {
    console.error(`Stripe Error [${error.statusCode}]:`, error.message);

    if (error.code) {
      console.error('Error code:', error.code);
    }

    if (error.param) {
      console.error('Invalid parameter:', error.param);
    }

    // Handle specific error types
    switch (error.statusCode) {
      case 400:
        // Invalid request
        break;
      case 402:
        // Card declined
        break;
      case 429:
        // Rate limit exceeded - retry with backoff
        break;
      default:
        // Other error
        break;
    }
  } else {
    // Non-Stripe error
    console.error('Unexpected error:', error);
  }
}
```

---

## Type Definitions

All services use Stripe SDK TypeScript types. Import from the Stripe package:

```typescript
import Stripe from 'stripe';

// Use Stripe types
const customer: Stripe.Customer = await this.stripeCustomer.createCustomer({...});
const subscription: Stripe.Subscription = await this.stripeSubscription.createSubscription({...});
```

## See Also

- [README](../README.md) - Main module documentation
- [Examples](EXAMPLES.md) - Real-world usage examples
- [Testing Guide](TESTING.md) - Testing patterns and utilities
- [Webhook Guide](WEBHOOKS.md) - Webhook implementation guide
