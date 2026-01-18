import { Injectable } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { CompanyRepository } from "../../company/repositories/company.repository";
import { StripeCustomerRepository } from "../../stripe-customer/repositories/stripe-customer.repository";
import { StripeCustomerAdminService } from "../../stripe-customer/services/stripe-customer-admin.service";
import { StripePriceRepository } from "../../stripe-price/repositories/stripe-price.repository";
import { StripeSubscriptionAdminService } from "../../stripe-subscription/services/stripe-subscription-admin.service";

/**
 * TrialService
 *
 * Orchestrates 14-day trial subscription creation for new user signups.
 * Creates Stripe customer, subscription with trial period, and allocates tokens.
 *
 * Key Features:
 * - Database-driven trial price selection (isTrial: true)
 * - Creates Stripe customer and subscription
 * - Allocates tokens from trial price configuration
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

    // Also check if Stripe customer already exists for this company
    const existingCustomer = await this.stripeCustomerRepository.findByCompanyId({ companyId: params.companyId });
    if (existingCustomer) {
      this.logger.log(`Company ${params.companyId} already has Stripe customer - skipping trial creation`);
      return;
    }

    // 1. Find the trial price from database
    const trialPrice = await this.stripePriceRepository.findTrialPrice();
    if (!trialPrice) {
      this.logger.warn("No trial price configured - skipping trial creation");
      return;
    }

    // 2. Create Stripe customer for the company
    // This uses the company name and owner email automatically
    await this.stripeCustomerAdminService.createCustomer(params.companyId, params.userId);

    // 3. Create subscription with 14-day trial
    // Note: This will fail if no payment method, but trial subscriptions don't require payment upfront
    // The createSubscription method handles trial creation with trialPeriodDays parameter
    await this.stripeSubscriptionAdminService.createSubscription({
      companyId: params.companyId,
      priceId: trialPrice.id,
      trialPeriodDays: 14,
      // trialEnd: Math.floor(Date.now() / 1000) + 3 * 60,
    });

    // 4. Allocate trial tokens from price configuration
    const trialTokens = trialPrice.token ?? 0;
    if (trialTokens > 0) {
      await this.companyRepository.updateTokens({
        companyId: params.companyId,
        monthlyTokens: trialTokens,
        availableMonthlyTokens: trialTokens,
      });
    }

    // 5. Mark subscription as active (during trial)
    await this.companyRepository.markSubscriptionStatus({
      companyId: params.companyId,
      isActiveSubscription: true,
    });

    this.logger.log(`Trial started for company ${params.companyId} with ${trialTokens} tokens`);
  }
}
