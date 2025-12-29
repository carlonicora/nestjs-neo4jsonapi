import { Injectable, OnModuleInit } from "@nestjs/common";
import type Stripe from "stripe";
import { baseConfig } from "../../../config/base.config";

/**
 * Stripe Service
 *
 * Core Stripe SDK initialization and configuration
 *
 * Features:
 * - Lazy Stripe SDK initialization
 * - Configuration validation
 * - Type-safe Stripe client access
 * - Webhook secret management
 * - Portal configuration
 *
 * @example
 * ```typescript
 * constructor(private readonly stripeService: StripeService) {}
 *
 * async createCustomer() {
 *   const stripe = this.stripeService.getClient();
 *   return stripe.customers.create({ email: 'test@example.com' });
 * }
 * ```
 */
@Injectable()
export class StripeService implements OnModuleInit {
  private stripe: Stripe | null = null;
  private readonly stripeConfig = baseConfig.stripe;

  async onModuleInit() {
    if (!this.stripeConfig?.secretKey) {
      console.warn("Stripe secret key not configured - Stripe features disabled");
      return;
    }

    // Dynamically import Stripe only when needed
    const StripeModule = await import("stripe");
    const StripeConstructor = StripeModule.default;

    this.stripe = new StripeConstructor(this.stripeConfig.secretKey, {
      apiVersion: (this.stripeConfig.apiVersion as any) || "2024-11-20.acacia",
      typescript: true,
      maxNetworkRetries: 3,
      timeout: 30000,
    });
  }

  getClient(): Stripe {
    if (!this.stripe) {
      throw new Error("Stripe not initialized. Please configure STRIPE_SECRET_KEY.");
    }
    return this.stripe;
  }

  isConfigured(): boolean {
    return !!this.stripe;
  }

  getPublishableKey(): string {
    if (!this.stripeConfig) {
      throw new Error("Stripe configuration not available");
    }
    return this.stripeConfig.publishableKey;
  }

  getWebhookSecret(): string {
    if (!this.stripeConfig) {
      throw new Error("Stripe configuration not available");
    }
    return this.stripeConfig.webhookSecret;
  }

  getPortalReturnUrl(): string {
    if (!this.stripeConfig) {
      throw new Error("Stripe configuration not available");
    }
    return this.stripeConfig.portalReturnUrl;
  }

  getPortalConfigurationId(): string | undefined {
    return this.stripeConfig?.portalConfigurationId || undefined;
  }
}
