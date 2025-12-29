# Stripe Module Examples

Real-world integration examples and workflows for common use cases.

## Table of Contents

- [Complete Subscription Signup Flow](#complete-subscription-signup-flow)
- [Metered Billing Workflow](#metered-billing-workflow)
- [One-Time Payment Collection](#one-time-payment-collection)
- [Subscription Management](#subscription-management)
- [Customer Portal Integration](#customer-portal-integration)
- [Handling Failed Payments](#handling-failed-payments)
- [Usage Tracking and Reporting](#usage-tracking-and-reporting)
- [Multi-Plan Subscription System](#multi-plan-subscription-system)

---

## Complete Subscription Signup Flow

Complete example of signing up a new customer with a subscription.

```typescript
import { Injectable } from '@nestjs/common';
import { StripeCustomerService } from './core/stripe/services/stripe.customer.service';
import { StripeSubscriptionService } from './core/stripe/services/stripe.subscription.service';
import { StripeError } from './core/stripe/errors/stripe.errors';

@Injectable()
export class SubscriptionSignupService {
  constructor(
    private readonly stripeCustomer: StripeCustomerService,
    private readonly stripeSubscription: StripeSubscriptionService,
  ) {}

  async completeSignup(params: {
    companyId: string;
    email: string;
    name: string;
    paymentMethodId: string;
    priceId: string;
    trialDays?: number;
  }) {
    try {
      // Step 1: Create Stripe customer
      console.log('Creating Stripe customer...');
      const customer = await this.stripeCustomer.createCustomer({
        companyId: params.companyId,
        email: params.email,
        name: params.name,
        metadata: {
          signupSource: 'web',
          signupDate: new Date().toISOString(),
        },
      });

      console.log('Customer created:', customer.id);

      // Step 2: Attach and set payment method as default
      console.log('Attaching payment method...');
      await this.stripeCustomer.attachPaymentMethod({
        stripeCustomerId: customer.id,
        paymentMethodId: params.paymentMethodId,
        setAsDefault: true,
      });

      console.log('Payment method attached');

      // Step 3: Create subscription with optional trial
      console.log('Creating subscription...');
      const subscription = await this.stripeSubscription.createSubscription({
        stripeCustomerId: customer.id,
        priceId: params.priceId,
        paymentMethodId: params.paymentMethodId,
        trialPeriodDays: params.trialDays || 14,
        metadata: {
          companyId: params.companyId,
          planType: 'standard',
        },
      });

      console.log('Subscription created:', subscription.id);
      console.log('Status:', subscription.status);

      // Step 4: Return signup result
      return {
        success: true,
        customerId: customer.id,
        subscriptionId: subscription.id,
        status: subscription.status,
        trialEnd: subscription.trial_end
          ? new Date(subscription.trial_end * 1000)
          : null,
        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
      };
    } catch (error) {
      if (error instanceof StripeError) {
        console.error('Stripe error during signup:', error.message);

        // Handle specific error types
        if (error.statusCode === 402) {
          throw new Error('Card was declined. Please try a different payment method.');
        } else if (error.statusCode === 400) {
          throw new Error('Invalid payment information provided.');
        } else if (error.statusCode === 429) {
          throw new Error('Too many requests. Please try again in a moment.');
        }

        throw new Error('Failed to complete signup. Please try again.');
      }

      throw error;
    }
  }
}
```

**Usage:**

```typescript
// In your controller
@Post('signup')
async signup(@Body() body: SignupDto) {
  return this.subscriptionSignup.completeSignup({
    companyId: body.companyId,
    email: body.email,
    name: body.name,
    paymentMethodId: body.paymentMethodId,  // From Stripe.js on frontend
    priceId: 'price_standard_monthly',
    trialDays: 14,
  });
}
```

---

## Metered Billing Workflow

Complete workflow for usage-based billing with Stripe Billing Meters.

```typescript
import { Injectable } from '@nestjs/common';
import { StripeUsageService } from './core/stripe/services/stripe.usage.service';
import { StripeProductService } from './core/stripe/services/stripe.product.service';
import { StripeSubscriptionService } from './core/stripe/services/stripe.subscription.service';

@Injectable()
export class MeteredBillingService {
  constructor(
    private readonly stripeUsage: StripeUsageService,
    private readonly stripeProduct: StripeProductService,
    private readonly stripeSubscription: StripeSubscriptionService,
  ) {}

  /**
   * Setup a metered product and price
   */
  async setupMeteredProduct() {
    // Step 1: Create product
    const product = await this.stripeProduct.createProduct({
      name: 'API Usage',
      description: 'Pay-as-you-go API access',
      metadata: { type: 'metered' },
    });

    // Step 2: Create usage-based price
    // Note: You need to create a billing meter in Stripe Dashboard first
    const price = await this.stripeProduct.createPrice({
      productId: product.id,
      unitAmount: 10,  // $0.10 per API call
      currency: 'usd',
      nickname: 'Per API Call',
      recurring: {
        interval: 'month',
        meter: 'mtr_api_requests',  // Your billing meter ID
      },
    });

    return { product, price };
  }

  /**
   * Track API usage for a customer
   */
  async trackAPICall(params: {
    customerId: string;
    endpoint: string;
    requestCount: number;
  }) {
    try {
      // Report usage event
      await this.stripeUsage.reportUsage({
        eventName: 'api_request',
        customerId: params.customerId,
        value: params.requestCount,
        timestamp: Math.floor(Date.now() / 1000),
        idempotencyKey: `${params.customerId}-${Date.now()}`,
      });

      console.log(`Tracked ${params.requestCount} API calls for customer ${params.customerId}`);
    } catch (error) {
      console.error('Failed to track usage:', error);
      // Don't throw - usage tracking should not block API responses
    }
  }

  /**
   * Get usage summary for billing period
   */
  async getUsageSummary(customerId: string) {
    const now = Math.floor(Date.now() / 1000);
    const startOfMonth = Math.floor(
      new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime() / 1000
    );

    const summaries = await this.stripeUsage.listUsageSummaries({
      customerId,
      startTime: startOfMonth,
      endTime: now,
    });

    // Calculate total usage
    const totalUsage = summaries.reduce((sum, summary) => {
      return sum + (summary.aggregated_value || 0);
    }, 0);

    return {
      period: {
        start: new Date(startOfMonth * 1000),
        end: new Date(now * 1000),
      },
      totalUsage,
      estimatedCost: totalUsage * 0.10,  // $0.10 per call
      summaries,
    };
  }

  /**
   * Setup customer with metered subscription
   */
  async setupMeteredSubscription(customerId: string, priceId: string) {
    const subscription = await this.stripeSubscription.createSubscription({
      stripeCustomerId: customerId,
      priceId,
      metadata: { billingType: 'metered' },
    });

    return subscription;
  }
}
```

**Usage in API Middleware:**

```typescript
@Injectable()
export class UsageTrackingInterceptor implements NestInterceptor {
  constructor(private readonly meteredBilling: MeteredBillingService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const customerId = request.user?.stripeCustomerId;

    return next.handle().pipe(
      tap(() => {
        if (customerId) {
          // Track API usage after successful request
          this.meteredBilling.trackAPICall({
            customerId,
            endpoint: request.path,
            requestCount: 1,
          }).catch(err => console.error('Usage tracking failed:', err));
        }
      }),
    );
  }
}
```

---

## One-Time Payment Collection

Process a one-time payment using Payment Intents.

```typescript
import { Injectable } from '@nestjs/common';
import { StripePaymentService } from './core/stripe/services/stripe.payment.service';
import { StripeCustomerService } from './core/stripe/services/stripe.customer.service';

@Injectable()
export class PaymentService {
  constructor(
    private readonly stripePayment: StripePaymentService,
    private readonly stripeCustomer: StripeCustomerService,
  ) {}

  /**
   * Create a payment intent for one-time payment
   */
  async createPayment(params: {
    customerId: string;
    amount: number;
    description: string;
    metadata?: Record<string, string>;
  }) {
    // Create payment intent
    const paymentIntent = await this.stripePayment.createPaymentIntent({
      amount: params.amount,
      currency: 'usd',
      customerId: params.customerId,
      metadata: {
        description: params.description,
        ...params.metadata,
      },
    });

    // Return client secret for frontend
    return {
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: paymentIntent.amount,
      status: paymentIntent.status,
    };
  }

  /**
   * Confirm payment after frontend collects payment method
   */
  async confirmPayment(paymentIntentId: string) {
    const paymentIntent = await this.stripePayment.confirmPaymentIntent(
      paymentIntentId,
    );

    return {
      success: paymentIntent.status === 'succeeded',
      status: paymentIntent.status,
      amount: paymentIntent.amount,
    };
  }

  /**
   * Check payment status
   */
  async getPaymentStatus(paymentIntentId: string) {
    const paymentIntent = await this.stripePayment.retrievePaymentIntent(
      paymentIntentId,
    );

    return {
      status: paymentIntent.status,
      amount: paymentIntent.amount,
      captured: paymentIntent.status === 'succeeded',
      errorMessage: paymentIntent.last_payment_error?.message,
    };
  }

  /**
   * Cancel pending payment
   */
  async cancelPayment(paymentIntentId: string) {
    await this.stripePayment.cancelPaymentIntent(paymentIntentId);
    return { success: true };
  }
}
```

**Frontend Integration (React example):**

```typescript
// Frontend code using Stripe.js
const handlePayment = async () => {
  // 1. Create payment intent on backend
  const { clientSecret } = await fetch('/api/payments/create', {
    method: 'POST',
    body: JSON.stringify({
      customerId: 'cus_123',
      amount: 5000,  // $50.00
      description: 'One-time purchase',
    }),
  }).then(res => res.json());

  // 2. Confirm payment on frontend
  const { error, paymentIntent } = await stripe.confirmCardPayment(
    clientSecret,
    {
      payment_method: {
        card: cardElement,
        billing_details: { name: 'Customer Name' },
      },
    }
  );

  if (error) {
    console.error('Payment failed:', error.message);
  } else if (paymentIntent.status === 'succeeded') {
    console.log('Payment successful!');
  }
};
```

---

## Subscription Management

Complete subscription lifecycle management examples.

```typescript
import { Injectable } from '@nestjs/common';
import { StripeSubscriptionService } from './core/stripe/services/stripe.subscription.service';
import { StripeInvoiceService } from './core/stripe/services/stripe.invoice.service';

@Injectable()
export class SubscriptionManagementService {
  constructor(
    private readonly stripeSubscription: StripeSubscriptionService,
    private readonly stripeInvoice: StripeInvoiceService,
  ) {}

  /**
   * Upgrade subscription with proration preview
   */
  async upgradeSubscription(subscriptionId: string, newPriceId: string) {
    // Step 1: Preview proration
    const prorationPreview = await this.stripeSubscription.previewProration(
      subscriptionId,
      newPriceId,
    );

    const prorationAmount = prorationPreview.amount_due;
    console.log('Proration amount:', prorationAmount / 100, 'USD');

    // Step 2: Confirm and update subscription
    const updatedSubscription = await this.stripeSubscription.updateSubscription({
      subscriptionId,
      priceId: newPriceId,
      prorationBehavior: 'create_prorations',
      metadata: { upgraded: 'true', upgradeDate: new Date().toISOString() },
    });

    return {
      subscription: updatedSubscription,
      prorationAmount,
      nextBillingDate: new Date(updatedSubscription.current_period_end * 1000),
    };
  }

  /**
   * Downgrade subscription (takes effect at period end)
   */
  async downgradeSubscription(subscriptionId: string, newPriceId: string) {
    // Update subscription to change at period end (no proration)
    const updatedSubscription = await this.stripeSubscription.updateSubscription({
      subscriptionId,
      priceId: newPriceId,
      prorationBehavior: 'none',
      metadata: { downgraded: 'true', downgradeDate: new Date().toISOString() },
    });

    return {
      subscription: updatedSubscription,
      effectiveDate: new Date(updatedSubscription.current_period_end * 1000),
      message: 'Downgrade will take effect at the end of the current billing period',
    };
  }

  /**
   * Pause subscription temporarily
   */
  async pauseSubscription(subscriptionId: string, resumeInDays?: number) {
    const resumeDate = resumeInDays
      ? new Date(Date.now() + resumeInDays * 24 * 60 * 60 * 1000)
      : undefined;

    const pausedSubscription = await this.stripeSubscription.pauseSubscription(
      subscriptionId,
      resumeDate,
    );

    return {
      subscription: pausedSubscription,
      pausedUntil: resumeDate || 'manual resume required',
      status: pausedSubscription.status,
    };
  }

  /**
   * Resume paused subscription
   */
  async resumeSubscription(subscriptionId: string) {
    const resumedSubscription = await this.stripeSubscription.resumeSubscription(
      subscriptionId,
    );

    return {
      subscription: resumedSubscription,
      status: resumedSubscription.status,
      nextBillingDate: new Date(resumedSubscription.current_period_end * 1000),
    };
  }

  /**
   * Cancel subscription
   */
  async cancelSubscription(params: {
    subscriptionId: string;
    immediate: boolean;
    reason?: string;
  }) {
    const canceledSubscription = await this.stripeSubscription.cancelSubscription(
      params.subscriptionId,
      !params.immediate,  // cancelAtPeriodEnd
    );

    return {
      subscription: canceledSubscription,
      canceledAt: params.immediate
        ? 'immediately'
        : new Date(canceledSubscription.current_period_end * 1000),
      status: canceledSubscription.status,
    };
  }

  /**
   * Get subscription with upcoming invoice preview
   */
  async getSubscriptionWithUpcoming(customerId: string, subscriptionId: string) {
    const [subscription, upcomingInvoice] = await Promise.all([
      this.stripeSubscription.retrieveSubscription(subscriptionId),
      this.stripeInvoice.retrieveUpcomingInvoice(customerId),
    ]);

    return {
      subscription,
      nextCharge: {
        amount: upcomingInvoice.amount_due,
        date: new Date(upcomingInvoice.period_end * 1000),
        items: upcomingInvoice.lines.data.map(line => ({
          description: line.description,
          amount: line.amount,
        })),
      },
    };
  }
}
```

---

## Customer Portal Integration

Self-service billing portal for customers.

```typescript
import { Injectable } from '@nestjs/common';
import { StripePortalService } from './core/stripe/services/stripe.portal.service';

@Injectable()
export class CustomerPortalService {
  constructor(private readonly stripePortal: StripePortalService) {}

  /**
   * Generate portal session for customer
   */
  async createPortalSession(customerId: string, returnPath: string = '/account') {
    const returnUrl = `${process.env.APP_URL}${returnPath}`;

    const session = await this.stripePortal.createPortalSession({
      stripeCustomerId: customerId,
      returnUrl,
    });

    return {
      url: session.url,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),  // 30 minutes
    };
  }

  /**
   * Quick portal URL generator
   */
  async getPortalUrl(customerId: string) {
    return this.stripePortal.getPortalUrl(
      customerId,
      `${process.env.APP_URL}/account/billing`,
    );
  }
}
```

**Controller Usage:**

```typescript
@Controller('billing')
export class BillingController {
  constructor(
    private readonly customerPortal: CustomerPortalService,
  ) {}

  @Get('portal')
  @UseGuards(AuthGuard)
  async redirectToPortal(@Req() req: Request) {
    const customerId = req.user.stripeCustomerId;

    const { url } = await this.customerPortal.createPortalSession(
      customerId,
      '/account/billing',
    );

    // Redirect user to Stripe Customer Portal
    return { redirectUrl: url };
  }
}
```

---

## Handling Failed Payments

Robust failed payment handling with retry logic.

```typescript
import { Injectable } from '@nestjs/common';
import { StripeInvoiceService } from './core/stripe/services/stripe.invoice.service';
import { StripeCustomerService } from './core/stripe/services/stripe.customer.service';

@Injectable()
export class FailedPaymentService {
  constructor(
    private readonly stripeInvoice: StripeInvoiceService,
    private readonly stripeCustomer: StripeCustomerService,
  ) {}

  /**
   * Handle failed payment from webhook
   */
  async handleFailedPayment(invoiceId: string, customerId: string) {
    const invoice = await this.stripeInvoice.retrieveInvoice(invoiceId);

    console.log('Payment failed for invoice:', invoiceId);
    console.log('Amount due:', invoice.amount_due / 100, 'USD');
    console.log('Attempt:', invoice.attempt_count);

    // Get customer details
    const customer = await this.stripeCustomer.retrieveCustomer(customerId);

    // Send notification to customer
    await this.notifyCustomer({
      email: customer.email,
      name: customer.name,
      invoiceUrl: invoice.hosted_invoice_url,
      amountDue: invoice.amount_due / 100,
      attemptCount: invoice.attempt_count,
    });

    // If multiple failed attempts, take action
    if (invoice.attempt_count >= 3) {
      await this.handleMaxAttemptsReached(customerId, invoiceId);
    }

    return {
      handled: true,
      attemptCount: invoice.attempt_count,
      nextAttempt: invoice.next_payment_attempt,
    };
  }

  /**
   * Retry failed payment with updated payment method
   */
  async retryPayment(invoiceId: string, newPaymentMethodId: string) {
    // Get invoice
    const invoice = await this.stripeInvoice.retrieveInvoice(invoiceId);

    // Update customer's default payment method
    await this.stripeCustomer.setDefaultPaymentMethod({
      stripeCustomerId: invoice.customer as string,
      paymentMethodId: newPaymentMethodId,
    });

    // Retry payment
    const paidInvoice = await this.stripeInvoice.payInvoice(invoiceId);

    return {
      success: paidInvoice.status === 'paid',
      status: paidInvoice.status,
      amountPaid: paidInvoice.amount_paid,
    };
  }

  private async notifyCustomer(params: {
    email: string;
    name: string;
    invoiceUrl: string;
    amountDue: number;
    attemptCount: number;
  }) {
    // Send email notification
    console.log('Sending payment failure notification to:', params.email);
    // Implement email sending logic here
  }

  private async handleMaxAttemptsReached(customerId: string, invoiceId: string) {
    console.log('Max payment attempts reached for customer:', customerId);

    // Options:
    // 1. Suspend account access
    // 2. Downgrade to free plan
    // 3. Send final notice
    // 4. Cancel subscription

    // Example: Send final notice
    const customer = await this.stripeCustomer.retrieveCustomer(customerId);
    console.log('Sending final payment notice to:', customer.email);
  }
}
```

---

## Usage Tracking and Reporting

Advanced usage tracking with analytics.

```typescript
import { Injectable } from '@nestjs/common';
import { StripeUsageService } from './core/stripe/services/stripe.usage.service';

@Injectable()
export class UsageAnalyticsService {
  constructor(private readonly stripeUsage: StripeUsageService) {}

  /**
   * Track feature usage with detailed metadata
   */
  async trackFeatureUsage(params: {
    customerId: string;
    feature: string;
    quantity: number;
    metadata?: Record<string, string>;
  }) {
    await this.stripeUsage.reportUsage({
      eventName: `feature_${params.feature}`,
      customerId: params.customerId,
      value: params.quantity,
      timestamp: Math.floor(Date.now() / 1000),
    });

    console.log(`Tracked ${params.quantity} uses of ${params.feature} for customer ${params.customerId}`);
  }

  /**
   * Get comprehensive usage report
   */
  async getUsageReport(customerId: string, days: number = 30) {
    const endTime = Math.floor(Date.now() / 1000);
    const startTime = endTime - (days * 24 * 60 * 60);

    const summaries = await this.stripeUsage.listUsageSummaries({
      customerId,
      startTime,
      endTime,
    });

    // Aggregate usage by feature
    const usageByFeature = summaries.reduce((acc, summary) => {
      const feature = summary.meter;
      if (!acc[feature]) {
        acc[feature] = { total: 0, events: [] };
      }
      acc[feature].total += summary.aggregated_value || 0;
      acc[feature].events.push(summary);
      return acc;
    }, {} as Record<string, { total: number; events: any[] }>);

    return {
      period: {
        start: new Date(startTime * 1000),
        end: new Date(endTime * 1000),
        days,
      },
      totalUsage: summaries.reduce((sum, s) => sum + (s.aggregated_value || 0), 0),
      byFeature: usageByFeature,
      summaries,
    };
  }

  /**
   * Check if customer is approaching usage limits
   */
  async checkUsageLimits(customerId: string, monthlyLimit: number) {
    const summary = await this.getUsageReport(customerId, 30);

    const usagePercentage = (summary.totalUsage / monthlyLimit) * 100;
    const isApproachingLimit = usagePercentage >= 80;
    const hasExceededLimit = usagePercentage >= 100;

    if (isApproachingLimit) {
      console.log(`Customer ${customerId} has used ${usagePercentage.toFixed(1)}% of monthly limit`);
    }

    return {
      currentUsage: summary.totalUsage,
      limit: monthlyLimit,
      percentage: usagePercentage,
      isApproachingLimit,
      hasExceededLimit,
      remainingUsage: Math.max(0, monthlyLimit - summary.totalUsage),
    };
  }
}
```

---

## Multi-Plan Subscription System

Complete multi-tier pricing system implementation.

```typescript
import { Injectable } from '@nestjs/common';
import { StripeProductService } from './core/stripe/services/stripe.product.service';
import { StripeSubscriptionService } from './core/stripe/services/stripe.subscription.service';

interface PlanTier {
  name: string;
  description: string;
  monthlyPrice: number;
  yearlyPrice: number;
  features: string[];
  usageLimit?: number;
}

@Injectable()
export class MultiPlanService {
  private readonly plans: Record<string, PlanTier> = {
    free: {
      name: 'Free',
      description: 'Get started with basic features',
      monthlyPrice: 0,
      yearlyPrice: 0,
      features: ['5 projects', '100 API calls/month', 'Community support'],
      usageLimit: 100,
    },
    pro: {
      name: 'Professional',
      description: 'For growing teams',
      monthlyPrice: 2900,  // $29.00
      yearlyPrice: 29000,  // $290.00 (2 months free)
      features: ['Unlimited projects', '10,000 API calls/month', 'Priority support'],
      usageLimit: 10000,
    },
    enterprise: {
      name: 'Enterprise',
      description: 'For large organizations',
      monthlyPrice: 9900,  // $99.00
      yearlyPrice: 99000,  // $990.00
      features: ['Everything in Pro', 'Unlimited API calls', 'Dedicated support', 'Custom integrations'],
    },
  };

  constructor(
    private readonly stripeProduct: StripeProductService,
    private readonly stripeSubscription: StripeSubscriptionService,
  ) {}

  /**
   * Initialize all pricing plans
   */
  async initializePlans() {
    const createdPlans = [];

    for (const [tier, plan] of Object.entries(this.plans)) {
      if (plan.monthlyPrice === 0) continue;  // Skip free tier

      // Create product
      const product = await this.stripeProduct.createProduct({
        name: plan.name,
        description: plan.description,
        metadata: { tier, features: plan.features.join(',') },
      });

      // Create monthly price
      const monthlyPrice = await this.stripeProduct.createPrice({
        productId: product.id,
        unitAmount: plan.monthlyPrice,
        currency: 'usd',
        nickname: `${plan.name} - Monthly`,
        recurring: { interval: 'month' },
      });

      // Create yearly price
      const yearlyPrice = await this.stripeProduct.createPrice({
        productId: product.id,
        unitAmount: plan.yearlyPrice,
        currency: 'usd',
        nickname: `${plan.name} - Yearly`,
        recurring: { interval: 'year' },
      });

      createdPlans.push({
        tier,
        product,
        monthlyPrice,
        yearlyPrice,
      });
    }

    return createdPlans;
  }

  /**
   * Subscribe customer to plan
   */
  async subscribeToPlan(params: {
    customerId: string;
    tier: 'free' | 'pro' | 'enterprise';
    billingInterval: 'monthly' | 'yearly';
    paymentMethodId?: string;
  }) {
    const plan = this.plans[params.tier];

    if (!plan) {
      throw new Error(`Invalid plan tier: ${params.tier}`);
    }

    // Free tier doesn't need Stripe subscription
    if (params.tier === 'free') {
      return { tier: 'free', subscription: null };
    }

    // Get price ID based on billing interval
    const priceId = params.billingInterval === 'yearly'
      ? this.getYearlyPriceId(params.tier)
      : this.getMonthlyPriceId(params.tier);

    // Create subscription
    const subscription = await this.stripeSubscription.createSubscription({
      stripeCustomerId: params.customerId,
      priceId,
      paymentMethodId: params.paymentMethodId,
      metadata: {
        tier: params.tier,
        billingInterval: params.billingInterval,
      },
    });

    return {
      tier: params.tier,
      subscription,
      features: plan.features,
      usageLimit: plan.usageLimit,
    };
  }

  private getMonthlyPriceId(tier: string): string {
    // In production, retrieve from database or config
    const priceIds = {
      pro: 'price_pro_monthly',
      enterprise: 'price_enterprise_monthly',
    };
    return priceIds[tier];
  }

  private getYearlyPriceId(tier: string): string {
    const priceIds = {
      pro: 'price_pro_yearly',
      enterprise: 'price_enterprise_yearly',
    };
    return priceIds[tier];
  }
}
```

---

## See Also

- [API Reference](API.md) - Complete API documentation
- [Testing Guide](TESTING.md) - Testing patterns and utilities
- [Webhook Guide](WEBHOOKS.md) - Webhook implementation guide
- [Main README](../README.md) - Module overview
