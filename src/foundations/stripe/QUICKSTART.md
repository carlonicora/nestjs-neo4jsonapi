# Quick Start Guide - Stripe Billing Foundation

Get up and running with the Stripe Billing Foundation in 10 minutes.

## Prerequisites

- NestJS application
- Stripe account ([sign up here](https://dashboard.stripe.com/register))
- Neo4j database
- Redis instance

---

## Step 1: Install & Configure (2 minutes)

### Install Dependencies

```bash
pnpm add @carlonicora/nestjs-neo4jsonapi stripe @nestjs/bullmq bullmq
```

### Add Environment Variables

```bash
# .env
STRIPE_SECRET_KEY=sk_test_51...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_API_VERSION=2024-11-20.acacia

NEO4J_URI=bolt://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=password

REDIS_HOST=localhost
REDIS_PORT=6379
QUEUE=myapp

APP_URL=http://localhost:3000
```

---

## Step 2: Import Module (1 minute)

```typescript
// app.module.ts
import { Module } from "@nestjs/common";
import { StripeModule } from "@carlonicora/nestjs-neo4jsonapi";

@Module({
  imports: [
    StripeModule, // ✅ That's it!
  ],
})
export class AppModule {}
```

---

## Step 3: Set Up Stripe Webhook (2 minutes)

### Option A: Using Stripe CLI (for local development)

```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Login
stripe login

# Forward webhooks to your local server
stripe listen --forward-to http://localhost:3000/billing/webhooks/stripe
```

Copy the webhook signing secret from the CLI output:

```
> Ready! Your webhook signing secret is whsec_xxxxxxxxxxxxx
```

### Option B: Using Stripe Dashboard (for production)

1. Go to [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks)
2. Click **Add Endpoint**
3. Enter URL: `https://yourdomain.com/billing/webhooks/stripe`
4. Select events:
   - ✅ `customer.created`, `customer.updated`, `customer.deleted`
   - ✅ `subscription.created`, `subscription.updated`, `subscription.deleted`
   - ✅ `invoice.created`, `invoice.paid`, `invoice.payment_failed`
   - ✅ `payment_intent.succeeded`, `payment_intent.payment_failed`
5. Copy the **Signing secret** to `.env`

---

## Step 4: Create Your First Customer (2 minutes)

```typescript
// your-onboarding.service.ts
import { Injectable } from "@nestjs/common";
import { BillingService } from "@carlonicora/nestjs-neo4jsonapi";

@Injectable()
export class OnboardingService {
  constructor(private readonly billingService: BillingService) {}

  async onboardNewUser(companyId: string, email: string, name: string) {
    // Create Stripe customer + Neo4j record
    const customer = await this.billingService.createCustomer({
      companyId,
      email,
      name,
      currency: "usd",
    });

    console.info("Customer created:", customer.data.id);
    return customer;
  }
}
```

---

## Step 5: Test It! (3 minutes)

### Test Customer Creation

```bash
# Start your app
pnpm start:dev

# In another terminal, make a request
curl -X POST http://localhost:3000/billing/customer \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Customer",
    "email": "test@example.com",
    "currency": "usd"
  }'
```

**Expected Response:**

```json
{
  "data": {
    "type": "billing-customers",
    "id": "customer_123",
    "attributes": {
      "stripeCustomerId": "cus_...",
      "email": "test@example.com",
      "name": "Test Customer",
      "currency": "usd",
      "balance": 0,
      "delinquent": false
    }
  }
}
```

### Test Webhook Processing

Trigger a test webhook:

```bash
stripe trigger customer.created
```

**Check logs** for:

```
[WebhookController] Webhook event queued: customer.created (evt_...)
[WebhookProcessor] Processing webhook event: customer.created
[WebhookProcessor] Successfully processed webhook event: customer.created
```

**Verify in Neo4j:**

```cypher
MATCH (bc:BillingCustomer)
RETURN bc
LIMIT 5;
```

---

## Common Use Cases

### 1. Create Customer with Payment Method

```typescript
async createCustomerWithPayment(companyId: string, paymentMethodId: string) {
  // 1. Create customer
  const customer = await this.billingService.createCustomer({
    companyId,
    email: 'user@example.com',
    name: 'User Name',
    currency: 'usd',
  });

  // 2. Set default payment method
  await this.billingService.setDefaultPaymentMethod({
    companyId,
    paymentMethodId,
  });

  return customer;
}
```

### 2. Subscribe to a Plan

```typescript
async subscribeToPlan(companyId: string, priceId: string) {
  const subscription = await this.subscriptionService.createSubscription({
    companyId,
    priceId,
    paymentMethodId: 'pm_...', // Must already be attached to customer
    trialPeriodDays: 14, // Optional trial
  });

  return subscription;
}
```

### 3. Report Usage (Metered Billing)

```typescript
async trackApiCall(companyId: string, subscriptionId: string) {
  await this.usageService.reportUsage({
    companyId,
    subscriptionId,
    meterId: 'meter_api_calls',
    meterEventName: 'api_call',
    quantity: 1,
  });
}
```

### 4. Handle Payment Failure

Webhooks automatically handle payment failures and send emails. You can also check manually:

```typescript
async checkPaymentStatus(companyId: string) {
  const invoices = await this.invoiceService.listInvoices({
    companyId,
    status: 'open', // Unpaid invoices
  });

  return invoices;
}
```

---

## Frontend Integration

### Collect Payment Method (React Example)

```tsx
import { loadStripe } from "@stripe/stripe-js";
import { Elements, CardElement, useStripe, useElements } from "@stripe/react-stripe-js";

const stripePromise = loadStripe("pk_test_...");

function PaymentForm() {
  const stripe = useStripe();
  const elements = useElements();

  const handleSubmit = async (e) => {
    e.preventDefault();

    // 1. Get setup intent from your backend
    const { clientSecret } = await fetch("/billing/setup-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }).then((r) => r.json());

    // 2. Confirm setup with Stripe
    const { setupIntent, error } = await stripe.confirmCardSetup(clientSecret, {
      payment_method: {
        card: elements.getElement(CardElement),
      },
    });

    if (error) {
      console.error(error);
    } else {
      // 3. Payment method collected! Use setupIntent.payment_method
      console.info("Payment method:", setupIntent.payment_method);

      // 4. Create subscription
      await fetch("/billing/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          priceId: "price_...",
          paymentMethodId: setupIntent.payment_method,
        }),
      });
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <CardElement />
      <button type="submit" disabled={!stripe}>
        Subscribe
      </button>
    </form>
  );
}

export default function App() {
  return (
    <Elements stripe={stripePromise}>
      <PaymentForm />
    </Elements>
  );
}
```

### Stripe Customer Portal

Let customers manage their own billing:

```typescript
// Backend endpoint
@Post('customer/portal-session')
async createPortalSession(@Req() req: AuthenticatedRequest) {
  const { url } = await this.billingService.createPortalSession({
    companyId: req.user.companyId,
    returnUrl: `${process.env.APP_URL}/billing`,
  });

  return { url };
}
```

```tsx
// Frontend button
function ManageBillingButton() {
  const handleClick = async () => {
    const { url } = await fetch("/billing/customer/portal-session", {
      method: "POST",
    }).then((r) => r.json());

    window.location.href = url; // Redirect to Stripe portal
  };

  return <button onClick={handleClick}>Manage Billing</button>;
}
```

---

## Testing Checklist

- [ ] Customer creation works
- [ ] Subscription creation works
- [ ] Webhooks are received and processed
- [ ] Jobs appear in BullMQ queue
- [ ] Data appears in Neo4j
- [ ] Email notifications are queued
- [ ] Payment failures trigger notifications
- [ ] Stripe Dashboard shows events

---

## Next Steps

- Read the [full documentation](./README.md)
- Explore [API reference](./README.md#api-reference)
- Set up [email templates](./README.md#email-notifications)
- Configure [production deployment](./README.md#deployment)
- Add [monitoring and alerts](./README.md#monitoring--logging)

---

## Troubleshooting

### "Webhook signature verification failed"

- ✅ Check `STRIPE_WEBHOOK_SECRET` is correct
- ✅ Verify raw body is preserved (use `@fastify/raw-body`)
- ✅ Test with Stripe CLI: `stripe listen --forward-to localhost:3000/billing/webhooks/stripe`

### "Customer already exists"

- ✅ Expected behavior - one customer per company
- ✅ Use `GET /billing/customer` to retrieve existing customer

### "Jobs not processing"

- ✅ Verify Redis is running: `redis-cli ping`
- ✅ Check queue name matches: `${process.env.QUEUE}_billing_webhook`
- ✅ Look for `WebhookProcessor` in startup logs

### "Neo4j connection error"

- ✅ Verify Neo4j is running: `http://localhost:7474`
- ✅ Check credentials in `.env`
- ✅ Use bolt protocol: `bolt://localhost:7687`

---

## Support

- 📖 [Full Documentation](./README.md)
- 🐛 [Report Issues](https://github.com/your-org/nestjs-neo4jsonapi/issues)
- 📧 [Contact Support](mailto:support@yourdomain.com)
