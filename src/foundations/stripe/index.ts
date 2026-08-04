/**
 * Stripe Foundation Module
 *
 * Unified Stripe integration with billing functionality, Neo4j persistence,
 * and webhook event processing.
 */

// Module
export * from "./stripe.module";

// Controllers
export * from "./controllers/billing.controller";

// Services - Stripe API Wrappers
export * from "./services/stripe.service";
export * from "./services/stripe.payment.service";
export * from "./services/stripe.portal.service";

// Services - Business Logic
export * from "./services/billing.service";

// DTOs
export * from "./dtos/create-setup-intent.dto";

// Error handling
export * from "./errors/stripe.errors";

// Re-export stripe-customer module for backward compatibility
export * from "../stripe-customer";

// Re-export stripe-price module for backward compatibility
export * from "../stripe-price";

// Re-export stripe-subscription module for backward compatibility
export * from "../stripe-subscription";

// Re-export stripe-invoice module for backward compatibility
export * from "../stripe-invoice";

// Re-export stripe-usage module for backward compatibility
export * from "../stripe-usage";

// Re-export stripe-webhook module for backward compatibility
export * from "../stripe-webhook";

// Re-export stripe-product module for backward compatibility
export * from "../stripe-product";

// Re-export stripe-promotion-code module for backward compatibility
export * from "../stripe-promotion-code";

// Re-export stripe-trial module for backward compatibility
export * from "../stripe-trial";
