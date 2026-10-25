import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { ClsService } from "nestjs-cls";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { AbstractService } from "../../../core/neo4j/abstracts/abstract.service";
import { WebSocketService } from "../../../core/websocket/services/websocket.service";
import { Company, CompanyDescriptor } from "../../company/entities/company";
import {
  COMPANY_CREDITS_GRANTED_EVENT,
  COMPANY_CREDITS_USED_EVENT,
  CompanyCreditsGrantedPayload,
  CompanyCreditsUsedPayload,
} from "../../company/events/company.events";
import { CompanyRepository } from "../../company/repositories/company.repository";
import { StripeCustomerRepository } from "../../stripe-customer/repositories/stripe-customer.repository";
import { StripePriceRepository } from "../../stripe-price/repositories/stripe-price.repository";
import type { StripeSubscription } from "../../stripe-subscription/entities/stripe-subscription";
import { StripeSubscriptionRepository } from "../../stripe-subscription/repositories/stripe-subscription.repository";
import { StripeWebhookNotificationService } from "../../stripe-webhook/services/stripe-webhook-notification.service";
import { BILLING_CONFIG, ResolvedBillingConfig } from "../interfaces/billing.config.interface";
import type { CreditWarningOffer } from "../interfaces/credit-warning.interface";

type CreditWarningContext = {
  offer: CreditWarningOffer;
  interval: "month" | "year";
  stripeCustomerId: string;
};

/**
 * Warns a company once per credit period when its credits left fall to
 * `100 - thresholdPercent`% of what it was granted, in the app and by email.
 *
 * Opt-in through `billing.creditWarning.enabled`. With it off every method
 * returns at once: no Cypher, no Company field written, no email, no websocket
 * message.
 *
 * - Credits used: a cheap pre-check on the company, then the offer lookup, then
 *   the atomic `markCreditWarningSent`. Only the spend that gets the company back
 *   sends the email and broadcasts `company:subscription_updated`.
 * - Credits granted: starts a new period (clears every marker).
 * - Dismiss: records the dismissal for the caller's own company.
 *
 * The event handlers never throw: the credits-used emitter is the credit spend of
 * a live LLM call. They run in a CLS context pinned to the payload's company,
 * because the granted event fires from the webhook worker with no company in CLS.
 */
@Injectable()
export class CreditWarningService extends AbstractService<Company, typeof CompanyDescriptor.relationships> {
  protected readonly descriptor = CompanyDescriptor;

  constructor(
    jsonApiService: JsonApiService,
    private readonly companyRepository: CompanyRepository,
    clsService: ClsService,
    @Inject(BILLING_CONFIG) private readonly config: ResolvedBillingConfig,
    private readonly stripeCustomerRepository: StripeCustomerRepository,
    private readonly stripeSubscriptionRepository: StripeSubscriptionRepository,
    private readonly stripePriceRepository: StripePriceRepository,
    private readonly notificationService: StripeWebhookNotificationService,
    private readonly webSocketService: WebSocketService,
    private readonly logger: AppLoggingService,
  ) {
    super(jsonApiService, companyRepository, clsService, CompanyDescriptor.model);
  }

  private get enabled(): boolean {
    return this.config.creditWarning?.enabled === true;
  }

