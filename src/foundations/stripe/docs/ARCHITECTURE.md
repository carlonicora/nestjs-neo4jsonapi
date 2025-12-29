# Stripe Foundation Architecture

Comprehensive architectural documentation for the Stripe billing foundation module.

## Table of Contents

- [Overview](#overview)
- [System Architecture](#system-architecture)
- [Data Flow](#data-flow)
- [Storage Model](#storage-model)
- [Service Layer Design](#service-layer-design)
- [Repository Pattern](#repository-pattern)
- [Webhook Processing](#webhook-processing)
- [Idempotency Patterns](#idempotency-patterns)
- [Error Handling](#error-handling)
- [Security Considerations](#security-considerations)

---

## Overview

The Stripe Foundation module implements a **hybrid storage architecture** that combines:
- **Stripe API** as the source of truth for billing data
- **Neo4j graph database** for relationship management and company-scoped data
- **Redis/BullMQ** for asynchronous webhook processing
- **JSON:API** specification for standardized REST responses

### Core Principles

1. **Stripe as Source of Truth**: All billing operations (charges, subscriptions) are created in Stripe first
2. **Neo4j for Relationships**: Company ownership, entity relationships, and historical data stored in Neo4j
3. **Eventual Consistency**: Webhooks synchronize Stripe changes to Neo4j asynchronously
4. **Idempotency**: All operations are safe to retry without side effects
5. **Multi-Tenancy**: All data is scoped to companies for tenant isolation

---

## System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client Application                       │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      NestJS Application                          │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    Controllers Layer                      │  │
│  │  • BillingController                                      │  │
│  │  • BillingAdminController                                 │  │
│  │  • WebhookController                                      │  │
│  └────────────┬─────────────────────────────────────────────┘  │
│               │                                                  │
│  ┌────────────▼─────────────────────────────────────────────┐  │
│  │              Business Logic Services                      │  │
│  │  • BillingService    • SubscriptionService               │  │
│  │  • InvoiceService    • UsageService                       │  │
│  │  • BillingAdminService                                    │  │
│  │  • NotificationService                                    │  │
│  └────────────┬─────────────────────────────────────────────┘  │
│               │                                                  │
│  ┌────────────▼─────────────────────────────────────────────┐  │
│  │            Stripe API Services (9 services)               │  │
│  │  • StripeCustomerService  • StripeSubscriptionService    │  │
│  │  • StripePaymentService   • StripeInvoiceService          │  │
│  │  • StripeProductService   • StripeUsageService            │  │
│  │  • StripePortalService    • StripeWebhookService          │  │
│  │  • StripeService (base)                                   │  │
│  └────────────┬─────────────────────────────────────────────┘  │
│               │                                                  │
│  ┌────────────▼─────────────────────────────────────────────┐  │
│  │               Repository Layer (7 repos)                  │  │
│  │  • BillingCustomerRepository  • SubscriptionRepository   │  │
│  │  • InvoiceRepository          • UsageRecordRepository     │  │
│  │  • StripeProductRepository    • StripePriceRepository     │  │
│  │  • WebhookEventRepository                                 │  │
│  └────────────┬─────────────────────────────────────────────┘  │
└───────────────┼──────────────────────────────────────────────────┘
                │
        ┌───────┴────────┐
        │                │
        ▼                ▼
┌──────────────┐  ┌──────────────┐
│   Stripe     │  │    Neo4j     │
│     API      │  │   Database   │
│              │  │              │
│ • Customers  │  │ • Companies  │
│ • Subs       │  │ • Relations  │
│ • Invoices   │  │ • History    │
│ • Payments   │  │ • Metadata   │
└──────────────┘  └──────────────┘
```

### Webhook Processing Flow

```
┌──────────────┐
│    Stripe    │
│   Webhooks   │
└──────┬───────┘
       │
       │ HTTP POST with signature
       ▼
┌──────────────────────────────────┐
│     WebhookController            │
│  1. Verify signature             │
│  2. Parse event                  │
│  3. Check for duplicate          │
└──────┬───────────────────────────┘
       │
       │ Store event & queue job
       ▼
┌──────────────────────────────────┐
│    WebhookEventRepository        │
│  • Store raw event               │
│  • Prevent duplicates            │
└──────┬───────────────────────────┘
       │
       │ Add to BullMQ
       ▼
┌──────────────────────────────────┐
│      Redis Queue                 │
│  • Job: process-webhook          │
│  • Retry: 3 attempts             │
│  • Backoff: exponential          │
└──────┬───────────────────────────┘
       │
       │ Worker processes
       ▼
┌──────────────────────────────────┐
│    WebhookProcessor              │
│  • Route event by type           │
│  • Update Neo4j records          │
│  • Send notifications            │
│  • Mark as processed             │
└──────────────────────────────────┘
```

---

## Data Flow

### Customer Creation Flow

```
1. API Request
   POST /billing/customer
   { name, email, currency }
        │
        ▼
2. BillingService
   ├─ Fetch Company from companyId
   ├─ Check for existing customer in Neo4j
   └─ Create Stripe customer
        │
        ▼
3. StripeCustomerService
   ├─ Call Stripe API: customers.create()
   └─ Return Stripe.Customer object
        │
        ▼
4. BillingCustomerRepository
   ├─ Create BillingCustomer node in Neo4j
   ├─ Link to Company node
   └─ Store stripeCustomerId
        │
        ▼
5. JSON:API Serialization
   └─ Return formatted response
```

### Subscription Lifecycle Flow

```
Create Subscription
─────────────────
1. Client calls POST /billing/subscriptions
2. SubscriptionService creates in Stripe
3. Stripe creates subscription (status: active)
4. SubscriptionRepository stores in Neo4j
5. Stripe sends webhook: customer.subscription.created
6. WebhookProcessor updates Neo4j (idempotent)

Update Subscription
──────────────────
1. SubscriptionService updates in Stripe
2. Stripe modifies subscription
3. Stripe sends webhook: customer.subscription.updated
4. WebhookProcessor syncs changes to Neo4j

Cancel Subscription
──────────────────
1. SubscriptionService cancels in Stripe
2. Stripe cancels subscription
3. Stripe sends webhook: customer.subscription.deleted
4. WebhookProcessor marks as canceled in Neo4j
5. NotificationService queues email notification

Payment Failure
──────────────
1. Stripe attempts payment (automated)
2. Payment fails (card declined)
3. Stripe sends webhook: invoice.payment_failed
4. WebhookProcessor:
   ├─ Updates invoice status in Neo4j
   └─ Calls NotificationService
5. NotificationService:
   ├─ Fetches customer email from Neo4j
   └─ Queues payment failure email via BullMQ
6. EmailProcessor sends notification email
```

---

## Storage Model

### Hybrid Storage Rationale

**Why Not Store Everything in Stripe?**
- ❌ No company/tenant relationships
- ❌ Limited metadata storage
- ❌ No graph query capabilities
- ❌ Cannot link to other application entities

**Why Not Store Everything in Neo4j?**
- ❌ Duplicate payment processing logic
- ❌ PCI compliance complexity
- ❌ No built-in retry/reconciliation
- ❌ Missing Stripe's fraud detection

**Hybrid Solution Benefits:**
- ✅ Stripe handles all payment operations
- ✅ Neo4j manages relationships and ownership
- ✅ Single source of truth per entity type
- ✅ Eventual consistency via webhooks
- ✅ Audit trail in both systems

### Data Partitioning Strategy

| Entity | Source of Truth | Also Stored In | Sync Method |
|--------|----------------|----------------|-------------|
| Customer | Stripe | Neo4j (metadata) | Webhook |
| Subscription | Stripe | Neo4j (status) | Webhook |
| Invoice | Stripe | Neo4j (status) | Webhook |
| Payment | Stripe | Not stored | Event only |
| Product | Stripe | Neo4j (company link) | API call |
| Price | Stripe | Neo4j (company link) | API call |
| UsageRecord | Stripe Meters | Neo4j (audit) | API call |
| Company | Neo4j | Not in Stripe | N/A |

### Neo4j Relationship Schema

```cypher
// Company is the root entity
(c:Company)

// BillingCustomer belongs to Company (1:1)
(c:Company)-[:HAS_BILLING_CUSTOMER]->(bc:BillingCustomer)

// Subscriptions belong to Customer (1:N)
(bc:BillingCustomer)-[:HAS_SUBSCRIPTION]->(s:BillingSubscription)

// Invoices belong to Subscription (1:N)
(s:BillingSubscription)-[:HAS_INVOICE]->(i:BillingInvoice)

// Usage records belong to Subscription (1:N)
(s:BillingSubscription)-[:HAS_USAGE_RECORD]->(ur:BillingUsageRecord)

// Products can be company-specific or global
(c:Company)-[:HAS_PRODUCT]->(p:StripeProduct)
(p:StripeProduct)-[:HAS_PRICE]->(pr:StripePrice)

// Webhook events are stored for audit
(we:WebhookEvent) // No relationships - standalone audit log
```

### Neo4j Node Properties

**BillingCustomer Node:**
```typescript
{
  id: string              // Neo4j internal ID
  stripeCustomerId: string // Stripe customer ID (unique)
  email: string
  name: string
  currency: string
  balance: number
  delinquent: boolean
  createdAt: DateTime
  updatedAt: DateTime
  deletedAt: DateTime?    // Soft delete timestamp
}
```

**BillingSubscription Node:**
```typescript
{
  id: string
  stripeSubscriptionId: string // Stripe subscription ID (unique)
  status: string          // active, canceled, past_due, etc.
  currentPeriodStart: DateTime
  currentPeriodEnd: DateTime
  cancelAtPeriodEnd: boolean
  canceledAt: DateTime?
  trialEnd: DateTime?
  createdAt: DateTime
  updatedAt: DateTime
}
```

---

## Service Layer Design

### Layered Service Architecture

The module uses a **three-tier service architecture**:

1. **Stripe API Services** (lowest level)
   - Direct Stripe SDK wrappers
   - No business logic
   - Returns raw Stripe objects
   - Handles Stripe errors with `@HandleStripeErrors` decorator

2. **Business Logic Services** (middle level)
   - Orchestrate Stripe + Neo4j operations
   - Implement workflows (create customer + link to company)
   - Return JSON:API formatted responses
   - Handle transaction boundaries

3. **Notification Service** (cross-cutting)
   - Queue email/notification jobs
   - Triggered by webhooks or business logic
   - Asynchronous processing via BullMQ

### Service Responsibilities

**StripeCustomerService** (Stripe API Layer)
- `createCustomer(params)` → calls Stripe SDK
- `retrieveCustomer(id)` → calls Stripe SDK
- `updateCustomer(id, params)` → calls Stripe SDK
- `deleteCustomer(id)` → calls Stripe SDK
- Returns: Raw `Stripe.Customer` objects

**BillingService** (Business Logic Layer)
- `createCustomer(params)` → orchestrates:
  1. Validate company exists
  2. Check for existing customer in Neo4j
  3. Call `StripeCustomerService.createCustomer()`
  4. Call `BillingCustomerRepository.create()`
  5. Serialize to JSON:API format
- Returns: JSON:API formatted response

**NotificationService** (Cross-Cutting)
- `sendPaymentFailedEmail(params)` → orchestrates:
  1. Fetch BillingCustomer from Neo4j
  2. Queue email job to BullMQ
  3. Job processed asynchronously by EmailProcessor
- Returns: void (fire-and-forget)

### Dependency Injection Flow

```typescript
@Injectable()
export class BillingService {
  constructor(
    private readonly billingCustomerRepository: BillingCustomerRepository,
    private readonly stripeCustomerService: StripeCustomerService,
    private readonly stripePaymentService: StripePaymentService,
    private readonly stripePortalService: StripePortalService,
    private readonly jsonApiService: JsonApiService,
  ) {}
}
```

- **Business services** depend on Stripe services + repositories
- **Stripe services** depend only on `StripeService` (SDK wrapper)
- **Repositories** depend only on `Neo4jService`
- **Circular dependencies avoided** via clear layering

---

## Repository Pattern

### Repository Design Principles

1. **Single Responsibility**: Each repository manages one entity type
2. **Query Abstraction**: Hide Cypher query complexity
3. **Type Safety**: Return strongly-typed entities
4. **Company Scoping**: All queries filter by `companyId` where applicable
5. **Soft Deletes**: Never hard-delete billing data (audit requirement)

### Standard Repository Methods

Every repository implements:

```typescript
interface BaseRepository<T> {
  // Retrieval
  findById(params: { id: string; companyId: string }): Promise<T | null>;
  findByStripeId(params: { stripeId: string }): Promise<T | null>;

  // Creation
  create(params: CreateParams): Promise<T>;

  // Updates
  update(params: { id: string; data: Partial<T> }): Promise<T>;

  // Soft delete
  markDeleted(params: { id: string }): Promise<void>;
}
```

### Repository Implementation Example

**BillingCustomerRepository:**

```typescript
@Injectable()
export class BillingCustomerRepository {
  async findByCompanyId(params: { companyId: string }): Promise<BillingCustomer | null> {
    const cypher = `
      MATCH (c:Company {id: $companyId})
      MATCH (c)-[:HAS_BILLING_CUSTOMER]->(bc:BillingCustomer)
      WHERE bc.deletedAt IS NULL
      RETURN bc
    `;

    const result = await this.neo4jService.runQuery(cypher, params);
    return result.records.length > 0 ? this.mapToEntity(result.records[0]) : null;
  }

  async create(params: CreateBillingCustomerParams): Promise<BillingCustomer> {
    const cypher = `
      MATCH (c:Company {id: $companyId})
      CREATE (bc:BillingCustomer {
        id: randomUUID(),
        stripeCustomerId: $stripeCustomerId,
        email: $email,
        name: $name,
        currency: $currency,
        balance: 0,
        delinquent: false,
        createdAt: datetime(),
        updatedAt: datetime()
      })
      CREATE (c)-[:HAS_BILLING_CUSTOMER]->(bc)
      RETURN bc
    `;

    const result = await this.neo4jService.runQuery(cypher, params);
    return this.mapToEntity(result.records[0]);
  }
}
```

### Query Optimization Patterns

**1. Index Usage**
```cypher
// Create indexes for common lookups
CREATE INDEX billing_customer_stripe_id FOR (bc:BillingCustomer) ON (bc.stripeCustomerId);
CREATE INDEX subscription_stripe_id FOR (s:BillingSubscription) ON (s.stripeSubscriptionId);
CREATE INDEX webhook_event_stripe_id FOR (we:WebhookEvent) ON (we.stripeEventId);
```

**2. Relationship Traversal**
```cypher
// Efficient: Start from indexed node
MATCH (bc:BillingCustomer {stripeCustomerId: $stripeId})
MATCH (bc)-[:HAS_SUBSCRIPTION]->(s:BillingSubscription)
RETURN s

// Avoid: Full table scan
MATCH (s:BillingSubscription)
WHERE s.stripeCustomerId = $stripeId
RETURN s
```

**3. Company Scoping Pattern**
```cypher
// Always start from Company for multi-tenancy
MATCH (c:Company {id: $companyId})
MATCH (c)-[:HAS_BILLING_CUSTOMER]->(bc)
MATCH (bc)-[:HAS_SUBSCRIPTION]->(s)
WHERE s.status = 'active'
RETURN s
```

---

## Webhook Processing

### Webhook Architecture

**Design Goals:**
1. Return 200 to Stripe immediately (< 1 second)
2. Process events asynchronously with retries
3. Prevent duplicate processing (idempotency)
4. Maintain audit trail of all events

### Webhook Flow Stages

**Stage 1: Receipt & Verification**
```typescript
@Post('billing/webhooks/stripe')
async handleStripeWebhook(
  @Req() req: FastifyRequest,
  @Headers('stripe-signature') signature: string,
) {
  // 1. Verify signature (throws if invalid)
  const event = this.stripeWebhookService.constructEvent(
    req.rawBody,
    signature,
  );

  // 2. Check for duplicate event
  const existing = await this.webhookEventRepository.findByStripeEventId({
    stripeEventId: event.id,
  });

  if (existing) {
    return { received: true, duplicate: true };
  }

  // 3. Store event for audit
  const webhookEvent = await this.webhookEventRepository.create({
    stripeEventId: event.id,
    eventType: event.type,
    livemode: event.livemode,
    apiVersion: event.api_version,
    payload: event.data.object,
  });

  // 4. Queue for async processing
  await this.webhookQueue.add('process-webhook', {
    webhookEventId: webhookEvent.id,
    stripeEventId: event.id,
    eventType: event.type,
    payload: event.data.object,
  }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  });

  // 5. Return immediately
  return { received: true };
}
```

**Stage 2: Async Processing**
```typescript
@Processor(`${process.env.QUEUE}_billing_webhook`)
export class WebhookProcessor {
  @Process('process-webhook')
  async handleWebhook(job: Job<WebhookJobData>) {
    const { eventType, payload } = job.data;

    switch (eventType) {
      case 'customer.subscription.updated':
        await this.handleSubscriptionUpdated(payload);
        break;

      case 'invoice.payment_failed':
        await this.handlePaymentFailed(payload);
        break;

      // ... other event handlers
    }

    // Mark webhook event as processed
    await this.webhookEventRepository.markProcessed({
      stripeEventId: job.data.stripeEventId,
    });
  }
}
```

### Supported Webhook Events

| Event Type | Handler | Neo4j Update | Notification |
|-----------|---------|--------------|--------------|
| `customer.created` | Sync customer | Create node | No |
| `customer.updated` | Sync customer | Update node | No |
| `customer.deleted` | Soft delete | Mark deleted | No |
| `customer.subscription.created` | Sync subscription | Create node | No |
| `customer.subscription.updated` | Sync subscription | Update node | Yes (if status changed) |
| `customer.subscription.deleted` | Cancel subscription | Update status | Yes |
| `invoice.created` | Sync invoice | Create node | No |
| `invoice.finalized` | Sync invoice | Update status | No |
| `invoice.paid` | Mark paid | Update status | No |
| `invoice.payment_failed` | Mark failed | Update status | Yes (retry prompt) |
| `payment_intent.succeeded` | Log success | No update | No |
| `payment_intent.payment_failed` | Log failure | No update | Yes |

---

## Idempotency Patterns

### Why Idempotency Matters

Stripe may send webhooks multiple times. Network failures may cause retries. Idempotent operations ensure:
- Duplicate events don't create duplicate records
- Retries don't cause incorrect state
- System remains consistent despite failures

### Idempotency Strategies

**1. Event ID Deduplication (Webhooks)**
```typescript
// Check if event already processed
const existing = await this.webhookEventRepository.findByStripeEventId({
  stripeEventId: event.id,
});

if (existing) {
  console.log('Event already processed, skipping');
  return { received: true, duplicate: true };
}

// Store event before processing
await this.webhookEventRepository.create({
  stripeEventId: event.id,
  eventType: event.type,
  payload: event.data.object,
  processed: false,
});
```

**2. Unique Constraints (Neo4j)**
```cypher
// Create unique constraint on stripeCustomerId
CREATE CONSTRAINT billing_customer_stripe_id_unique
FOR (bc:BillingCustomer) REQUIRE bc.stripeCustomerId IS UNIQUE;

// Upsert pattern using MERGE
MERGE (bc:BillingCustomer {stripeCustomerId: $stripeCustomerId})
ON CREATE SET
  bc.id = randomUUID(),
  bc.email = $email,
  bc.createdAt = datetime()
ON MATCH SET
  bc.email = $email,
  bc.updatedAt = datetime()
RETURN bc
```

**3. Stripe Idempotency Keys (API Calls)**
```typescript
// Generate idempotent key for Stripe API calls
const idempotencyKey = `${companyId}-subscription-${Date.now()}`;

const subscription = await this.stripe.subscriptions.create(
  {
    customer: customerId,
    items: [{ price: priceId }],
  },
  {
    idempotencyKey, // Stripe deduplicates based on this key
  }
);
```

**4. Optimistic Locking (Updates)**
```typescript
// Use version field for concurrent update detection
const cypher = `
  MATCH (s:BillingSubscription {id: $id})
  WHERE s.version = $currentVersion
  SET s.status = $newStatus,
      s.version = s.version + 1,
      s.updatedAt = datetime()
  RETURN s
`;

const result = await this.neo4jService.runQuery(cypher, params);

if (result.records.length === 0) {
  throw new ConflictException('Subscription was modified by another process');
}
```

**5. Status Transitions (State Machine)**
```typescript
// Only allow valid status transitions
const VALID_TRANSITIONS = {
  'active': ['paused', 'canceled', 'past_due'],
  'paused': ['active', 'canceled'],
  'past_due': ['active', 'canceled'],
  'canceled': [], // Terminal state
};

async updateStatus(params: { id: string; newStatus: string }) {
  const subscription = await this.findById(params.id);

  const allowedTransitions = VALID_TRANSITIONS[subscription.status];

  if (!allowedTransitions.includes(params.newStatus)) {
    throw new BadRequestException(
      `Cannot transition from ${subscription.status} to ${params.newStatus}`
    );
  }

  // Proceed with update
}
```

---

## Error Handling

### Error Handling Layers

**1. Stripe API Errors**
```typescript
// Decorator automatically transforms Stripe errors to HTTP exceptions
@Injectable()
export class StripeCustomerService {
  @HandleStripeErrors()
  async createCustomer(params: CreateCustomerParams): Promise<Stripe.Customer> {
    return this.stripe.customers.create({
      email: params.email,
      name: params.name,
      metadata: { companyId: params.companyId },
    });
  }
}

// Error transformation logic
export function HandleStripeErrors() {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      try {
        return await originalMethod.apply(this, args);
      } catch (error) {
        if (error.type === 'StripeCardError') {
          throw new PaymentRequiredException(error.message);
        } else if (error.type === 'StripeInvalidRequestError') {
          throw new BadRequestException(error.message);
        } else if (error.type === 'StripeRateLimitError') {
          throw new TooManyRequestsException('Rate limit exceeded');
        }

        throw new InternalServerErrorException('Payment processing failed');
      }
    };

    return descriptor;
  };
}
```

**2. Neo4j Transaction Errors**
```typescript
async create(params: CreateParams): Promise<Entity> {
  try {
    const result = await this.neo4jService.runQuery(cypher, params);
    return this.mapToEntity(result.records[0]);
  } catch (error) {
    if (error.code === 'Neo.ClientError.Schema.ConstraintValidationFailed') {
      throw new ConflictException('Record already exists');
    }

    this.logger.error('Neo4j query failed', error);
    throw new InternalServerErrorException('Database error');
  }
}
```

**3. Webhook Processing Errors**
```typescript
@Process('process-webhook')
async handleWebhook(job: Job<WebhookJobData>) {
  try {
    await this.processEvent(job.data);
  } catch (error) {
    this.logger.error('Webhook processing failed', {
      eventId: job.data.stripeEventId,
      eventType: job.data.eventType,
      error: error.message,
    });

    // Throw to trigger BullMQ retry
    throw error;
  }
}
```

**4. Business Logic Errors**
```typescript
async createCustomer(params: CreateCustomerParams) {
  // Validate company exists
  const company = await this.companyRepository.findById(params.companyId);
  if (!company) {
    throw new NotFoundException(`Company ${params.companyId} not found`);
  }

  // Check for existing customer
  const existing = await this.billingCustomerRepository.findByCompanyId({
    companyId: params.companyId,
  });

  if (existing) {
    throw new ConflictException('Billing customer already exists for this company');
  }

  // Proceed with creation...
}
```

---

## Security Considerations

### 1. Webhook Signature Verification

**Always verify Stripe signatures:**
```typescript
const event = this.stripeWebhookService.constructEvent(
  req.rawBody,        // Raw Buffer (NOT parsed JSON)
  signature,          // stripe-signature header
);

// If signature is invalid, throws error automatically
```

### 2. Company Scoping (Multi-Tenancy)

**All queries MUST filter by companyId:**
```typescript
// CORRECT: Company-scoped query
const customer = await this.billingCustomerRepository.findByCompanyId({
  companyId: req.user.companyId,
});

// INCORRECT: Cross-tenant data leak
const customer = await this.billingCustomerRepository.findByStripeId({
  stripeCustomerId: req.params.customerId,
});
```

### 3. Stripe API Key Protection

**Use environment-specific keys:**
```typescript
// Development
STRIPE_SECRET_KEY=sk_test_51...
STRIPE_WEBHOOK_SECRET=whsec_test_...

// Production
STRIPE_SECRET_KEY=sk_live_51...
STRIPE_WEBHOOK_SECRET=whsec_...
```

### 4. PCI Compliance

**Never store sensitive payment data:**
- ❌ Credit card numbers
- ❌ CVV codes
- ❌ Expiration dates
- ✅ Payment method IDs (Stripe tokens)
- ✅ Customer IDs
- ✅ Invoice details

### 5. Soft Deletes (Data Retention)

**Never hard-delete billing data:**
```typescript
// Mark as deleted with timestamp
async markDeleted(params: { id: string }) {
  const cypher = `
    MATCH (bc:BillingCustomer {id: $id})
    SET bc.deletedAt = datetime()
    RETURN bc
  `;

  await this.neo4jService.runQuery(cypher, params);
}

// Exclude deleted records in queries
async findByCompanyId(params: { companyId: string }) {
  const cypher = `
    MATCH (c:Company {id: $companyId})
    MATCH (c)-[:HAS_BILLING_CUSTOMER]->(bc:BillingCustomer)
    WHERE bc.deletedAt IS NULL
    RETURN bc
  `;

  // ...
}
```

---

## See Also

- [API Reference](API.md) - Complete API documentation
- [Testing Guide](TESTING.md) - Testing patterns and utilities
- [Webhook Guide](WEBHOOKS.md) - Webhook implementation guide
- [Examples](EXAMPLES.md) - Real-world usage examples
- [Main README](../README.md) - Module overview
