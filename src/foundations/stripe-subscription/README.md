# Stripe Subscription Module

Provides subscription management functionality for the Stripe billing system. Handles subscription lifecycle including creation, updates, cancellations, pausing/resuming, and plan changes with proration.

## Features

- **Create subscriptions** with optional trial periods and custom quantities
- **Cancel subscriptions** (immediately or at period end)
- **Pause and resume subscriptions**
- **Change subscription plans** with automatic proration
- **Preview proration amounts** before making changes
- **Sync subscription data** from Stripe webhooks
- **Filter subscriptions** by status (active, canceled, past_due, etc.)

## Architecture

The module follows a layered architecture:

### Services

- **StripeSubscriptionApiService**: Direct Stripe API operations (create, update, cancel, etc.)
- **StripeSubscriptionAdminService**: Business logic and coordination between Stripe and database

### Repository

- **StripeSubscriptionRepository**: Neo4j database operations for subscription data persistence

### Controller

- **StripeSubscriptionController**: REST API endpoints for subscription management

### Entities

- **StripeSubscription**: Subscription entity with full lifecycle data
- **StripeSubscriptionStatus**: Status enum (active, canceled, past_due, etc.)

## Usage

### Importing the Module

```typescript
import { StripeSubscriptionModule } from "@/foundations/stripe-subscription";

@Module({
  imports: [StripeSubscriptionModule],
})
export class YourModule {}
```

### Creating a Subscription

```typescript
import { StripeSubscriptionAdminService } from "@/foundations/stripe-subscription";

@Injectable()
export class YourService {
  constructor(private readonly subscriptionService: StripeSubscriptionAdminService) {}

  async createSubscription() {
    return this.subscriptionService.createSubscription({
      companyId: "company_123",
      priceId: "price_456",
      paymentMethodId: "pm_789",
      trialPeriodDays: 14,
      quantity: 1,
    });
  }
}
```

### Canceling a Subscription

```typescript
// Cancel at end of billing period
await subscriptionService.cancelSubscription({
  id: "sub_123",
  companyId: "company_123",
  cancelImmediately: false,
});

// Cancel immediately
await subscriptionService.cancelSubscription({
  id: "sub_123",
  companyId: "company_123",
  cancelImmediately: true,
});
```

### Changing Subscription Plan

```typescript
await subscriptionService.changePlan({
  id: "sub_123",
  companyId: "company_123",
  newPriceId: "price_premium",
});
```

### Previewing Proration

```typescript
const preview = await subscriptionService.previewProration({
  id: "sub_123",
  companyId: "company_123",
  newPriceId: "price_premium",
});

console.info(`Proration amount: ${preview.amountDue}`);
```

## API Endpoints

All endpoints are prefixed with `/billing`:

- `GET /billing/subscriptions` - List subscriptions for a company
- `GET /billing/subscriptions/:subscriptionId` - Get single subscription
- `POST /billing/subscriptions` - Create new subscription
- `POST /billing/subscriptions/:subscriptionId/cancel` - Cancel subscription
- `POST /billing/subscriptions/:subscriptionId/pause` - Pause subscription
- `POST /billing/subscriptions/:subscriptionId/resume` - Resume paused subscription
- `POST /billing/subscriptions/:subscriptionId/change-plan` - Change subscription plan
- `GET /billing/subscriptions/:subscriptionId/proration-preview` - Preview proration for plan change

## Dependencies

- **StripePriceModule**: For price validation and lookups
- **StripeModule**: For Stripe API client and billing customer operations
- **Neo4jModule**: For database operations
- **JsonApiModule**: For JSON:API serialization

## Webhook Integration

The module automatically syncs subscription data from Stripe webhooks:

```typescript
// Handled automatically by WebhookProcessor
case "customer.subscription.created":
case "customer.subscription.updated":
case "customer.subscription.deleted":
  await subscriptionService.syncSubscriptionFromStripe({
    stripeSubscriptionId: subscription.id
  });
```

## Database Schema

Subscriptions are stored in Neo4j with the following relationships:

```
(Subscription:Subscription)
  -[:BELONGS_TO]->(BillingCustomer:BillingCustomer)
  -[:USES_PRICE]->(StripePrice:StripePrice)
    -[:BELONGS_TO]->(StripeProduct:StripeProduct)
```

## Testing

Run the test suite:

```bash
pnpm --filter @carlonicora/nestjs-neo4jsonapi test stripe-subscription
```

## Migration from Stripe Module

This module was extracted from the Stripe foundation module for better separation of concerns. Update your imports:

**Before:**

```typescript
import { SubscriptionService } from "@/foundations/stripe/services/subscription.service";
import { StripeSubscriptionService } from "@/foundations/stripe/services/stripe.subscription.service";
```

**After:**

```typescript
import { StripeSubscriptionAdminService, StripeSubscriptionApiService } from "@/foundations/stripe-subscription";
```
