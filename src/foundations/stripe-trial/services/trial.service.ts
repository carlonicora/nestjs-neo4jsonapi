import { Injectable } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { CompanyRepository } from "../../company/repositories/company.repository";
import { CompanyService } from "../../company/services/company.service";
import { StripeCustomerRepository } from "../../stripe-customer/repositories/stripe-customer.repository";
import { StripeCustomerAdminService } from "../../stripe-customer/services/stripe-customer-admin.service";
import { StripePriceRepository } from "../../stripe-price/repositories/stripe-price.repository";
import type { StripeSubscriptionStatus } from "../../stripe-subscription/entities/stripe-subscription";
import { StripeSubscriptionRepository } from "../../stripe-subscription/repositories/stripe-subscription.repository";
import { StripeSubscriptionAdminService } from "../../stripe-subscription/services/stripe-subscription-admin.service";
import { StripeSubscriptionApiService } from "../../stripe-subscription/services/stripe-subscription-api.service";
import { FeatureSyncService } from "../../stripe-subscription/services/feature-sync.service";
import { isCountingTrialSubscription } from "../trial-counting";

/**
 * Result of `TrialService.startTrialInRequest`.
 *
 * - `trialing`: the trial started; `trialEndsAt` is the trial end Stripe returned.
 * - `already-subscribed`: the company has an active subscription or a subscription that
 *   used up its trial (see `isCountingTrialSubscription`); nothing was created.
 * - `no-trial-price`: no trial price is configured; nothing was created.
 * - `not-trialing`: Stripe created the subscription in another status; it was cancelled
 *   and its local node deleted, so a later attempt can start the trial again.
 */
export type TrialStartOutcome =
  | { kind: "trialing"; trialEndsAt: Date }
  | { kind: "already-subscribed" }
  | { kind: "no-trial-price" }
  | { kind: "not-trialing"; status: StripeSubscriptionStatus };

const TRIAL_PERIOD_DAYS = 14;

/**
 * TrialService
 *
 * Orchestrates 14-day trial subscription creation: in the background after sign-up
 * (`startTrial`, queued on activation) or inside a request (`startTrialInRequest`, for apps
 * that set `auth.trialOnActivation: false` and start the trial themselves).
 * Creates or reuses the Stripe customer, creates the subscription with a trial period, and
 * allocates tokens.
 *
 * Key Features:
 * - Database-driven trial price selection (isTrial: true)
 * - Creates Stripe customer and subscription
 * - Allocates tokens from trial price configuration
 * - Stores the trial end on the company (`trialEndsAt`: never overwritten by `startTrial`,
 *   replaced with the Stripe trial end by `startTrialInRequest`)
 * - Graceful error handling (doesn't block registration)
 *
 * @example
 * ```typescript
 * await trialService.startTrial({
 *   companyId: 'company_123',
 *   userId: 'user_456',
 * });
 * ```
 */
