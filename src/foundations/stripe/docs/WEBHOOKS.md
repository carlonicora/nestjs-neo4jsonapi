# Stripe Webhooks Implementation Guide

Complete guide for implementing Stripe webhooks in your NestJS application.

## Table of Contents

- [Overview](#overview)
- [Setup and Configuration](#setup-and-configuration)
- [Endpoint Implementation](#endpoint-implementation)
- [Event Verification](#event-verification)
- [Event Handling Patterns](#event-handling-patterns)
- [Database Synchronization](#database-synchronization)
- [Idempotency](#idempotency)
- [Security Best Practices](#security-best-practices)
- [Testing Webhooks](#testing-webhooks)
- [Common Event Types](#common-event-types)
- [Troubleshooting](#troubleshooting)

---

## Overview

Webhooks allow Stripe to notify your application about events that happen in your Stripe account. This is essential for:

- Keeping your database in sync with Stripe
- Handling subscription lifecycle events
- Processing payment confirmations
- Managing failed payments
- Responding to disputes and chargebacks

**Why Webhooks?**

- Real-time updates (no polling required)
- Guaranteed delivery (Stripe retries failed webhooks)
- Server-side processing (more secure than client-side)
- Access to events you can't capture client-side

---

## Setup and Configuration

### 1. Environment Variables

Add your webhook secret to `.env`:

```bash
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_signing_secret
```

### 2. Create Webhook Endpoint in Stripe

**Development (using Stripe CLI):**

```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Login to your Stripe account
stripe login

# Forward webhooks to your local server
stripe listen --forward-to localhost:3000/webhooks/stripe

# Copy the webhook signing secret from the output
# whsec_... and add it to your .env file
```

**Production:**

1. Go to [Stripe Dashboard → Developers → Webhooks](https://dashboard.stripe.com/webhooks)
2. Click "Add endpoint"
3. Enter your endpoint URL: `https://yourdomain.com/webhooks/stripe`
4. Select events to listen to (or select "Send all events" for development)
5. Copy the webhook signing secret

### 3. Enable Raw Body in NestJS

Stripe requires the raw request body for signature verification.

**main.ts:**

```typescript
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { json } from "express";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true, // Enable raw body for webhook verification
  });

  // Use JSON middleware for all routes except webhooks
  app.use((req, res, next) => {
    if (req.originalUrl === "/webhooks/stripe") {
      next();
    } else {
      json()(req, res, next);
    }
  });

  await app.listen(3000);
}
bootstrap();
```

---

## Endpoint Implementation

### Basic Webhook Controller

```typescript
import { Controller, Post, Headers, RawBodyRequest, Req, HttpCode } from "@nestjs/common";
import { StripeWebhookService } from "./core/stripe/services/stripe.webhook.service";
import Stripe from "stripe";

@Controller("webhooks")
export class WebhookController {
  constructor(private readonly stripeWebhook: StripeWebhookService) {}

  @Post("stripe")
  @HttpCode(200)
  async handleStripeWebhook(@Req() req: RawBodyRequest<Request>, @Headers("stripe-signature") signature: string) {
    // Verify and construct event
    const event = this.stripeWebhook.constructEvent(req.rawBody, signature);

    console.info(`Received webhook: ${event.type}`);

    // Route to appropriate handler
    try {
      await this.handleEvent(event);
      return { received: true };
    } catch (error) {
      console.error("Webhook handler error:", error);
      // Return 200 to acknowledge receipt even if handler fails
      // (prevents Stripe from retrying indefinitely)
      return { received: true, error: error.message };
    }
  }

  private async handleEvent(event: Stripe.Event) {
    if (this.stripeWebhook.isSubscriptionEvent(event.type)) {
      await this.handleSubscriptionEvent(event);
    } else if (this.stripeWebhook.isInvoiceEvent(event.type)) {
      await this.handleInvoiceEvent(event);
    } else if (this.stripeWebhook.isPaymentEvent(event.type)) {
      await this.handlePaymentEvent(event);
    } else if (this.stripeWebhook.isCustomerEvent(event.type)) {
      await this.handleCustomerEvent(event);
    } else {
      console.info(`Unhandled event type: ${event.type}`);
    }
  }

  private async handleSubscriptionEvent(event: Stripe.Event) {
    const subscription = event.data.object as Stripe.Subscription;

    switch (event.type) {
      case "customer.subscription.created":
        console.info("Subscription created:", subscription.id);
        // Update database with new subscription
        break;

      case "customer.subscription.updated":
        console.info("Subscription updated:", subscription.id);
        // Update database with subscription changes
        break;

      case "customer.subscription.deleted":
        console.info("Subscription canceled:", subscription.id);
        // Mark subscription as canceled in database
        break;

      default:
        console.info(`Unhandled subscription event: ${event.type}`);
    }
  }

  private async handleInvoiceEvent(event: Stripe.Event) {
    const invoice = event.data.object as Stripe.Invoice;

    switch (event.type) {
      case "invoice.paid":
        console.info("Invoice paid:", invoice.id);
        // Update database, grant access, send receipt
        break;

      case "invoice.payment_failed":
        console.info("Invoice payment failed:", invoice.id);
        // Send payment failed notification, suspend account
        break;

      case "invoice.finalized":
        console.info("Invoice finalized:", invoice.id);
        // Invoice is ready to be paid
        break;

      default:
        console.info(`Unhandled invoice event: ${event.type}`);
    }
  }

  private async handlePaymentEvent(event: Stripe.Event) {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;

    switch (event.type) {
      case "payment_intent.succeeded":
        console.info("Payment succeeded:", paymentIntent.id);
        // Fulfill order, update database
        break;

      case "payment_intent.payment_failed":
        console.info("Payment failed:", paymentIntent.id);
        // Notify customer, retry payment
        break;

      default:
        console.info(`Unhandled payment event: ${event.type}`);
    }
  }

  private async handleCustomerEvent(event: Stripe.Event) {
    const customer = event.data.object as Stripe.Customer;

    switch (event.type) {
      case "customer.created":
        console.info("Customer created:", customer.id);
        break;

      case "customer.updated":
        console.info("Customer updated:", customer.id);
        // Sync customer data to database
        break;

      case "customer.deleted":
        console.info("Customer deleted:", customer.id);
        // Remove customer from database
        break;

      default:
        console.info(`Unhandled customer event: ${event.type}`);
    }
  }
}
```

---

## Event Verification

### Why Verify?

Event verification ensures that:

- The webhook came from Stripe (not a malicious actor)
- The payload hasn't been tampered with
- You're processing the exact data Stripe sent

### How It Works

Stripe signs each webhook with a secret key and includes the signature in the `stripe-signature` header.

**Automatic Verification:**

```typescript
// The StripeWebhookService.constructEvent() method automatically verifies
const event = this.stripeWebhook.constructEvent(
  req.rawBody, // Raw request body (Buffer)
  signature, // Stripe-Signature header
);

// If verification fails, an error is thrown
```

### Manual Verification (if needed)

```typescript
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

try {
  const event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);

  // Event is verified - safe to process
} catch (err) {
  console.error("Webhook signature verification failed:", err.message);
  // Return 400 to reject the webhook
  throw new BadRequestException("Invalid signature");
}
```

---

## Event Handling Patterns

### Pattern 1: Event Router

Organize event handling by routing to specialized services.

```typescript
@Injectable()
export class WebhookEventRouter {
  constructor(
    private readonly subscriptionSync: SubscriptionSyncService,
    private readonly invoiceSync: InvoiceSyncService,
    private readonly paymentSync: PaymentSyncService,
  ) {}

  async route(event: Stripe.Event) {
    const handlers = {
      "customer.subscription.created": () => this.subscriptionSync.handleCreated(event),
      "customer.subscription.updated": () => this.subscriptionSync.handleUpdated(event),
      "customer.subscription.deleted": () => this.subscriptionSync.handleDeleted(event),
      "invoice.paid": () => this.invoiceSync.handlePaid(event),
      "invoice.payment_failed": () => this.invoiceSync.handleFailed(event),
      "payment_intent.succeeded": () => this.paymentSync.handleSucceeded(event),
    };

    const handler = handlers[event.type];
    if (handler) {
      await handler();
    } else {
      console.info(`No handler for event type: ${event.type}`);
    }
  }
}
```

### Pattern 2: Event Queue

Process webhooks asynchronously using a job queue (BullMQ, etc.).

```typescript
@Injectable()
export class WebhookQueueService {
  constructor(@InjectQueue("webhooks") private readonly webhookQueue: Queue) {}

  async queueEvent(event: Stripe.Event) {
    await this.webhookQueue.add(
      "process-webhook",
      {
        eventId: event.id,
        eventType: event.type,
        eventData: event.data.object,
      },
      {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 2000,
        },
      },
    );
  }
}

@Processor("webhooks")
export class WebhookProcessor {
  @Process("process-webhook")
  async handleWebhook(job: Job) {
    const { eventType, eventData } = job.data;

    // Process webhook asynchronously
    console.info(`Processing webhook: ${eventType}`);

    // Your processing logic here
  }
}
```

### Pattern 3: Event Sourcing

Store all webhook events for audit trail and replay capability.

```typescript
@Injectable()
export class WebhookEventStore {
  constructor(
    @InjectRepository(WebhookEvent)
    private readonly eventRepo: Repository<WebhookEvent>,
  ) {}

  async storeEvent(event: Stripe.Event) {
    const webhookEvent = this.eventRepo.create({
      stripeEventId: event.id,
      type: event.type,
      payload: event,
      processed: false,
      receivedAt: new Date(),
    });

    await this.eventRepo.save(webhookEvent);
    return webhookEvent;
  }

  async markProcessed(eventId: string) {
    await this.eventRepo.update({ stripeEventId: eventId }, { processed: true, processedAt: new Date() });
  }
}
```

---

## Database Synchronization

### Subscription Sync Example

```typescript
@Injectable()
export class SubscriptionSyncService {
  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,
  ) {}

  async handleCreated(event: Stripe.Event) {
    const stripeSubscription = event.data.object as Stripe.Subscription;

    // Find associated company by customer ID
    const company = await this.findCompanyByStripeCustomerId(stripeSubscription.customer as string);

    if (!company) {
      console.error("Company not found for customer:", stripeSubscription.customer);
      return;
    }

    // Create subscription record
    const subscription = this.subscriptionRepo.create({
      companyId: company.id,
      stripeSubscriptionId: stripeSubscription.id,
      status: stripeSubscription.status,
      currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
      currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
      cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
      trialEnd: stripeSubscription.trial_end ? new Date(stripeSubscription.trial_end * 1000) : null,
    });

    await this.subscriptionRepo.save(subscription);
    console.info("Subscription synced:", subscription.id);
  }

  async handleUpdated(event: Stripe.Event) {
    const stripeSubscription = event.data.object as Stripe.Subscription;

    // Update existing subscription
    await this.subscriptionRepo.update(
      { stripeSubscriptionId: stripeSubscription.id },
      {
        status: stripeSubscription.status,
        currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
        currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
        cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
      },
    );

    console.info("Subscription updated:", stripeSubscription.id);
  }

  async handleDeleted(event: Stripe.Event) {
    const stripeSubscription = event.data.object as Stripe.Subscription;

    // Mark as canceled (don't delete - keep history)
    await this.subscriptionRepo.update(
      { stripeSubscriptionId: stripeSubscription.id },
      {
        status: "canceled",
        canceledAt: new Date(),
      },
    );

    console.info("Subscription canceled:", stripeSubscription.id);
  }

  private async findCompanyByStripeCustomerId(customerId: string) {
    // Your logic to find company by Stripe customer ID
    return null;
  }
}
```

---

## Idempotency

### Why Idempotency?

Stripe may send the same webhook multiple times. Your handlers must be idempotent (safe to process multiple times).

### Implementation Strategies

**Strategy 1: Event ID Deduplication**

```typescript
@Injectable()
export class IdempotentWebhookHandler {
  constructor(
    @InjectRepository(ProcessedWebhook)
    private readonly processedRepo: Repository<ProcessedWebhook>,
  ) {}

  async handleEvent(event: Stripe.Event, handler: () => Promise<void>) {
    // Check if already processed
    const existing = await this.processedRepo.findOne({
      where: { stripeEventId: event.id },
    });

    if (existing) {
      console.info(`Event already processed: ${event.id}`);
      return;
    }

    // Process event
    await handler();

    // Mark as processed
    await this.processedRepo.save({
      stripeEventId: event.id,
      eventType: event.type,
      processedAt: new Date(),
    });
  }
}
```

**Strategy 2: Database Constraints**

```typescript
// Use unique constraints in your database
@Entity()
export class Subscription {
  @Column({ unique: true })
  stripeSubscriptionId: string;

  // When syncing, use upsert operations
}

// Upsert example
await this.subscriptionRepo.upsert(
  {
    stripeSubscriptionId: subscription.id,
    status: subscription.status,
    // ... other fields
  },
  ["stripeSubscriptionId"], // Conflict target
);
```

**Strategy 3: Optimistic Locking**

```typescript
@Entity()
export class Subscription {
  @VersionColumn()
  version: number;

  // Update with version check
}

try {
  await this.subscriptionRepo.update(
    { id: subscription.id, version: currentVersion },
    { status: "active", version: currentVersion + 1 },
  );
} catch (error) {
  // Handle optimistic lock failure
  console.info("Concurrent update detected");
}
```

---

## Security Best Practices

### 1. Always Verify Signatures

```typescript
// GOOD: Verify signature
const event = this.stripeWebhook.constructEvent(rawBody, signature);

// BAD: Trust payload without verification
const event = JSON.parse(req.body); // DON'T DO THIS
```

### 2. Use HTTPS in Production

```typescript
// Stripe webhook endpoint URL must use HTTPS
https://yourdomain.com/webhooks/stripe  // ✅ Good
http://yourdomain.com/webhooks/stripe   // ❌ Bad
```

### 3. Keep Webhook Secret Secure

```typescript
// Store in environment variables, not in code
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

// Use secrets manager in production
const webhookSecret = await secretsManager.getSecret("stripe-webhook-secret");
```

### 4. Return 200 Quickly

```typescript
@Post('stripe')
@HttpCode(200)
async handleWebhook(@Req() req, @Headers('stripe-signature') sig: string) {
  const event = this.stripeWebhook.constructEvent(req.rawBody, sig);

  // Queue for async processing
  await this.webhookQueue.add(event);

  // Return immediately
  return { received: true };
}
```

### 5. Log Everything

```typescript
async handleEvent(event: Stripe.Event) {
  console.info('Webhook received:', {
    eventId: event.id,
    eventType: event.type,
    created: new Date(event.created * 1000),
  });

  try {
    await this.processEvent(event);
    console.info('Webhook processed successfully:', event.id);
  } catch (error) {
    console.error('Webhook processing failed:', {
      eventId: event.id,
      error: error.message,
      stack: error.stack,
    });
  }
}
```

---

## Testing Webhooks

### Local Testing with Stripe CLI

```bash
# Start webhook forwarding
stripe listen --forward-to localhost:3000/webhooks/stripe

# Trigger specific events
stripe trigger payment_intent.succeeded
stripe trigger customer.subscription.created
stripe trigger invoice.payment_failed

# Trigger event with specific data
stripe trigger customer.subscription.created \
  --override customer="cus_test_123"
```

### Unit Testing

```typescript
import { Test } from "@nestjs/testing";
import { WebhookController } from "./webhook.controller";
import { StripeWebhookService } from "./stripe.webhook.service";
import { MOCK_WEBHOOK_EVENT } from "./stripe/__tests__/fixtures/stripe.fixtures";

describe("WebhookController", () => {
  let controller: WebhookController;
  let webhookService: StripeWebhookService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [WebhookController],
      providers: [
        {
          provide: StripeWebhookService,
          useValue: {
            constructEvent: jest.fn().mockReturnValue(MOCK_WEBHOOK_EVENT),
            isSubscriptionEvent: jest.fn().mockReturnValue(true),
          },
        },
      ],
    }).compile();

    controller = module.get(WebhookController);
    webhookService = module.get(StripeWebhookService);
  });

  it("should handle subscription.created webhook", async () => {
    const mockEvent = {
      ...MOCK_WEBHOOK_EVENT,
      type: "customer.subscription.created",
    };

    jest.spyOn(webhookService, "constructEvent").mockReturnValue(mockEvent);

    const result = await controller.handleStripeWebhook({ rawBody: Buffer.from("{}") } as any, "test_signature");

    expect(result).toEqual({ received: true });
    expect(webhookService.constructEvent).toHaveBeenCalled();
  });
});
```

---

## Common Event Types

### Subscription Events

| Event Type                             | Description              | Action                          |
| -------------------------------------- | ------------------------ | ------------------------------- |
| `customer.subscription.created`        | New subscription created | Create subscription record      |
| `customer.subscription.updated`        | Subscription changed     | Update subscription details     |
| `customer.subscription.deleted`        | Subscription canceled    | Mark as canceled, revoke access |
| `customer.subscription.paused`         | Subscription paused      | Suspend service                 |
| `customer.subscription.resumed`        | Subscription resumed     | Restore service                 |
| `customer.subscription.trial_will_end` | Trial ending in 3 days   | Send reminder email             |

### Invoice Events

| Event Type                        | Description        | Action                     |
| --------------------------------- | ------------------ | -------------------------- |
| `invoice.created`                 | Invoice generated  | Preview upcoming charge    |
| `invoice.finalized`               | Invoice finalized  | Invoice ready for payment  |
| `invoice.paid`                    | Payment succeeded  | Grant access, send receipt |
| `invoice.payment_failed`          | Payment failed     | Send notice, retry payment |
| `invoice.payment_action_required` | 3D Secure required | Notify customer            |

### Payment Events

| Event Type                      | Description            | Action           |
| ------------------------------- | ---------------------- | ---------------- |
| `payment_intent.succeeded`      | Payment successful     | Fulfill order    |
| `payment_intent.payment_failed` | Payment failed         | Notify customer  |
| `payment_intent.canceled`       | Payment canceled       | Cancel order     |
| `payment_method.attached`       | Payment method added   | Update default   |
| `payment_method.detached`       | Payment method removed | Clean up records |

### Customer Events

| Event Type         | Description           | Action           |
| ------------------ | --------------------- | ---------------- |
| `customer.created` | New customer          | Sync to database |
| `customer.updated` | Customer info changed | Update database  |
| `customer.deleted` | Customer removed      | Archive data     |

---

## Troubleshooting

### Webhook Not Receiving Events

**Check:**

1. Endpoint is accessible (use `curl` or Postman)
2. Webhook is configured in Stripe Dashboard
3. Events are selected in webhook settings
4. Firewall allows Stripe IPs
5. SSL certificate is valid (for HTTPS)

### Signature Verification Failing

**Common Causes:**

```typescript
// Wrong: Parsed body (JSON object)
const event = this.stripeWebhook.constructEvent(req.body, signature);

// Right: Raw body (Buffer)
const event = this.stripeWebhook.constructEvent(req.rawBody, signature);
```

### Events Processing Multiple Times

**Solution: Implement idempotency**

```typescript
// Check if event already processed
const processed = await this.isEventProcessed(event.id);
if (processed) {
  console.info("Event already processed:", event.id);
  return;
}

// Process and mark as done
await this.handleEvent(event);
await this.markEventProcessed(event.id);
```

### Missing Events

**Use event retrieval API:**

```typescript
const stripe = this.stripeService.getClient();

// Retrieve specific event
const event = await stripe.events.retrieve("evt_123");

// List recent events
const events = await stripe.events.list({ limit: 100 });
```

---

## See Also

- [API Reference](API.md) - Complete API documentation
- [Examples](EXAMPLES.md) - Real-world usage examples
- [Testing Guide](TESTING.md) - Testing patterns and utilities
- [Main README](../README.md) - Module overview
- [Stripe Webhook Documentation](https://stripe.com/docs/webhooks)
