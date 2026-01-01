import { Injectable } from "@nestjs/common";
import Stripe from "stripe";
import { StripeService } from "./stripe.service";
import { HandleStripeErrors } from "../errors/stripe.errors";

/**
 * Stripe Portal Service
 *
 * Manages Stripe Customer Portal sessions. The Customer Portal allows customers to
 * manage their subscription, billing details, and payment methods through a Stripe-hosted page.
 *
 * @example
 * ```typescript
 * const session = await stripePortalService.createPortalSession(
 *   'cus_abc123',
 *   'https://example.com/account'
 * );
 * // Redirect customer to: session.url
 * ```
 */
@Injectable()
export class StripePortalService {
  constructor(private readonly stripeService: StripeService) {}

  /**
   * Create a Customer Portal session
   *
   * @param stripeCustomerId - The Stripe customer ID
   * @param returnUrl - URL to redirect to when customer leaves the portal (optional)
   * @returns Promise resolving to the portal session with redirect URL
   * @throws {StripeError} If session creation fails
   *
   * @example
   * ```typescript
   * const session = await service.createPortalSession(
   *   'cus_abc123',
   *   'https://example.com/account'
   * );
   * res.redirect(session.url);
   * ```
   */
  @HandleStripeErrors()
  async createPortalSession(stripeCustomerId: string, returnUrl?: string): Promise<Stripe.BillingPortal.Session> {
    const stripe = this.stripeService.getClient();

    const sessionParams: Stripe.BillingPortal.SessionCreateParams = {
      customer: stripeCustomerId,
    };

    // Only set return_url if we have a non-empty value
    const effectiveReturnUrl = returnUrl || this.stripeService.getPortalReturnUrl();
    if (effectiveReturnUrl) {
      sessionParams.return_url = effectiveReturnUrl;
    }

    const configurationId = this.stripeService.getPortalConfigurationId();
    if (configurationId) {
      sessionParams.configuration = configurationId;
    }

    return stripe.billingPortal.sessions.create(sessionParams);
  }
}
