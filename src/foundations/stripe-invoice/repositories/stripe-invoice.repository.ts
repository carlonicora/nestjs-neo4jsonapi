import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { ClsService } from "nestjs-cls";
import { JsonApiCursorInterface } from "../../../core";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { companyMeta } from "../../company/entities/company.meta";
import { stripeCustomerMeta } from "../../stripe-customer/entities/stripe-customer.meta";
import { stripePriceMeta } from "../../stripe-price/entities/stripe-price.meta";
import { stripeProductMeta } from "../../stripe-product/entities/stripe-product.meta";
import { stripeSubscriptionMeta } from "../../stripe-subscription/entities/stripe-subscription.meta";
import { StripeInvoiceDescriptor } from "../entities/stripe-invoice";
import { StripeInvoice, StripeInvoiceStatus } from "../entities/stripe-invoice.entity";
import { stripeInvoiceMeta } from "../entities/stripe-invoice.meta";

const I = stripeInvoiceMeta.nodeName;

export type StripeInvoiceCreateParams = {
  stripeCustomerId: string;
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
};

/**
 * StripeInvoiceRepository
 *
 * Neo4j repository for StripeInvoice nodes:
 * `(stripeInvoice)-[:BELONGS_TO]->(stripeCustomer)` and the optional
 * `(stripeInvoice)-[:FOR_SUBSCRIPTION]->(stripeSubscription)`.
 *
 * Every read starts from `buildDefaultMatch()`: inside a request it is scoped to the caller's
 * company through the invoice's Stripe customer (`tenancy: { via: "stripeCustomer" }`); jobs with
 * no company in CLS (webhooks, notifications) reach every invoice through the `$companyId IS NULL`
 * branch.
 *
 * The customer-facing finders return the invoice column only, so neither the customer nor the
 * subscription is ever mapped onto the entity (kept as it was before the descriptor conversion).
 */
@Injectable()
export class StripeInvoiceRepository extends AbstractRepository<
  StripeInvoice,
  typeof StripeInvoiceDescriptor.relationships
