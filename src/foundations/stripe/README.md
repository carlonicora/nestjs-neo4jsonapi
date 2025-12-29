# Stripe Billing Foundation

Comprehensive Stripe billing and subscription management foundation for NestJS applications with Neo4j graph database.

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Installation & Setup](#installation--setup)
- [API Reference](#api-reference)
- [Integration Guide](#integration-guide)
- [Webhook Processing](#webhook-processing)
- [Email Notifications](#email-notifications)
- [Testing](#testing)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)

---

## Overview

This billing foundation provides a complete, production-ready Stripe integration with:
- Customer and subscription management
- Invoice and payment tracking
- Usage-based billing with meters
- Webhook event processing with automatic retries
- Email notifications for payment events
- Comprehensive test coverage (≥80%)

### Key Components

- **Controllers**: REST API endpoints for billing, admin, and webhooks
- **Services**: Business logic orchestration and Stripe API integration
- **Repositories**: Neo4j graph database operations
- **Processors**: BullMQ-based async webhook processing
- **Entities**: Type-safe data models with JSON:API serialization

---

## Features

### Customer Management
- ✅ Create and sync Stripe customers with company entities
- ✅ Customer portal session generation
- ✅ Payment method management (add, remove, set default)
- ✅ Setup intents for payment method collection

### Subscription Management
- ✅ Create, pause, resume, and cancel subscriptions
- ✅ Plan upgrades/downgrades with proration preview
- ✅ Trial period support
- ✅ Subscription status tracking and synchronization

### Billing & Invoicing
- ✅ Invoice creation and tracking
- ✅ Payment success/failure handling
- ✅ Upcoming invoice preview
- ✅ Invoice history and status management

### Usage-Based Billing
- ✅ Stripe Billing Meters V2 API integration
- ✅ Usage event reporting
- ✅ Meter event summaries
- ✅ Usage record tracking and aggregation

### Webhook Processing
- ✅ Signature verification for security
- ✅ Idempotent event processing (duplicate detection)
- ✅ Async processing with BullMQ and Redis
- ✅ Automatic retry with exponential backoff
- ✅ 10+ Stripe event types supported

### Email Notifications
- ✅ Payment failure notifications
- ✅ Subscription status change alerts
- ✅ Handlebars template system
- ✅ Template fallback (app → library)

---

## Architecture

### Data Flow

```
Stripe Webhook → Controller (verify signature)
                ↓
         Webhook Repository (store event, check duplicates)
                ↓
         BullMQ Queue (async processing)
                ↓
         Webhook Processor (route by event type)
                ↓
         Services (business logic + Stripe sync)
                ↓
         Repositories (Neo4j persistence)
                ↓
         Notification Service (queue emails)
```

### Neo4j Schema

```cypher
// Core Entities
(Company)-[:HAS_BILLING_CUSTOMER]->(BillingCustomer)
(BillingCustomer)-[:HAS_SUBSCRIPTION]->(Subscription)
(Subscription)-[:USES_PRICE]->(StripePrice)
(StripePrice)-[:FOR_PRODUCT]->(StripeProduct)
(BillingCustomer)-[:HAS_INVOICE]->(Invoice)
(Invoice)-[:FOR_SUBSCRIPTION]->(Subscription)
(Subscription)-[:HAS_USAGE_RECORD]->(UsageRecord)
```

### Module Structure

```
foundations/stripe/
├── controllers/          # REST API endpoints
│   ├── billing.controller.ts            # Customer/subscription endpoints (JwtAuth)
│   ├── billing-admin.controller.ts      # Product/price admin endpoints (AdminAuth)
│   └── webhook.controller.ts            # Stripe webhook receiver (public)
├── services/             # Business logic
│   ├── billing.service.ts               # Customer & payment methods
│   ├── subscription.service.ts          # Subscription lifecycle
│   ├── invoice.service.ts               # Invoice management
│   ├── usage.service.ts                 # Usage-based billing
│   ├── billing-admin.service.ts         # Product/price management
│   ├── notification.service.ts          # Email notification queueing
│   └── stripe.*.service.ts              # Stripe API wrappers
├── repositories/         # Neo4j data access
│   ├── billing-customer.repository.ts
│   ├── subscription.repository.ts
│   ├── invoice.repository.ts
│   ├── stripe-price.repository.ts
│   ├── stripe-product.repository.ts
│   ├── usage-record.repository.ts
│   └── webhook-event.repository.ts
├── processors/           # Async webhook processing
│   └── webhook.processor.ts
├── entities/             # Data models & JSON:API serialization
│   ├── *.entity.ts      # TypeScript interfaces
│   ├── *.model.ts       # JSON:API models
│   ├── *.meta.ts        # JSON:API metadata
│   └── *.map.ts         # Entity mappers
├── dtos/                 # Request validation DTOs
└── errors/               # Custom error classes
```

---

## Installation & Setup

### Prerequisites

- Node.js ≥18
- NestJS ≥10
- Neo4j ≥5.x
- Redis ≥6.x (for BullMQ)
- Stripe API account

### 1. Install Dependencies

```bash
pnpm add @carlonicora/nestjs-neo4jsonapi stripe @nestjs/bullmq bullmq
```

### 2. Environment Variables

Create `.env` file with:

```bash
# Stripe Configuration
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_API_VERSION=2024-11-20.acacia

# Neo4j Database
NEO4J_URI=bolt://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=your-password

# BullMQ / Redis
REDIS_HOST=localhost
REDIS_PORT=6379
QUEUE=your-app-name

# Application
APP_URL=https://yourdomain.com
```

### 3. Import Module

In your app's main module:

```typescript
import { StripeModule } from '@carlonicora/nestjs-neo4jsonapi';

@Module({
  imports: [
    StripeModule, // Registers all billing components
    // ... other modules
  ],
})
export class AppModule {}
```

### 4. Configure Stripe Webhooks

1. Go to Stripe Dashboard → Developers → Webhooks
2. Add endpoint: `https://yourdomain.com/billing/webhooks/stripe`
3. Select events to listen for:
   - `customer.created`, `customer.updated`, `customer.deleted`
   - `subscription.created`, `subscription.updated`, `subscription.deleted`
   - `invoice.created`, `invoice.paid`, `invoice.payment_failed`
   - `payment_intent.succeeded`, `payment_intent.payment_failed`
4. Copy webhook signing secret to `STRIPE_WEBHOOK_SECRET`

### 5. Run Migrations (Neo4j Constraints)

The repositories automatically create constraints on first module init:

```typescript
// Automatically created:
CREATE CONSTRAINT billing_customer_id IF NOT EXISTS FOR (bc:BillingCustomer) REQUIRE bc.id IS UNIQUE;
CREATE CONSTRAINT subscription_id IF NOT EXISTS FOR (s:Subscription) REQUIRE s.id IS UNIQUE;
CREATE INDEX webhook_event_stripe_id IF NOT EXISTS FOR (we:WebhookEvent) ON (we.stripeEventId);
// ... etc
```

---

## API Reference

### Customer Endpoints

All customer endpoints require `JwtAuthGuard` and use `req.user.companyId` for access control.

#### GET `/billing/customer`
Get current company's billing customer.

**Response:**
```json
{
  "data": {
    "type": "billing-customers",
    "id": "customer_123",
    "attributes": {
      "stripeCustomerId": "cus_...",
      "email": "customer@example.com",
      "name": "Customer Name",
      "currency": "usd",
      "balance": 0,
      "delinquent": false
    }
  }
}
```

#### POST `/billing/customer`
Create a new billing customer for the company.

**Request:**
```json
{
  "name": "Customer Name",
  "email": "customer@example.com",
  "currency": "usd"
}
```

**Response:** `201 Created` with customer data

**Errors:**
- `409 Conflict` - Customer already exists for this company

#### POST `/billing/setup-intent`
Create a setup intent to collect payment method.

**Request:**
```json
{
  "paymentMethodType": "card"
}
```

**Response:**
```json
{
  "clientSecret": "seti_..."
}
```

#### POST `/billing/customer/portal-session`
Create a Stripe customer portal session.

**Request (optional):**
```json
{
  "returnUrl": "https://yourdomain.com/billing"
}
```

**Response:**
```json
{
  "url": "https://billing.stripe.com/session/..."
}
```

### Payment Methods

#### GET `/billing/payment-methods`
List all payment methods for the customer.

**Response:**
```json
{
  "paymentMethods": [
    {
      "id": "pm_...",
      "type": "card",
      "card": {
        "brand": "visa",
        "last4": "4242",
        "exp_month": 12,
        "exp_year": 2025
      }
    }
  ]
}
```

#### POST `/billing/payment-methods/:paymentMethodId/default`
Set a payment method as default.

**Response:** `204 No Content`

#### DELETE `/billing/payment-methods/:paymentMethodId`
Remove a payment method.

**Response:** `204 No Content`

**Errors:**
- `403 Forbidden` - Payment method doesn't belong to customer

### Subscription Endpoints

#### GET `/billing/subscriptions`
List subscriptions for the company.

**Query Parameters:**
- `status` (optional): Filter by status (`active`, `canceled`, `past_due`, etc.)
- JSON:API pagination: `page[number]`, `page[size]`

**Response:**
```json
{
  "data": [
    {
      "type": "subscriptions",
      "id": "sub_...",
      "attributes": {
        "stripeSubscriptionId": "sub_...",
        "status": "active",
        "currentPeriodStart": "2025-01-01T00:00:00Z",
        "currentPeriodEnd": "2025-02-01T00:00:00Z",
        "cancelAtPeriodEnd": false
      }
    }
  ],
  "meta": {
    "totalCount": 1
  }
}
```

#### POST `/billing/subscriptions`
Create a new subscription.

**Request:**
```json
{
  "priceId": "price_...",
  "paymentMethodId": "pm_...",
  "trialPeriodDays": 14,
  "quantity": 1
}
```

**Response:** `201 Created` with subscription data

#### POST `/billing/subscriptions/:subscriptionId/cancel`
Cancel a subscription.

**Request:**
```json
{
  "cancelImmediately": false
}
```

**Response:** Updated subscription with `cancelAtPeriodEnd: true` or `status: canceled`

#### POST `/billing/subscriptions/:subscriptionId/pause`
Pause a subscription.

**Response:** Updated subscription with `status: paused`

#### POST `/billing/subscriptions/:subscriptionId/resume`
Resume a paused subscription.

**Response:** Updated subscription with `status: active`

#### POST `/billing/subscriptions/:subscriptionId/change-plan`
Change subscription to a different price.

**Request:**
```json
{
  "priceId": "price_new_..."
}
```

**Response:** Updated subscription

#### GET `/billing/subscriptions/:subscriptionId/proration-preview`
Preview proration amount for plan change.

**Query Parameters:**
- `priceId`: New price ID to preview

**Response:**
```json
{
  "proratedAmount": 1234,
  "currency": "usd",
  "nextInvoiceTotal": 5000
}
```

### Invoice Endpoints

#### GET `/billing/invoices`
List invoices for the company.

**Query Parameters:**
- `status` (optional): Filter by status (`draft`, `open`, `paid`, `void`, etc.)

**Response:**
```json
{
  "data": [
    {
      "type": "invoices",
      "id": "inv_...",
      "attributes": {
        "stripeInvoiceId": "in_...",
        "status": "paid",
        "amountDue": 2000,
        "amountPaid": 2000,
        "currency": "usd",
        "stripeHostedInvoiceUrl": "https://invoice.stripe.com/..."
      }
    }
  ]
}
```

#### GET `/billing/invoices/:invoiceId`
Get a specific invoice.

**Response:** Invoice data

#### GET `/billing/invoices/upcoming`
Get upcoming invoice preview.

**Query Parameters:**
- `subscriptionId` (optional): Preview for specific subscription

**Response:** Upcoming invoice data

### Usage-Based Billing

#### GET `/billing/meters`
List all available billing meters.

**Response:**
```json
{
  "meters": [
    {
      "id": "meter_...",
      "displayName": "API Calls",
      "eventName": "api_call",
      "status": "active"
    }
  ]
}
```

#### POST `/billing/subscriptions/:subscriptionId/usage`
Report usage for a subscription.

**Request:**
```json
{
  "meterId": "meter_...",
  "meterEventName": "api_call",
  "quantity": 100,
  "timestamp": "2025-01-15T12:00:00Z"
}
```

**Response:** `201 Created` with usage record

#### GET `/billing/subscriptions/:subscriptionId/usage`
List usage records for a subscription.

**Query Parameters:**
- `startTime`: ISO 8601 date (optional)
- `endTime`: ISO 8601 date (optional)

**Response:**
```json
{
  "data": [
    {
      "type": "usage-records",
      "id": "usage_...",
      "attributes": {
        "quantity": 100,
        "timestamp": "2025-01-15T12:00:00Z",
        "meterEventName": "api_call"
      }
    }
  ]
}
```

#### GET `/billing/subscriptions/:subscriptionId/usage/summary`
Get usage summary for a time period.

**Query Parameters:**
- `startTime`: ISO 8601 date (required)
- `endTime`: ISO 8601 date (required)

**Response:**
```json
{
  "subscriptionId": "sub_...",
  "startTime": "2025-01-01T00:00:00Z",
  "endTime": "2025-01-31T23:59:59Z",
  "totalUsage": 5000,
  "recordCount": 50,
  "byMeter": {
    "meter_api_calls": 3000,
    "meter_storage": 2000
  }
}
```

### Admin Endpoints

All admin endpoints require `AdminJwtAuthGuard` and `RoleId.Administrator`.

#### GET `/billing/admin/products`
List all Stripe products.

**Query Parameters:**
- `active`: `true` or `false` to filter by active status

#### POST `/billing/admin/products`
Create a new product.

**Request:**
```json
{
  "name": "Pro Plan",
  "description": "Professional tier subscription"
}
```

#### PUT `/billing/admin/products/:productId`
Update a product.

#### DELETE `/billing/admin/products/:productId`
Archive a product (sets `active: false`).

#### GET `/billing/admin/prices`
List all prices.

**Query Parameters:**
- `productId`: Filter by product
- `active`: Filter by active status

#### POST `/billing/admin/prices`
Create a new price.

**Request:**
```json
{
  "productId": "prod_...",
  "unitAmount": 2000,
  "currency": "usd",
  "recurring": {
    "interval": "month",
    "interval_count": 1
  },
  "nickname": "Pro Monthly"
}
```

### Webhook Endpoint

#### POST `/billing/webhooks/stripe`
Public endpoint for Stripe webhook events.

**Headers:**
- `stripe-signature`: Webhook signature (required)

**Processing:**
1. Verify signature
2. Check for duplicate events (idempotency)
3. Store event in Neo4j
4. Queue for async processing
5. Return `200 OK` immediately

**Response:**
```json
{
  "received": true
}
```

**Errors:**
- `400 Bad Request` - Missing signature or raw body
- `400 Bad Request` - Signature verification failed
- `500 Internal Server Error` - Processing error

---

## Integration Guide

### Basic Integration Example

```typescript
// app.module.ts
import { Module } from '@nestjs/common';
import { StripeModule } from '@carlonicora/nestjs-neo4jsonapi';

@Module({
  imports: [
    StripeModule, // ✅ Automatically registers all billing components
  ],
})
export class AppModule {}
```

### Using Billing Services

```typescript
// your-feature.service.ts
import { Injectable } from '@nestjs/common';
import {
  BillingService,
  SubscriptionService
} from '@carlonicora/nestjs-neo4jsonapi';

@Injectable()
export class YourFeatureService {
  constructor(
    private readonly billingService: BillingService,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  async createCustomerAndSubscribe(
    companyId: string,
    email: string,
    priceId: string,
  ) {
    // 1. Create billing customer
    const customer = await this.billingService.createCustomer({
      companyId,
      name: 'Customer Name',
      email,
      currency: 'usd',
    });

    // 2. Create subscription
    const subscription = await this.subscriptionService.createSubscription({
      companyId,
      priceId,
      paymentMethodId: 'pm_...', // From setup intent
      trialPeriodDays: 14,
    });

    return { customer, subscription };
  }
}
```

### Reporting Usage Events

```typescript
// your-api.service.ts
import { Injectable } from '@nestjs/common';
import { UsageService } from '@carlonicora/nestjs-neo4jsonapi';

@Injectable()
export class YourApiService {
  constructor(private readonly usageService: UsageService) {}

  async handleApiCall(companyId: string, subscriptionId: string) {
    // Report usage to Stripe Billing Meters
    await this.usageService.reportUsage({
      companyId,
      subscriptionId,
      meterId: process.env.STRIPE_API_CALLS_METER_ID,
      meterEventName: 'api_call',
      quantity: 1,
      timestamp: new Date(),
    });
  }
}
```

### Custom Webhook Handlers

Extend the webhook processor for custom event handling:

```typescript
// custom-webhook.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';

@Processor(`${process.env.QUEUE}_billing_webhook`)
@Injectable()
export class CustomWebhookProcessor extends WorkerHost {
  async process(job: Job) {
    const { eventType, payload } = job.data;

    if (eventType === 'customer.subscription.created') {
      // Your custom logic here
      await this.handleNewSubscription(payload);
    }

    // Call parent processor for standard handling
    return super.process(job);
  }

  private async handleNewSubscription(subscription: any) {
    // Send welcome email, provision resources, etc.
  }
}
```

---

## Webhook Processing

### Event Flow

```
1. Stripe sends webhook → POST /billing/webhooks/stripe
2. Controller verifies signature
3. Controller checks for duplicate (WebhookEventRepository)
4. Controller stores event in Neo4j
5. Controller queues job in BullMQ
6. Controller returns 200 OK (fast response)
---
7. WebhookProcessor picks up job
8. Processor routes to event-specific handler
9. Handler syncs data with Stripe
10. Handler updates Neo4j via repositories
11. Handler queues email notifications (if needed)
12. Job marked complete
```

### Supported Event Types

| Event Type | Handler | Actions |
|------------|---------|---------|
| `customer.created` | `handleCustomerEvent` | Create customer in Neo4j |
| `customer.updated` | `handleCustomerEvent` | Sync customer data |
| `customer.deleted` | `handleCustomerEvent` | Cancel all subscriptions |
| `subscription.created` | `handleSubscriptionEvent` | Create subscription in Neo4j |
| `subscription.updated` | `handleSubscriptionEvent` | Sync subscription status |
| `subscription.deleted` | `handleSubscriptionEvent` | Mark as canceled |
| `invoice.created` | `handleInvoiceEvent` | Create invoice record |
| `invoice.paid` | `handleInvoiceEvent` | Update status to paid |
| `invoice.payment_failed` | `handleInvoiceEvent` | Send failure notification |
| `payment_intent.payment_failed` | `handlePaymentIntentEvent` | Send failure notification |

### Retry Logic

Webhook jobs use exponential backoff:

```typescript
{
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 1000, // 1s, 2s, 4s
  },
  removeOnComplete: true,
  removeOnFail: false, // Keep failed jobs for debugging
}
```

### Idempotency

Duplicate events are detected by checking `stripeEventId`:

```typescript
const existingEvent = await this.webhookEventRepository.findByStripeEventId({
  stripeEventId: event.id,
});

if (existingEvent) {
  return reply.status(200).send({ received: true, duplicate: true });
}
```

---

## Email Notifications

### Notification Types

1. **Payment Failure** (`paymentFailure.hbs`)
   - Triggered by: `invoice.payment_failed`, `payment_intent.payment_failed`
   - Includes: Amount, error message, invoice URL, update payment URL

2. **Subscription Status Change** (`subscriptionStatusChange.hbs`)
   - Triggered by: `subscription.updated`, `subscription.deleted`
   - Includes: New status, subscription ID, dashboard URL

### Template System

Templates use Handlebars with a **fallback hierarchy**:

```
1. App templates (optional overrides)
   → apps/api/templates/email/{locale}/{templateId}.hbs

2. Library templates (defaults)
   → packages/nestjs-neo4jsonapi/src/core/email/templates/{locale}/{templateId}.hbs

3. Error if not found in either location
```

### Customizing Templates

Create your own templates in `apps/api/templates/email/en/`:

```handlebars
<!-- apps/api/templates/email/en/paymentFailure.hbs -->
<!DOCTYPE html>
<html>
<head>
  <title>Payment Failed - Your Brand</title>
</head>
<body>
  {{> header}}

  <h1>Payment Issue</h1>
  <p>Hi {{customerName}},</p>

  <p>We couldn't process your payment of {{amount}} {{currency}}.</p>

  {{#if errorMessage}}
  <p><strong>Error:</strong> {{errorMessage}}</p>
  {{/if}}

  <a href="{{updatePaymentUrl}}">Update Payment Method</a>

  {{> footer}}
</body>
</html>
```

### Notification Queue

Notifications are queued via BullMQ:

```typescript
await this.emailQueue.add(
  'billing-notification',
  {
    jobType: 'payment-failure',
    payload: {
      to: customer.email,
      customerName: customer.name,
      amount: 2000,
      currency: 'usd',
      errorMessage: 'Card declined',
      invoiceUrl: 'https://...',
      locale: 'en',
    },
  },
  {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  }
);
```

---

## Testing

### Test Coverage

```
Test Suites: 28 passed
Tests:       1,543 passed
Coverage:    ≥80% for core business logic

Breakdown:
- Controllers:  100% lines, 59% branches
- Repositories: 100% lines, 95% branches
- Services:     98% lines, 82% branches
- Processors:   100% lines, 88% branches
```

### Running Tests

```bash
# Run all tests
pnpm --filter @carlonicora/nestjs-neo4jsonapi test

# Run with coverage
pnpm --filter @carlonicora/nestjs-neo4jsonapi test:cov

# Run specific test file
pnpm --filter @carlonicora/nestjs-neo4jsonapi test billing.service.spec.ts

# Watch mode
pnpm --filter @carlonicora/nestjs-neo4jsonapi test:watch
```

### Test Patterns

#### Repository Tests

```typescript
describe('BillingCustomerRepository', () => {
  let repository: BillingCustomerRepository;
  let neo4jService: jest.Mocked<Neo4jService>;

  beforeEach(() => {
    neo4jService = {
      initQuery: jest.fn().mockReturnThis(),
      readOne: jest.fn(),
      writeOne: jest.fn(),
    } as any;

    repository = new BillingCustomerRepository(neo4jService, logger);
  });

  it('should find customer by company ID', async () => {
    neo4jService.readOne.mockResolvedValue(mockCustomer);

    const result = await repository.findByCompanyId({ companyId: 'company_123' });

    expect(neo4jService.initQuery).toHaveBeenCalled();
    expect(result).toEqual(mockCustomer);
  });
});
```

#### Service Tests

```typescript
describe('BillingService', () => {
  let service: BillingService;
  let billingCustomerRepository: jest.Mocked<BillingCustomerRepository>;
  let stripeCustomerService: jest.Mocked<StripeCustomerService>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: BillingCustomerRepository, useValue: mockRepository },
        { provide: StripeCustomerService, useValue: mockStripeService },
      ],
    }).compile();

    service = module.get<BillingService>(BillingService);
  });

  it('should create customer in Stripe then database', async () => {
    stripeCustomerService.createCustomer.mockResolvedValue(stripeCustomer);
    billingCustomerRepository.create.mockResolvedValue(dbCustomer);

    await service.createCustomer({ companyId, name, email, currency });

    expect(stripeCustomerService.createCustomer).toHaveBeenCalledBefore(
      billingCustomerRepository.create
    );
  });
});
```

#### Controller Tests

```typescript
describe('BillingController', () => {
  let controller: BillingController;
  let billingService: jest.Mocked<BillingService>;
  let mockReply: jest.Mocked<FastifyReply>;

  it('should get customer for authenticated user', async () => {
    billingService.getCustomer.mockResolvedValue(jsonApiResponse);

    await controller.getCustomer(
      { user: { companyId: 'company_123' } } as any,
      mockReply
    );

    expect(billingService.getCustomer).toHaveBeenCalledWith({
      companyId: 'company_123'
    });
    expect(mockReply.send).toHaveBeenCalledWith(jsonApiResponse);
  });
});
```

### Integration Testing

Test the full webhook flow:

```typescript
it('should process invoice.payment_failed webhook end-to-end', async () => {
  // 1. Send webhook to controller
  const response = await request(app)
    .post('/billing/webhooks/stripe')
    .set('stripe-signature', validSignature)
    .send(webhookPayload);

  expect(response.status).toBe(200);

  // 2. Verify event stored
  const event = await webhookEventRepository.findByStripeEventId({
    stripeEventId: webhookPayload.id,
  });
  expect(event).toBeDefined();

  // 3. Wait for processor to handle job
  await waitForJobCompletion();

  // 4. Verify invoice updated
  const invoice = await invoiceRepository.findByStripeInvoiceId({
    stripeInvoiceId: webhookPayload.data.object.id,
  });
  expect(invoice.status).toBe('open');

  // 5. Verify email notification queued
  expect(emailQueue.add).toHaveBeenCalledWith(
    'billing-notification',
    expect.objectContaining({ jobType: 'payment-failure' })
  );
});
```

---

## Deployment

### Production Checklist

#### Environment Configuration

- [ ] Set production Stripe keys (`STRIPE_SECRET_KEY`)
- [ ] Configure webhook secret (`STRIPE_WEBHOOK_SECRET`)
- [ ] Set correct API version (`STRIPE_API_VERSION`)
- [ ] Configure Neo4j production credentials
- [ ] Set up Redis cluster for BullMQ
- [ ] Configure `APP_URL` for email links
- [ ] Enable HTTPS for all endpoints

#### Infrastructure

- [ ] Neo4j cluster with replication
- [ ] Redis cluster with persistence
- [ ] Load balancer with health checks
- [ ] Webhook endpoint monitoring
- [ ] Queue dashboard (BullMQ Board)

#### Stripe Setup

- [ ] Create webhook endpoint in Stripe Dashboard
- [ ] Enable required event types (see [Webhook Processing](#webhook-processing))
- [ ] Test webhook with Stripe CLI (`stripe listen --forward-to`)
- [ ] Create products and prices
- [ ] Set up billing meters for usage-based billing
- [ ] Configure tax settings (if applicable)

#### Monitoring & Logging

- [ ] Set up error tracking (Sentry, etc.)
- [ ] Monitor webhook processing latency
- [ ] Track failed jobs in BullMQ
- [ ] Alert on payment failures
- [ ] Monitor Stripe API rate limits
- [ ] Log all customer-facing errors

### Performance Optimization

#### Database Indexes

Constraints are created automatically, but consider additional indexes:

```cypher
// Fast lookups by Stripe IDs
CREATE INDEX customer_stripe_id IF NOT EXISTS
FOR (bc:BillingCustomer) ON (bc.stripeCustomerId);

CREATE INDEX subscription_stripe_id IF NOT EXISTS
FOR (s:Subscription) ON (s.stripeSubscriptionId);

// Fast status filtering
CREATE INDEX subscription_status IF NOT EXISTS
FOR (s:Subscription) ON (s.status);

CREATE INDEX invoice_status IF NOT EXISTS
FOR (i:Invoice) ON (i.status);
```

#### Queue Optimization

```typescript
// webhook.processor.ts
@Processor(`${process.env.QUEUE}_billing_webhook`, {
  concurrency: 10, // Process 10 jobs in parallel
  lockDuration: 30000, // 30s lock timeout
})
```

#### Caching Strategies

Cache frequently accessed data:

```typescript
@Injectable()
export class BillingService {
  constructor(
    private readonly cacheService: CacheService,
    private readonly billingCustomerRepository: BillingCustomerRepository,
  ) {}

  async getCustomer(companyId: string) {
    const cacheKey = `billing:customer:${companyId}`;

    const cached = await this.cacheService.get(cacheKey);
    if (cached) return cached;

    const customer = await this.billingCustomerRepository.findByCompanyId({
      companyId
    });

    await this.cacheService.set(cacheKey, customer, { ttl: 300 }); // 5 min
    return customer;
  }
}
```

### Scaling Considerations

- **Horizontal Scaling**: Run multiple app instances with Redis-backed BullMQ
- **Database Sharding**: Partition Neo4j by company for very large datasets
- **Queue Separation**: Use separate queues for high-priority vs. background jobs
- **Rate Limiting**: Implement rate limits on webhook endpoint to prevent abuse

---

## Troubleshooting

### Common Issues

#### Webhook Signature Verification Fails

**Problem:** `400 Bad Request - Webhook signature verification failed`

**Solutions:**
1. Verify `STRIPE_WEBHOOK_SECRET` matches Stripe Dashboard
2. Ensure raw body is preserved (no body parsing middleware)
3. Check Stripe CLI for test mode: `stripe listen --forward-to localhost:3000/billing/webhooks/stripe`
4. Verify `stripe-signature` header is present

```typescript
// Fastify config for raw body
app.register(require('@fastify/raw-body'), {
  field: 'rawBody',
  global: false,
  encoding: 'utf8',
  runFirst: true,
});
```

#### Duplicate Webhook Events

**Problem:** Same event processed multiple times

**Expected Behavior:** Duplicates are automatically ignored via `stripeEventId` check.

**If duplicates persist:**
1. Check `WebhookEventRepository.findByStripeEventId()` is working
2. Verify Neo4j constraint on `stripeEventId` exists
3. Check for clock skew (Stripe events have 300s tolerance)

#### Queue Jobs Not Processing

**Problem:** Jobs stuck in queue, never processed

**Solutions:**
1. Verify Redis is running: `redis-cli ping`
2. Check worker is registered: Look for `WebhookProcessor` in logs
3. Verify queue name matches: `${process.env.QUEUE}_billing_webhook`
4. Check BullMQ dashboard: `pnpm add @bull-board/nestjs`

```typescript
// Add BullMQ dashboard
import { BullBoardModule } from '@bull-board/nestjs';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';

@Module({
  imports: [
    BullBoardModule.forRoot({
      route: '/admin/queues',
      adapter: BullMQAdapter,
    }),
  ],
})
```

#### Payment Method Not Found

**Problem:** `403 Forbidden - Payment method doesn't belong to customer`

**Cause:** User trying to remove a payment method attached to a different customer.

**Solution:** Already handled by ownership validation. If issue persists:
1. Sync payment methods: Call `stripeCustomerService.listPaymentMethods()`
2. Verify `paymentMethod.customer` matches `billingCustomer.stripeCustomerId`

#### Neo4j Connection Errors

**Problem:** `Neo4j connection failed`

**Solutions:**
1. Verify Neo4j is running: `http://localhost:7474`
2. Check credentials in `.env`
3. Ensure bolt protocol: `NEO4J_URI=bolt://localhost:7687`
4. Verify network connectivity (firewall, Docker network)

#### Email Notifications Not Sent

**Problem:** Webhook processed but no emails sent

**Solutions:**
1. Check `NotificationService` is queueing jobs:
   ```typescript
   this.logger.log(`Queued payment failure notification for ${stripeCustomerId}`);
   ```
2. Verify email queue exists: `${process.env.QUEUE}_email`
3. Check email processor is running (should be in app, not library)
4. Verify email templates exist (check fallback path)

### Debug Mode

Enable verbose logging:

```typescript
// main.ts
app.useLogger(app.get(AppLoggingService));
app.get(AppLoggingService).setLogLevel('debug');
```

### Testing Webhooks Locally

Use Stripe CLI:

```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Login
stripe login

# Forward webhooks to local server
stripe listen --forward-to localhost:3000/billing/webhooks/stripe

# Trigger test events
stripe trigger customer.created
stripe trigger invoice.payment_failed
stripe trigger subscription.updated
```

### Health Check Endpoint

Add health check for monitoring:

```typescript
@Controller('health')
export class HealthController {
  constructor(
    private readonly neo4jService: Neo4jService,
    @InjectQueue(`${process.env.QUEUE}_billing_webhook`)
    private readonly webhookQueue: Queue,
  ) {}

  @Get()
  async check() {
    // Check Neo4j
    await this.neo4jService.read('RETURN 1');

    // Check Redis/BullMQ
    await this.webhookQueue.client.ping();

    return { status: 'ok', timestamp: new Date() };
  }
}
```

---

## Support & Contributing

### Reporting Issues

When reporting issues, include:
1. Stripe event type (if webhook-related)
2. Error logs with stack trace
3. Relevant code snippets
4. Environment details (Node version, NestJS version)

### Development Setup

```bash
# Clone repository
git clone https://github.com/your-org/nestjs-neo4jsonapi.git

# Install dependencies
pnpm install

# Run tests
pnpm --filter @carlonicora/nestjs-neo4jsonapi test

# Run with coverage
pnpm --filter @carlonicora/nestjs-neo4jsonapi test:cov
```

### Running Integration Tests

```bash
# Start Neo4j and Redis via Docker
docker-compose up -d

# Run integration tests
pnpm test:integration
```

---

## License

[Your License Here]

## Version History

- **1.16.0** - Stripe Billing Foundation consolidation with comprehensive test coverage
- Initial release with customer, subscription, invoice, and usage management