  @OnEvent(COMPANY_CREDITS_USED_EVENT)
  async handleCreditsUsed(payload: CompanyCreditsUsedPayload): Promise<void> {
    if (!this.enabled) return;

    try {
      await this.runForCompany(payload.companyId, async () => {
        const company = await this.companyRepository.findByCompanyId({ companyId: payload.companyId });
        if (!this.canWarn({ company, payload })) return;

        const context = await this.resolveContext();
        if (!context) return;

        const warned = await this.companyRepository.markCreditWarningSent({
          thresholdPercent: this.config.creditWarning.thresholdPercent,
          offer: context.offer,
        });
        // Null: the condition no longer held, or a concurrent spend already sent it.
        if (!warned) return;

        await this.notificationService.sendCreditWarningEmail({
          stripeCustomerId: context.stripeCustomerId,
          offer: context.offer,
          interval: context.interval,
        });

        await this.broadcast(payload.companyId);
      });
    } catch (error) {
      this.logger.warn(
        `Credit warning check failed for company ${payload.companyId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  @OnEvent(COMPANY_CREDITS_GRANTED_EVENT)
  async handleCreditsGranted(payload: CompanyCreditsGrantedPayload): Promise<void> {
    if (!this.enabled) return;

    try {
      await this.runForCompany(payload.companyId, async () => {
        await this.companyRepository.resetCreditWarningPeriod({ grantedCredits: payload.grantedCredits });
      });
    } catch (error) {
      this.logger.warn(
        `Credit warning period reset failed for company ${payload.companyId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Records that the caller's company dismissed the credit warning.
   *
   * Does nothing when the feature is off.
   *
   * @throws ForbiddenException when `companyId` is not the caller's company
   */
  async dismiss(params: { companyId: string }): Promise<void> {
    if (!this.enabled) return;

    if (params.companyId !== this.clsService.get("companyId")) {
      throw new ForbiddenException("Cannot dismiss the credit warning of another company");
    }

    await this.companyRepository.markCreditWarningDismissed();
    await this.broadcast(params.companyId);
  }

  /**
   * The offer the warning would make to the CLS company, or null when it has no
   * active or trialing recurring subscription (no warning then).
   */
  async resolveOffer(): Promise<CreditWarningOffer | null> {
    return (await this.resolveContext())?.offer ?? null;
  }

  private async resolveContext(): Promise<CreditWarningContext | null> {
    const companyId = this.clsService.get("companyId");
    if (!companyId) return null;

    const stripeCustomer = await this.stripeCustomerRepository.findByCompanyId({ companyId });
    if (!stripeCustomer) return null;

    const subscriptions = await this.stripeSubscriptionRepository.findActiveByStripeCustomerId({
      stripeCustomerId: stripeCustomer.stripeCustomerId,
    });
    const subscription = subscriptions.find(
      (candidate: StripeSubscription) => candidate.stripePrice?.priceType === "recurring",
    );
    if (!subscription) return null;

    const price = subscription.stripePrice;
    const interval: "month" | "year" = price.recurringInterval === "year" ? "year" : "month";
    const base = { interval, stripeCustomerId: stripeCustomer.stripeCustomerId };

    if (subscription.status === "trialing") return { ...base, offer: "subscribe" };

    const currentToken = price.token ?? 0;
    const prices = await this.stripePriceRepository.findAll({ active: true });
    const biggerPlanExists = prices.some(
      (candidate) =>
        candidate.active &&
        candidate.priceType === "recurring" &&
        !candidate.isTrial &&
        candidate.recurringInterval === price.recurringInterval &&
        (candidate.token ?? 0) > currentToken,
    );

    return { ...base, offer: biggerPlanExists ? "upgrade-or-pack" : "pack" };
  }

  /** The cheap checks run before any Stripe lookup or write. */
  private canWarn(params: { company: Company | null; payload: CompanyCreditsUsedPayload }): boolean {
    const { company, payload } = params;
    if (!company) return false;
    if (company.creditWarningSentAt) return false;

    const granted = company.creditsGrantedThisPeriod ?? 0;
    if (!(granted > 0)) return false;

    const monthly = payload.availableMonthlyCredits ?? 0;
    const extra = payload.availableExtraCredits ?? 0;
    // Out of credits belongs to the existing out-of-credits banner and toast.
    if (!(monthly > 0 || extra > 0)) return false;

    return monthly + extra <= (granted * (100 - this.config.creditWarning.thresholdPercent)) / 100;
  }

  private async runForCompany(companyId: string, fn: () => Promise<void>): Promise<void> {
    await this.clsService.run(async () => {
      this.clsService.set("companyId", companyId);
      await fn();
    });
  }

  /** Makes every open page of the company refetch the user. Never throws. */
  private async broadcast(companyId: string): Promise<void> {
    try {
      await this.webSocketService.sendMessageToCompany(companyId, "company:subscription_updated", {
        type: "company:subscription_updated",
        companyId,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to broadcast company:subscription_updated for ${companyId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