> {
  protected readonly descriptor = StripeInvoiceDescriptor;

  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  /** The inherited id constraint, plus the unique Stripe invoice id. */
  async onModuleInit() {
    await super.onModuleInit();

    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT ${I}_stripeInvoiceId IF NOT EXISTS FOR (${I}:${stripeInvoiceMeta.labelName}) REQUIRE ${I}.stripeInvoiceId IS UNIQUE`,
    });
  }

  /**
   * Find invoices by billing customer ID
   *
   * @param params - Query parameters
   * @param params.stripeCustomerId - internal StripeCustomer id
   * @param params.status - accepted but not applied (kept as before the descriptor conversion)
   * @param params.cursor - pagination cursor
   * @returns Array of invoices, the page ordered by creation date descending
   */
  async findByStripeCustomerId(params: {
    stripeCustomerId: string;
    status?: StripeInvoiceStatus;
    cursor?: JsonApiCursorInterface;
  }): Promise<StripeInvoice[]> {
    const query = this.neo4j.initQuery({ serialiser: StripeInvoiceDescriptor.model, cursor: params.cursor });

    query.queryParams = { ...query.queryParams, stripeCustomerId: params.stripeCustomerId };

    query.query += `
      ${this.buildDefaultMatch()}
      MATCH (${I})-[:BELONGS_TO]->(:${stripeCustomerMeta.labelName} {id: $stripeCustomerId})

      {CURSOR}

      RETURN ${I}
      ORDER BY ${I}.createdAt DESC
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
    const query = this.neo4j.initQuery({ serialiser: StripeInvoiceDescriptor.model });

    query.queryParams = { ...query.queryParams, searchValue: params.id };

    query.query += `
      ${this.buildDefaultMatch({ searchField: "id" })}
      MATCH (${I})-[:BELONGS_TO]->(:${stripeCustomerMeta.labelName})
      RETURN ${I}
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
    const query = this.neo4j.initQuery({ serialiser: StripeInvoiceDescriptor.model });

    query.queryParams = { ...query.queryParams, searchValue: params.stripeInvoiceId };

    query.query += `
      ${this.buildDefaultMatch({ searchField: "stripeInvoiceId" })}
      RETURN ${I}
    `;

    return this.neo4j.readOne(query);
  }

  /**
   * Create a new invoice, or update it when it already exists
   *
   * MERGEs the Invoice node on stripeInvoiceId with BELONGS_TO relationship to
   * BillingCustomer and optional FOR_SUBSCRIPTION relationship to Subscription.
   * Stripe sends invoice.created, invoice.finalized and invoice.paid for one
   * invoice within milliseconds and the worker processes them in parallel: a
   * find-then-CREATE lets two of them both create it, and the uniqueness
   * constraint fails the second. On a match the changing fields are updated, as
   * updateByStripeInvoiceId does.
   *
   * @param params - Creation parameters
   * @param params.stripeCustomerId - Stripe customer ID to link to
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
  async create(params: StripeInvoiceCreateParams): Promise<StripeInvoice>;
  /** The inherited descriptor-driven create (kept callable, unused by the invoice sync). */
  async create(params: { id: string; [key: string]: any }): Promise<void>;
  async create(params: StripeInvoiceCreateParams | { id: string; [key: string]: any }): Promise<StripeInvoice | void> {
    if (!("stripeInvoiceId" in params && "stripeCustomerId" in params)) {
      return super.create(params as { id: string; [key: string]: any });
    }
    return this.createInvoice(params as StripeInvoiceCreateParams);
  }

  private async createInvoice(params: StripeInvoiceCreateParams): Promise<StripeInvoice> {
    const query = this.neo4j.initQuery({ serialiser: StripeInvoiceDescriptor.model });

    const id = randomUUID();

    query.queryParams = {
      id,
      stripeCustomerId: params.stripeCustomerId,
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
      ? `MERGE (${stripeInvoiceMeta.nodeName})-[:FOR_SUBSCRIPTION]->(${stripeSubscriptionMeta.nodeName})`
      : "";

    const invoice = stripeInvoiceMeta.nodeName;
    query.query = `
      MATCH (${stripeCustomerMeta.nodeName}:${stripeCustomerMeta.labelName} {id: $stripeCustomerId})
      ${subscriptionMatch}
      MERGE (${invoice}:${stripeInvoiceMeta.labelName} {stripeInvoiceId: $stripeInvoiceId})
      ON CREATE SET
        ${invoice}.id = $id,
        ${invoice}.currency = $currency,
        ${invoice}.subtotal = $subtotal,
        ${invoice}.total = $total,
        ${invoice}.tax = $tax,
        ${invoice}.periodStart = datetime($periodStart),
        ${invoice}.periodEnd = datetime($periodEnd),
        ${invoice}.dueDate = CASE WHEN $dueDate IS NOT NULL THEN datetime($dueDate) ELSE null END,
        ${invoice}.createdAt = datetime()
      SET
        ${invoice}.stripeInvoiceNumber = $stripeInvoiceNumber,
        ${invoice}.stripeHostedInvoiceUrl = $stripeHostedInvoiceUrl,
        ${invoice}.stripePdfUrl = $stripePdfUrl,
        ${invoice}.status = $status,
        ${invoice}.amountDue = $amountDue,
        ${invoice}.amountPaid = $amountPaid,
        ${invoice}.amountRemaining = $amountRemaining,
        ${invoice}.paidAt = CASE WHEN $paidAt IS NOT NULL THEN datetime($paidAt) ELSE null END,
        ${invoice}.attemptCount = $attemptCount,
        ${invoice}.attempted = $attempted,
        ${invoice}.updatedAt = datetime()
      MERGE (${invoice})-[:BELONGS_TO]->(${stripeCustomerMeta.nodeName})
      ${subscriptionRelation}
      RETURN ${invoice}
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
    const query = this.neo4j.initQuery({ serialiser: StripeInvoiceDescriptor.model });

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

  /**
   * Records what an invoice was for (WYR-98): the covered period of its first non-proration line,
   * the local price of that line (`FOR_PRICE`) and, for a one-time purchase, the `pi_`
   * StripeSubscription record of that purchase (`FOR_PURCHASE`). An absent period clears it
   * (all-proration invoice). `markChecked` sets `serviceLinesCheckedAt`, the backfill's marker.
   *
   * The ids come from Stripe on the worker (webhook sync, backfill), never from a client, and the
   * worker has no company in CLS, so the related-node company check would be existence only.
   *
   * @param params.stripeInvoiceId - Stripe invoice id (in_...)
   * @param params.servicePeriodStart - start of the covered period
   * @param params.servicePeriodEnd - end of the covered period
   * @param params.stripePriceId - Stripe price id of the line, only when stored locally
   * @param params.purchaseSubscriptionId - internal id of the one-time purchase's StripeSubscription (`pi_` record)
   * @param params.markChecked - set serviceLinesCheckedAt
   */
  async recordServiceLines(params: {
    stripeInvoiceId: string;
    servicePeriodStart?: Date;
    servicePeriodEnd?: Date;
    stripePriceId?: string;
    purchaseSubscriptionId?: string;
    markChecked: boolean;
  }): Promise<void> {
    // Resolve the related nodes from their Stripe ids, then run the relationship check that the
    // generic writers run, before linking them by internal id.
    const priceId = params.stripePriceId ? await this.findPriceId({ stripePriceId: params.stripePriceId }) : undefined;
    const purchaseId = params.purchaseSubscriptionId;

    await this.neo4j.validateRelatedNodes({
      nodes: [
        ...(priceId ? [{ id: priceId, label: stripePriceMeta.labelName }] : []),
        ...(purchaseId ? [{ id: purchaseId, label: stripeSubscriptionMeta.labelName }] : []),
      ],
    });

    const query = this.neo4j.initQuery({ serialiser: StripeInvoiceDescriptor.model });

    query.queryParams = {
      ...query.queryParams,
      stripeInvoiceId: params.stripeInvoiceId,
      servicePeriodStart: params.servicePeriodStart?.toISOString() ?? null,
      servicePeriodEnd: params.servicePeriodEnd?.toISOString() ?? null,
      ...(priceId ? { priceId } : {}),
      ...(purchaseId ? { purchaseId } : {}),
    };

    const markChecked = params.markChecked ? `SET ${I}.serviceLinesCheckedAt = datetime()` : ``;

    // The previous price edge is replaced, so the invoice keeps one FOR_PRICE edge.
    const priceLink = priceId
      ? `
      CALL {
        WITH ${I}
        MATCH (price:${stripePriceMeta.labelName} {id: $priceId})
        OPTIONAL MATCH (${I})-[previous:FOR_PRICE]->(other:${stripePriceMeta.labelName})
        WHERE other <> price
        DELETE previous
        MERGE (${I})-[:FOR_PRICE]->(price)
      }`
      : ``;

    const purchaseLink = purchaseId
      ? `
      CALL {
        WITH ${I}
        MATCH (purchase:${stripeSubscriptionMeta.labelName} {id: $purchaseId})
        MERGE (${I})-[:FOR_PURCHASE]->(purchase)
      }`
      : ``;

    query.query += `
      MATCH (${I}:${stripeInvoiceMeta.labelName} {stripeInvoiceId: $stripeInvoiceId})
      SET ${I}.servicePeriodStart = CASE WHEN $servicePeriodStart IS NOT NULL THEN datetime($servicePeriodStart) ELSE null END,
        ${I}.servicePeriodEnd = CASE WHEN $servicePeriodEnd IS NOT NULL THEN datetime($servicePeriodEnd) ELSE null END
      ${markChecked}
      ${priceLink}
      ${purchaseLink}
      RETURN ${I}
    `;

    await this.neo4j.writeOne(query);
  }

  /**
   * Internal id of the local StripePrice with this Stripe price id, or undefined when it is not
   * stored. StripePrice is not company-scoped, so the scalar read needs no company predicate.
   */
  private async findPriceId(params: { stripePriceId: string }): Promise<string | undefined> {
    const ids = await this.neo4j.readScalars({
      query: `
        MATCH (price:${stripePriceMeta.labelName} {stripePriceId: $stripePriceId})
        RETURN price.id AS id
        LIMIT 1
      `,
      queryParams: { stripePriceId: params.stripePriceId },
      map: (row) => String(row.id),
    });
    return ids[0];
  }

  /**
   * Stripe ids of the invoices whose service lines were never read (the backfill's work list).
   * Not paginated: it serves the worker backfill, never an endpoint.
   */
  async findWithoutServiceLines(): Promise<string[]> {
    const query = this.neo4j.initQuery({ serialiser: StripeInvoiceDescriptor.model, fetchAll: true });

    query.query += `
      ${this.buildDefaultMatch()}
      WHERE ${I}.serviceLinesCheckedAt IS NULL
      RETURN ${I}
      ORDER BY ${I}.createdAt ASC
    `;

    const invoices: StripeInvoice[] = await this.neo4j.readMany(query);
    return invoices.map((invoice) => invoice.stripeInvoiceId);
  }

  /** Whether a StripePrice with this Stripe price id is stored locally. */
  async priceExists(params: { stripePriceId: string }): Promise<boolean> {
    const total = await this.neo4j.readCount(
      `
      MATCH (price:${stripePriceMeta.labelName} {stripePriceId: $stripePriceId})
      RETURN count(price) AS total
    `,
      { stripePriceId: params.stripePriceId },
    );

    return total > 0;
  }

  /**
   * Every non-draft invoice of a company, for the platform administrator (WYR-98): newest first
   * by payment date (else period start), each with its recorded price and the price's product,
   * and `forSubscription` (whether it has a FOR_SUBSCRIPTION edge). Not paginated.
   *
   * The route is admin-only and the administrator belongs to no company, so the company comes
   * from the URL, bound as `$adminCompanyId` and joined explicitly through its Stripe customer
   * after `buildDefaultMatch()` (which lets every row through when the caller has no CLS company).
   *
   * @param params.companyId - the company id from the URL
   */
  async findForCompanyAdmin(params: { companyId: string }): Promise<StripeInvoice[]> {
    const query = this.neo4j.initQuery({ serialiser: StripeInvoiceDescriptor.model, fetchAll: true });

    query.queryParams = { ...query.queryParams, adminCompanyId: params.companyId };

    query.query += `
      ${this.buildDefaultMatch()}
      MATCH (${I})-[:BELONGS_TO]->(:${stripeCustomerMeta.labelName})-[:BELONGS_TO]->(:${companyMeta.labelName} {id: $adminCompanyId})
      WHERE ${I}.status <> 'draft'
      WITH DISTINCT ${I}
      OPTIONAL MATCH (${I})-[:FOR_PRICE]->(${I}_stripePrice:${stripePriceMeta.labelName})
      OPTIONAL MATCH (${I}_stripePrice)-[:BELONGS_TO]->(${I}_stripePrice_${stripeProductMeta.nodeName}:${stripeProductMeta.labelName})
      WITH ${I}, ${I}_stripePrice, ${I}_stripePrice_${stripeProductMeta.nodeName},
        EXISTS { MATCH (${I})-[:FOR_SUBSCRIPTION]->(:${stripeSubscriptionMeta.labelName}) } AS forSubscription
      ORDER BY coalesce(${I}.paidAt, ${I}.periodStart) DESC
      RETURN ${I}, ${I}_stripePrice, ${I}_stripePrice_${stripeProductMeta.nodeName}, forSubscription
    `;

    return this.neo4j.readMany(query);
  }
}
