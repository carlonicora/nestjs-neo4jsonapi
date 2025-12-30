import { Injectable, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "crypto";
import { Neo4jService } from "../../../core/neo4j";
import { billingCustomerMeta } from "../../stripe/entities/billing-customer.meta";
import { StripeInvoice, StripeInvoiceStatus } from "../entities/stripe-invoice.entity";
import { stripeInvoiceMeta } from "../entities/stripe-invoice.meta";
import { StripeInvoiceModel } from "../entities/stripe-invoice.model";
import { stripeSubscriptionMeta } from "../../stripe-subscription/entities/stripe-subscription.meta";

/**
 * StripeInvoiceRepository
 *
 * Neo4j repository for managing Invoice nodes and their relationships to BillingCustomer and Subscription nodes.
 * Handles invoice history storage with status tracking and relationships.
 *
 * Key Features:
 * - Automatic constraint creation for ID and Stripe invoice ID uniqueness
 * - Query invoices by ID, customer, subscription, or status
 * - Create and update operations with relationship management
 * - Support for Stripe v20 API invoice structure
 * - Sync operations for webhook data
 * - Tracking of payment status and amounts
 * - Optional subscription linkage for subscription invoices
 * - Hosted invoice URL and PDF storage
 *
 * @example
 * ```typescript
 * const invoice = await stripeInvoiceRepository.create({
 *   billingCustomerId: 'cust_123',
 *   subscriptionId: 'sub_456',
 *   stripeInvoiceId: 'in_stripe789',
 *   stripeInvoiceNumber: 'INV-2024-001',
 *   status: 'paid',
 *   currency: 'usd',
 *   amountDue: 2999,
 *   amountPaid: 2999,
 *   amountRemaining: 0,
 *   subtotal: 2999,
 *   total: 2999,
 *   tax: null,
 *   periodStart: new Date(),
 *   periodEnd: new Date(),
 *   paidAt: new Date(),
 *   attemptCount: 1,
 *   attempted: true
 * });
 * ```
 */
@Injectable()
export class StripeInvoiceRepository implements OnModuleInit {
  constructor(private readonly neo4j: Neo4jService) {}

  /**
   * Initialize repository constraints
   *
   * Creates unique constraints on module initialization.
   */
  async onModuleInit() {
    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT ${stripeInvoiceMeta.nodeName}_id IF NOT EXISTS FOR (${stripeInvoiceMeta.nodeName}:${stripeInvoiceMeta.labelName}) REQUIRE ${stripeInvoiceMeta.nodeName}.id IS UNIQUE`,
    });

    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT ${stripeInvoiceMeta.nodeName}_stripeInvoiceId IF NOT EXISTS FOR (${stripeInvoiceMeta.nodeName}:${stripeInvoiceMeta.labelName}) REQUIRE ${stripeInvoiceMeta.nodeName}.stripeInvoiceId IS UNIQUE`,
    });
  }

  /**
   * Find invoices by billing customer ID
   *
   * @param params - Query parameters
   * @param params.billingCustomerId - Billing customer identifier
   * @param params.status - Optional filter by invoice status
   * @param params.limit - Optional limit (default: 100)
   * @returns Array of invoices ordered by creation date descending
   */
  async findByBillingCustomerId(params: {
    billingCustomerId: string;
    status?: StripeInvoiceStatus;
    limit?: number;
  }): Promise<StripeInvoice[]> {
    const query = this.neo4j.initQuery({ serialiser: StripeInvoiceModel });

    const whereParams: string[] = [];
    if (params.status) {
      query.queryParams.status = params.status;
      whereParams.push(`${stripeInvoiceMeta.nodeName}.status = $status`);
    }

    const where = whereParams.length > 0 ? `AND ${whereParams.join(" AND ")}` : "";

    query.queryParams.billingCustomerId = params.billingCustomerId;
    query.queryParams.limit = params.limit ?? 100;

    query.query = `
      MATCH (${stripeInvoiceMeta.nodeName}:${stripeInvoiceMeta.labelName})-[:BELONGS_TO]->(${billingCustomerMeta.nodeName}:${billingCustomerMeta.labelName} {id: $billingCustomerId})
      OPTIONAL MATCH (${stripeInvoiceMeta.nodeName})-[:FOR_SUBSCRIPTION]->(${stripeSubscriptionMeta.nodeName}:${stripeSubscriptionMeta.labelName})
      WHERE 1=1 ${where}
      RETURN ${stripeInvoiceMeta.nodeName}, ${stripeSubscriptionMeta.nodeName}
      ORDER BY ${stripeInvoiceMeta.nodeName}.createdAt DESC
      LIMIT $limit
    `;

    return this.neo4j.readMany(query);
  }

  /**
   * Find invoice by internal ID
   *
   * @param params - Query parameters
   * @param params.id - Internal invoice ID
   * @returns Invoice if found, null otherwise
   */
  async findById(params: { id: string }): Promise<StripeInvoice | null> {
    const query = this.neo4j.initQuery({ serialiser: StripeInvoiceModel });

    query.queryParams = {
      id: params.id,
    };

    query.query = `
      MATCH (${stripeInvoiceMeta.nodeName}:${stripeInvoiceMeta.labelName} {id: $id})-[:BELONGS_TO]->(${billingCustomerMeta.nodeName}:${billingCustomerMeta.labelName})
      OPTIONAL MATCH (${stripeInvoiceMeta.nodeName})-[:FOR_SUBSCRIPTION]->(${stripeSubscriptionMeta.nodeName}:${stripeSubscriptionMeta.labelName})
      RETURN ${stripeInvoiceMeta.nodeName}, ${billingCustomerMeta.nodeName}, ${stripeSubscriptionMeta.nodeName}
    `;

    return this.neo4j.readOne(query);
  }

  /**
   * Find invoice by Stripe invoice ID
   *
   * @param params - Query parameters
   * @param params.stripeInvoiceId - Stripe invoice ID
   * @returns Invoice if found, null otherwise
   */
  async findByStripeInvoiceId(params: { stripeInvoiceId: string }): Promise<StripeInvoice | null> {
    const query = this.neo4j.initQuery({ serialiser: StripeInvoiceModel });

    query.queryParams = {
      stripeInvoiceId: params.stripeInvoiceId,
    };

    query.query = `
      MATCH (${stripeInvoiceMeta.nodeName}:${stripeInvoiceMeta.labelName} {stripeInvoiceId: $stripeInvoiceId})
      RETURN ${stripeInvoiceMeta.nodeName}
    `;

    return this.neo4j.readOne(query);
  }

  /**
   * Create a new invoice
   *
   * Creates an Invoice node with BELONGS_TO relationship to BillingCustomer
   * and optional FOR_SUBSCRIPTION relationship to Subscription.
   *
   * @param params - Creation parameters
   * @param params.billingCustomerId - Billing customer ID to link to
   * @param params.subscriptionId - Optional subscription ID to link to
   * @param params.stripeInvoiceId - Stripe invoice ID
   * @param params.stripeInvoiceNumber - Stripe invoice number (e.g., 'INV-2024-001')
   * @param params.stripeHostedInvoiceUrl - Stripe hosted invoice URL
   * @param params.stripePdfUrl - Stripe PDF URL
   * @param params.status - Invoice status
   * @param params.currency - Currency code
   * @param params.amountDue - Amount due in smallest currency unit
   * @param params.amountPaid - Amount paid in smallest currency unit
   * @param params.amountRemaining - Amount remaining in smallest currency unit
   * @param params.subtotal - Subtotal before tax
   * @param params.total - Total amount including tax
   * @param params.tax - Tax amount (null if not applicable)
   * @param params.periodStart - Billing period start date
   * @param params.periodEnd - Billing period end date
   * @param params.dueDate - Optional payment due date
   * @param params.paidAt - Optional payment date
   * @param params.attemptCount - Number of payment attempts
   * @param params.attempted - Whether payment was attempted
   * @returns Created Invoice
   */
  async create(params: {
    billingCustomerId: string;
    subscriptionId?: string;
    stripeInvoiceId: string;
    stripeInvoiceNumber: string | null;
    stripeHostedInvoiceUrl: string | null;
    stripePdfUrl: string | null;
    status: StripeInvoiceStatus;
    currency: string;
    amountDue: number;
    amountPaid: number;
    amountRemaining: number;
    subtotal: number;
    total: number;
    tax: number | null;
    periodStart: Date;
    periodEnd: Date;
    dueDate: Date | null;
    paidAt: Date | null;
    attemptCount: number;
    attempted: boolean;
  }): Promise<StripeInvoice> {
    const query = this.neo4j.initQuery({ serialiser: StripeInvoiceModel });

    const id = randomUUID();

    query.queryParams = {
      id,
      billingCustomerId: params.billingCustomerId,
      subscriptionId: params.subscriptionId ?? null,
      stripeInvoiceId: params.stripeInvoiceId,
      stripeInvoiceNumber: params.stripeInvoiceNumber,
      stripeHostedInvoiceUrl: params.stripeHostedInvoiceUrl,
      stripePdfUrl: params.stripePdfUrl,
      status: params.status,
      currency: params.currency,
      amountDue: params.amountDue,
      amountPaid: params.amountPaid,
      amountRemaining: params.amountRemaining,
      subtotal: params.subtotal,
      total: params.total,
      tax: params.tax,
      periodStart: params.periodStart.toISOString(),
      periodEnd: params.periodEnd.toISOString(),
      dueDate: params.dueDate?.toISOString() ?? null,
      paidAt: params.paidAt?.toISOString() ?? null,
      attemptCount: params.attemptCount,
      attempted: params.attempted,
    };

    const subscriptionMatch = params.subscriptionId
      ? `MATCH (${stripeSubscriptionMeta.nodeName}:${stripeSubscriptionMeta.labelName} {id: $subscriptionId})`
      : "";
    const subscriptionRelation = params.subscriptionId
      ? `CREATE (${stripeInvoiceMeta.nodeName})-[:FOR_SUBSCRIPTION]->(${stripeSubscriptionMeta.nodeName})`
      : "";

    query.query = `
      MATCH (${billingCustomerMeta.nodeName}:${billingCustomerMeta.labelName} {id: $billingCustomerId})
      ${subscriptionMatch}
      CREATE (${stripeInvoiceMeta.nodeName}:${stripeInvoiceMeta.labelName} {
        id: $id,
        stripeInvoiceId: $stripeInvoiceId,
        stripeInvoiceNumber: $stripeInvoiceNumber,
        stripeHostedInvoiceUrl: $stripeHostedInvoiceUrl,
        stripePdfUrl: $stripePdfUrl,
        status: $status,
        currency: $currency,
        amountDue: $amountDue,
        amountPaid: $amountPaid,
        amountRemaining: $amountRemaining,
        subtotal: $subtotal,
        total: $total,
        tax: $tax,
        periodStart: datetime($periodStart),
        periodEnd: datetime($periodEnd),
        dueDate: CASE WHEN $dueDate IS NOT NULL THEN datetime($dueDate) ELSE null END,
        paidAt: CASE WHEN $paidAt IS NOT NULL THEN datetime($paidAt) ELSE null END,
        attemptCount: $attemptCount,
        attempted: $attempted,
        createdAt: datetime(),
        updatedAt: datetime()
      })
      CREATE (${stripeInvoiceMeta.nodeName})-[:BELONGS_TO]->(${billingCustomerMeta.nodeName})
      ${subscriptionRelation}
      RETURN ${stripeInvoiceMeta.nodeName}
    `;

    return this.neo4j.writeOne(query);
  }

  /**
   * Update invoice by Stripe invoice ID
   *
   * Used primarily by webhook handlers to sync invoice data from Stripe.
   *
   * @param params - Update parameters
   * @param params.stripeInvoiceId - Stripe invoice ID
   * @param params.status - Optional new status
   * @param params.amountDue - Optional new amount due
   * @param params.amountPaid - Optional new amount paid
   * @param params.amountRemaining - Optional new amount remaining
   * @param params.paidAt - Optional payment date (null to clear)
   * @param params.attemptCount - Optional new attempt count
   * @param params.attempted - Optional new attempted flag
   * @param params.stripeHostedInvoiceUrl - Optional new hosted invoice URL
   * @param params.stripePdfUrl - Optional new PDF URL
   * @returns Updated Invoice
   */
  async updateByStripeInvoiceId(params: {
    stripeInvoiceId: string;
    status?: StripeInvoiceStatus;
    amountDue?: number;
    amountPaid?: number;
    amountRemaining?: number;
    paidAt?: Date | null;
    attemptCount?: number;
    attempted?: boolean;
    stripeHostedInvoiceUrl?: string;
    stripePdfUrl?: string;
  }): Promise<StripeInvoice> {
    const query = this.neo4j.initQuery({ serialiser: StripeInvoiceModel });

    const setParams: string[] = [`${stripeInvoiceMeta.nodeName}.updatedAt = datetime()`];

    query.queryParams = { stripeInvoiceId: params.stripeInvoiceId };

    if (params.status !== undefined) {
      query.queryParams.status = params.status;
      setParams.push(`${stripeInvoiceMeta.nodeName}.status = $status`);
    }
    if (params.amountDue !== undefined) {
      query.queryParams.amountDue = params.amountDue;
      setParams.push(`${stripeInvoiceMeta.nodeName}.amountDue = $amountDue`);
    }
    if (params.amountPaid !== undefined) {
      query.queryParams.amountPaid = params.amountPaid;
      setParams.push(`${stripeInvoiceMeta.nodeName}.amountPaid = $amountPaid`);
    }
    if (params.amountRemaining !== undefined) {
      query.queryParams.amountRemaining = params.amountRemaining;
      setParams.push(`${stripeInvoiceMeta.nodeName}.amountRemaining = $amountRemaining`);
    }
    if (params.paidAt !== undefined) {
      query.queryParams.paidAt = params.paidAt?.toISOString() ?? null;
      setParams.push(
        `${stripeInvoiceMeta.nodeName}.paidAt = CASE WHEN $paidAt IS NOT NULL THEN datetime($paidAt) ELSE null END`,
      );
    }
    if (params.attemptCount !== undefined) {
      query.queryParams.attemptCount = params.attemptCount;
      setParams.push(`${stripeInvoiceMeta.nodeName}.attemptCount = $attemptCount`);
    }
    if (params.attempted !== undefined) {
      query.queryParams.attempted = params.attempted;
      setParams.push(`${stripeInvoiceMeta.nodeName}.attempted = $attempted`);
    }
    if (params.stripeHostedInvoiceUrl !== undefined) {
      query.queryParams.stripeHostedInvoiceUrl = params.stripeHostedInvoiceUrl;
      setParams.push(`${stripeInvoiceMeta.nodeName}.stripeHostedInvoiceUrl = $stripeHostedInvoiceUrl`);
    }
    if (params.stripePdfUrl !== undefined) {
      query.queryParams.stripePdfUrl = params.stripePdfUrl;
      setParams.push(`${stripeInvoiceMeta.nodeName}.stripePdfUrl = $stripePdfUrl`);
    }

    query.query = `
      MATCH (${stripeInvoiceMeta.nodeName}:${stripeInvoiceMeta.labelName} {stripeInvoiceId: $stripeInvoiceId})
      SET ${setParams.join(", ")}
      RETURN ${stripeInvoiceMeta.nodeName}
    `;

    return this.neo4j.writeOne(query);
  }
}