@Injectable()
export class TrialService {
  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly companyRepository: CompanyRepository,
    private readonly companyService: CompanyService,
    private readonly logger: AppLoggingService,
  ) {}

  /**
   * Lazily get Stripe services via ModuleRef to avoid circular dependencies.
   * Stripe modules form a complex circular chain that can't be resolved with forwardRef alone.
   */
  private get stripeCustomerAdminService(): StripeCustomerAdminService {
    return this.moduleRef.get(StripeCustomerAdminService, { strict: false });
  }

  private get stripeSubscriptionAdminService(): StripeSubscriptionAdminService {
    return this.moduleRef.get(StripeSubscriptionAdminService, { strict: false });
  }

  private get stripePriceRepository(): StripePriceRepository {
    return this.moduleRef.get(StripePriceRepository, { strict: false });
  }

  private get stripeCustomerRepository(): StripeCustomerRepository {
    return this.moduleRef.get(StripeCustomerRepository, { strict: false });
  }

  private get stripeSubscriptionRepository(): StripeSubscriptionRepository {
    return this.moduleRef.get(StripeSubscriptionRepository, { strict: false });
  }

  private get stripeSubscriptionApiService(): StripeSubscriptionApiService {
    return this.moduleRef.get(StripeSubscriptionApiService, { strict: false });
  }

  private get featureSyncService(): FeatureSyncService {
    return this.moduleRef.get(FeatureSyncService, { strict: false });
  }

  /**
   * Whether the company already has a subscription that used up its trial.
   * A Stripe customer alone (left by a failed earlier attempt) does not count.
   */
  private async hasCountingSubscription(companyId: string): Promise<boolean> {
    const customer = await this.stripeCustomerRepository.findByCompanyId({ companyId });
    if (!customer) return false;

    const subscriptions = await this.stripeSubscriptionRepository.findByStripeCustomerId({
      stripeCustomerId: customer.id,
    });
    return subscriptions.some(isCountingTrialSubscription);
  }

  /** Creates the company's Stripe customer unless one exists already. */
  private async ensureCustomer(params: { companyId: string; userId: string }): Promise<void> {
    const existingCustomer = await this.stripeCustomerRepository.findByCompanyId({ companyId: params.companyId });
    if (existingCustomer) return;
    // This uses the company name and owner email automatically
    await this.stripeCustomerAdminService.createCustomer(params.companyId, params.userId);
  }

  /** Allocates the trial tokens from the trial price and writes the AI flag. */
  private async allocateTrialTokens(params: { companyId: string; token?: number | null }): Promise<number> {
    // The flag is written unconditionally: a trial price with token 0 is an
    // AI-free trial, and gating this behind `trialTokens > 0` would silently
    // leave such a company with AI enabled.
    const trialTokens = params.token ?? 0;
    await this.companyService.updateTokensAndAiFlag({
      companyId: params.companyId,
      monthlyCredits: trialTokens,
      availableMonthlyCredits: trialTokens,
      aiEnabled: trialTokens > 0,
    });
    return trialTokens;
  }

  /**
   * Start a 14-day trial for a new company
   *
   * Creates Stripe customer and subscription with trial period.
   * Allocates tokens from the trial price configuration.
   *
   * @param params - Trial parameters
   * @param params.companyId - Company identifier
   * @param params.userId - User identifier (for customer creation)
   * @returns Promise that resolves when trial is started
   *
   * @example
   * ```typescript
   * await trialService.startTrial({
   *   companyId: 'company_123',
   *   userId: 'user_456',
   * });
   * ```
   */
  async startTrial(params: { companyId: string; userId: string }): Promise<void> {
    // IDEMPOTENCY CHECK: Skip if company already has a subscription
    const company = await this.companyRepository.findByCompanyId({ companyId: params.companyId });
    if (company?.isActiveSubscription) {
      this.logger.log(`Company ${params.companyId} already has active subscription - skipping trial creation`);
      return;
    }

    // Skip if the company already had a subscription that used up its trial. A Stripe
    // customer with no such subscription (an earlier attempt that failed after creating the
    // customer) is reused, so a retried job can still start the trial.
    if (await this.hasCountingSubscription(params.companyId)) {
      this.logger.log(`Company ${params.companyId} already has a subscription - skipping trial creation`);
      return;
    }

    // 1. Find the trial price from database
    const trialPrice = await this.stripePriceRepository.findTrialPrice();
    if (!trialPrice) {
      this.logger.warn("No trial price configured - skipping trial creation");
      return;
    }

    // 2. Create the Stripe customer for the company, unless one exists already
    await this.ensureCustomer(params);

    // 3. Create subscription with 14-day trial
    // Note: This will fail if no payment method, but trial subscriptions don't require payment upfront
    // The createSubscription method handles trial creation with trialPeriodDays parameter
    await this.stripeSubscriptionAdminService.createSubscription({
      companyId: params.companyId,
      priceId: trialPrice.id,
      trialPeriodDays: TRIAL_PERIOD_DAYS,
      // trialEnd: Math.floor(Date.now() / 1000) + 3 * 60,
    });

    // 4. Allocate trial tokens from price configuration.
    const trialTokens = await this.allocateTrialTokens({ companyId: params.companyId, token: trialPrice.token });

    // 5. Mark subscription as active (during trial)
    await this.companyRepository.markSubscriptionStatus({
      companyId: params.companyId,
      isActiveSubscription: true,
    });

    // 6. Store when the trial ends, so access does not depend on Stripe state.
    // Never overwrites an existing value.
    await this.companyRepository.markTrialEnd({
      companyId: params.companyId,
      trialEndsAt: new Date(Date.now() + TRIAL_PERIOD_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    });

    this.logger.log(`Trial started for company ${params.companyId} with ${trialTokens} tokens`);
  }

  /**
   * Start the 14-day trial inside a request and report what happened.
   *
   * For apps that set `auth.trialOnActivation: false` and start the trial on a user
   * action. Unlike `startTrial`, Stripe errors are thrown to the caller, and a
   * subscription Stripe did not create as `trialing` is cancelled (with the unpaid-attempt
   * comment, so the deletion webhook skips the credit reset and the cancellation email)
   * and its local node deleted, so the trial can be tried again. On `trialing` the trial
   * price's features are added to the company before returning (the same additive sync the
   * `invoice.paid` webhook runs later), so the caller's next write already sees them.
   *
   * @param params.companyId - Company identifier (server-derived)
   * @param params.userId - User identifier (for customer creation)
   * @param params.idempotencyKey - Stripe idempotency key for the subscription create: a
   *   retry of the same request returns the same subscription
   * @returns The outcome; see `TrialStartOutcome`
   * @throws The Stripe or repository error when a call fails
   */
  async startTrialInRequest(params: {
    companyId: string;
    userId: string;
    idempotencyKey: string;
  }): Promise<TrialStartOutcome> {
    const company = await this.companyRepository.findByCompanyId({ companyId: params.companyId });
    if (company?.isActiveSubscription || (await this.hasCountingSubscription(params.companyId))) {
      return { kind: "already-subscribed" };
    }

    const trialPrice = await this.stripePriceRepository.findTrialPrice();
    if (!trialPrice) {
      this.logger.warn("No trial price configured - skipping trial creation");
      return { kind: "no-trial-price" };
    }

    await this.ensureCustomer({ companyId: params.companyId, userId: params.userId });

    const { subscription } = await this.stripeSubscriptionAdminService.createSubscription({
      companyId: params.companyId,
      priceId: trialPrice.id,
      trialPeriodDays: TRIAL_PERIOD_DAYS,
      idempotencyKey: params.idempotencyKey,
    });

    if (subscription.status !== "trialing") {
      await this.stripeSubscriptionApiService.cancelUnpaidAttempt(subscription.stripeSubscriptionId);
      await this.stripeSubscriptionRepository.deleteByStripeSubscriptionId({
        stripeSubscriptionId: subscription.stripeSubscriptionId,
      });
      this.logger.warn(
        `Trial subscription for company ${params.companyId} was created as ${subscription.status} - cancelled`,
      );
      return { kind: "not-trialing", status: subscription.status };
    }

    const trialTokens = await this.allocateTrialTokens({ companyId: params.companyId, token: trialPrice.token });

    await this.companyRepository.markSubscriptionStatus({
      companyId: params.companyId,
      isActiveSubscription: true,
    });

    // The trial end Stripe returned; overwrites any earlier value (e.g. a legacy backfill).
    const trialEndsAt = subscription.trialEnd
      ? new Date(subscription.trialEnd)
      : new Date(Date.now() + TRIAL_PERIOD_DAYS * 24 * 60 * 60 * 1000);
    await this.companyRepository.replaceTrialEnd({
      companyId: params.companyId,
      trialEndsAt: trialEndsAt.toISOString(),
    });

    // The trial price's features (e.g. Pro) reach the company now, so whatever the
    // caller creates next already sees them. The invoice.paid webhook runs the same
    // additive sync later; a failure here is logged, never undoes the started trial.
    try {
      await this.featureSyncService.syncFeaturesOnPayment({ stripeSubscriptionId: subscription.stripeSubscriptionId });
    } catch (error) {
      this.logger.error(
        `Feature sync after in-request trial failed for company ${params.companyId}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }

    this.logger.log(`Trial started in request for company ${params.companyId} with ${trialTokens} tokens`);
    return { kind: "trialing", trialEndsAt };
  }
}
