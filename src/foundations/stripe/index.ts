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
export * from "./controllers/billing-admin.controller";
export * from "./controllers/webhook.controller";

// Services - Stripe API Wrappers
export * from "./services/stripe.service";
export * from "./services/stripe.customer.service";
export * from "./services/stripe.invoice.service";
export * from "./services/stripe.payment.service";
export * from "./services/stripe.portal.service";
export * from "./services/stripe.product.service";
export * from "./services/stripe.subscription.service";
export * from "./services/stripe.usage.service";
export * from "./services/stripe.webhook.service";

// Services - Business Logic
export * from "./services/billing.service";
export * from "./services/billing-admin.service";
export * from "./services/subscription.service";
export * from "./services/invoice.service";
export * from "./services/usage.service";
export * from "./services/notification.service";

// Repositories
export * from "./repositories/billing-customer.repository";
export * from "./repositories/stripe-product.repository";
export * from "./repositories/stripe-price.repository";
export * from "./repositories/subscription.repository";
export * from "./repositories/invoice.repository";
export * from "./repositories/usage-record.repository";
export * from "./repositories/webhook-event.repository";

// Entities
export * from "./entities/billing-customer.entity";
export * from "./entities/billing-customer.model";
export * from "./entities/billing-customer.meta";
export * from "./entities/stripe-product.entity";
export * from "./entities/stripe-product.model";
export * from "./entities/stripe-product.meta";
export * from "./entities/stripe-price.entity";
export * from "./entities/stripe-price.model";
export * from "./entities/stripe-price.meta";
export * from "./entities/subscription.entity";
export * from "./entities/subscription.model";
export * from "./entities/subscription.meta";
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
export * from "./serialisers/stripe-product.serialiser";
export * from "./serialisers/stripe-price.serialiser";
export * from "./serialisers/subscription.serialiser";
export * from "./serialisers/invoice.serialiser";
export * from "./serialisers/usage-record.serialiser";
export * from "./serialisers/webhook-event.serialiser";

// DTOs
export * from "./dtos/create-customer.dto";
export * from "./dtos/create-product.dto";
export * from "./dtos/create-price.dto";
export * from "./dtos/create-subscription.dto";
export * from "./dtos/create-setup-intent.dto";
export * from "./dtos/report-usage.dto";

// Processors
export * from "./processors/webhook.processor";

// Error handling
export * from "./errors/stripe.errors";
