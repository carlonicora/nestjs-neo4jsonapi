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
export * from "./controllers/webhook.controller";

// Services - Stripe API Wrappers
export * from "./services/stripe.service";
export * from "./services/stripe.customer.service";
export * from "./services/stripe.invoice.service";
export * from "./services/stripe.payment.service";
export * from "./services/stripe.portal.service";
export * from "./services/stripe.usage.service";
export * from "./services/stripe.webhook.service";

// Services - Business Logic
export * from "./services/billing.service";
export * from "./services/invoice.service";
export * from "./services/usage.service";
export * from "./services/notification.service";

// Repositories
export * from "./repositories/billing-customer.repository";
export * from "./repositories/invoice.repository";
export * from "./repositories/usage-record.repository";
export * from "./repositories/webhook-event.repository";

// Entities
export * from "./entities/billing-customer.entity";
export * from "./entities/billing-customer.model";
export * from "./entities/billing-customer.meta";
export * from "./entities/invoice.entity";
export * from "./entities/invoice.model";
export * from "./entities/invoice.meta";
export * from "./entities/usage-record.entity";
export * from "./entities/usage-record.model";
export * from "./entities/usage-record.meta";
export * from "./entities/webhook-event.entity";
export * from "./entities/webhook-event.model";
export * from "./entities/webhook-event.meta";

// Serializers
export * from "./serialisers/billing-customer.serialiser";
export * from "./serialisers/invoice.serialiser";
export * from "./serialisers/usage-record.serialiser";
export * from "./serialisers/webhook-event.serialiser";

// DTOs
export * from "./dtos/create-customer.dto";
export * from "./dtos/create-setup-intent.dto";
export * from "./dtos/report-usage.dto";

// Processors
export * from "./processors/webhook.processor";

// Error handling
export * from "./errors/stripe.errors";

// Re-export stripe-price module for backward compatibility
export * from "../stripe-price";

// Re-export stripe-subscription module for backward compatibility
export * from "../stripe-subscription";
