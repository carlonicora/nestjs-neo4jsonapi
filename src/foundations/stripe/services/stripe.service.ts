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

  /**
   * Initialize Stripe SDK on module initialization
   *
   * Lazily loads the Stripe SDK and configures it with:
   * - API version: 2024-11-20.acacia
   * - TypeScript support enabled
   * - Max network retries: 3
   * - Timeout: 30 seconds
   *
   * @remarks
   * If STRIPE_SECRET_KEY is not configured, logs a warning and disables Stripe features
   */
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

  /**
   * Get the initialized Stripe client instance
   *
   * @returns Configured Stripe SDK instance
   * @throws Error if Stripe is not initialized (missing STRIPE_SECRET_KEY)
   *
   * @example
   * ```typescript
   * const stripe = this.stripeService.getClient();
   * const customer = await stripe.customers.retrieve('cus_123');
   * ```
   */
  getClient(): Stripe {
    if (!this.stripe) {
      throw new Error("Stripe not initialized. Please configure STRIPE_SECRET_KEY.");
    }
    return this.stripe;
  }

  /**
   * Check if Stripe SDK is initialized and configured
   *
   * @returns true if Stripe is configured and ready, false otherwise
   *
   * @example
   * ```typescript
   * if (this.stripeService.isConfigured()) {
   *   // Stripe operations available
   * }
   * ```
   */
  isConfigured(): boolean {
    return !!this.stripe;
  }

  /**
   * Get the Stripe publishable key for frontend use
   *
   * Used to initialize Stripe.js on the frontend for collecting payment methods
   *
   * @returns Stripe publishable key (pk_test_... or pk_live_...)
   * @throws Error if Stripe configuration is not available
   *
   * @example
   * ```typescript
   * const publishableKey = this.stripeService.getPublishableKey();
   * // Send to frontend for Stripe.js initialization
   * ```
   */
  getPublishableKey(): string {
    if (!this.stripeConfig) {
      throw new Error("Stripe configuration not available");
    }
    return this.stripeConfig.publishableKey;
  }

  /**
   * Get the webhook signing secret for webhook verification
   *
   * Used to verify that webhook events are genuinely from Stripe
   *
   * @returns Webhook signing secret (whsec_...)
   * @throws Error if Stripe configuration is not available
   *
   * @example
   * ```typescript
   * const webhookSecret = this.stripeService.getWebhookSecret();
   * const event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
   * ```
   */
  getWebhookSecret(): string {
    if (!this.stripeConfig) {
      throw new Error("Stripe configuration not available");
    }
    return this.stripeConfig.webhookSecret;
  }

  /**
   * Get the customer portal return URL
   *
   * URL where customers are redirected after using the Stripe Customer Portal
   *
   * @returns Return URL for customer portal sessions
   * @throws Error if Stripe configuration is not available
   *
   * @example
   * ```typescript
   * const returnUrl = this.stripeService.getPortalReturnUrl();
   * // Use when creating portal sessions
   * ```
   */
  getPortalReturnUrl(): string {
    if (!this.stripeConfig) {
      throw new Error("Stripe configuration not available");
    }
    return this.stripeConfig.portalReturnUrl;
  }

  /**
   * Get the customer portal configuration ID (if configured)
   *
   * Optional portal configuration ID for customizing the Stripe Customer Portal appearance
   *
   * @returns Portal configuration ID or undefined if not configured
   *
   * @example
   * ```typescript
   * const configId = this.stripeService.getPortalConfigurationId();
   * if (configId) {
   *   // Use custom portal configuration
   * }
   * ```
   */
  getPortalConfigurationId(): string | undefined {
    return this.stripeConfig?.portalConfigurationId || undefined;
  }
}
