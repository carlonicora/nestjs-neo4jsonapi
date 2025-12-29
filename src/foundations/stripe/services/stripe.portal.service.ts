import { Injectable } from "@nestjs/common";
import Stripe from "stripe";
import { StripeService } from "./stripe.service";
import { HandleStripeErrors } from "../errors/stripe.errors";

@Injectable()
export class StripePortalService {
  constructor(private readonly stripeService: StripeService) {}

  @HandleStripeErrors()
  async createPortalSession(stripeCustomerId: string, returnUrl?: string): Promise<Stripe.BillingPortal.Session> {
    const stripe = this.stripeService.getClient();

    const sessionParams: Stripe.BillingPortal.SessionCreateParams = {
      customer: stripeCustomerId,
      return_url: returnUrl || this.stripeService.getPortalReturnUrl(),
    };

    const configurationId = this.stripeService.getPortalConfigurationId();
    if (configurationId) {
      sessionParams.configuration = configurationId;
    }

    return stripe.billingPortal.sessions.create(sessionParams);
  }
}
