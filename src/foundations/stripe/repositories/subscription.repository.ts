import { Injectable, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "crypto";
import { Neo4jService } from "@carlonicora/nestjs-neo4jsonapi";
import { billingCustomerMeta } from "../entities/billing-customer.meta";
import { stripePriceMeta } from "../entities/stripe-price.meta";
import { stripeProductMeta } from "../entities/stripe-product.meta";
import { Subscription, SubscriptionStatus } from "../entities/subscription.entity";
import { subscriptionMeta } from "../entities/subscription.meta";
import { SubscriptionModel } from "../entities/subscription.model";

/**
 * SubscriptionRepository
 *
 * Neo4j repository for managing Subscription nodes and their relationships to BillingCustomer and Price nodes.
 * Handles subscription lifecycle data storage and queries with status filtering.
 *
 * Key Features:
 * - Automatic constraint creation for ID and Stripe subscription ID uniqueness
 * - Query subscriptions by customer, status, or Stripe ID
 * - Create and update operations with relationship management
 * - Support for plan changes by updating price relationships
 * - Sync operations for webhook data
 * - Track trial periods, billing cycles, and cancellation status
 * - Bulk cancel operations for customer deletion
 *
 * @example
 * ```typescript
 * const subscription = await subscriptionRepository.create({
 *   billingCustomerId: 'cust_123',
 *   priceId: 'price_456',
 *   stripeSubscriptionId: 'sub_stripe789',
 *   status: 'active',
 *   currentPeriodStart: new Date(),
 *   currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
 *   cancelAtPeriodEnd: false,
 *   quantity: 1
 * });
 * ```
 */
@Injectable()
export class SubscriptionRepository implements OnModuleInit {
  constructor(private readonly neo4j: Neo4jService) {}

  /**
   * Initialize repository constraints
   *
   * Creates unique constraints and indexes on module initialization.
   */
  async onModuleInit() {
    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT ${subscriptionMeta.nodeName}_id IF NOT EXISTS FOR (${subscriptionMeta.nodeName}:${subscriptionMeta.labelName}) REQUIRE ${subscriptionMeta.nodeName}.id IS UNIQUE`,
    });

    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT ${subscriptionMeta.nodeName}_stripeSubscriptionId IF NOT EXISTS FOR (${subscriptionMeta.nodeName}:${subscriptionMeta.labelName}) REQUIRE ${subscriptionMeta.nodeName}.stripeSubscriptionId IS UNIQUE`,
    });
  }

  /**
   * Find subscriptions by billing customer ID
   *
   * @param params - Query parameters
   * @param params.billingCustomerId - Billing customer identifier
   * @param params.status - Optional filter by subscription status
   * @returns Array of subscriptions ordered by creation date descending
   */
  async findByBillingCustomerId(params: {
    billingCustomerId: string;
    status?: SubscriptionStatus;
  }): Promise<Subscription[]> {
    const query = this.neo4j.initQuery({ serialiser: SubscriptionModel });

    const whereParams: string[] = [];
    if (params.status) {
      query.queryParams.status = params.status;
      whereParams.push(`${subscriptionMeta.nodeName}.status = $status`);
    }

    const where = whereParams.length > 0 ? `AND ${whereParams.join(" AND ")}` : "";

    query.queryParams.billingCustomerId = params.billingCustomerId;

    query.query = `
      MATCH (${subscriptionMeta.nodeName}:${subscriptionMeta.labelName})-[:BELONGS_TO]->(${billingCustomerMeta.nodeName}:${billingCustomerMeta.labelName} {id: $billingCustomerId})
      MATCH (${subscriptionMeta.nodeName})-[:USES_PRICE]->(${stripePriceMeta.nodeName}:${stripePriceMeta.labelName})-[:BELONGS_TO]->(${stripeProductMeta.nodeName}:${stripeProductMeta.labelName})
      WHERE 1=1 ${where}
      RETURN ${subscriptionMeta.nodeName}, ${stripePriceMeta.nodeName}, ${stripeProductMeta.nodeName}
      ORDER BY ${subscriptionMeta.nodeName}.createdAt DESC
    `;

    return this.neo4j.readMany(query);
  }

  /**
   * Find subscription by internal ID
   *
   * @param params - Query parameters
   * @param params.id - Internal subscription ID
   * @returns Subscription if found, null otherwise
   */
  async findById(params: { id: string }): Promise<Subscription | null> {
    const query = this.neo4j.initQuery({ serialiser: SubscriptionModel });

    query.queryParams = {
      id: params.id,
    };

    query.query = `
      MATCH (${subscriptionMeta.nodeName}:${subscriptionMeta.labelName} {id: $id})-[:BELONGS_TO]->(${billingCustomerMeta.nodeName}:${billingCustomerMeta.labelName})
      MATCH (${subscriptionMeta.nodeName})-[:USES_PRICE]->(${stripePriceMeta.nodeName}:${stripePriceMeta.labelName})-[:BELONGS_TO]->(${stripeProductMeta.nodeName}:${stripeProductMeta.labelName})
      RETURN ${subscriptionMeta.nodeName}, ${stripePriceMeta.nodeName}, ${stripeProductMeta.nodeName}
    `;

    return this.neo4j.readOne(query);
  }

  /**
   * Find subscription by Stripe subscription ID
   *
   * @param params - Query parameters
   * @param params.stripeSubscriptionId - Stripe subscription ID
   * @returns Subscription if found, null otherwise
   */
  async findByStripeSubscriptionId(params: { stripeSubscriptionId: string }): Promise<Subscription | null> {
    const query = this.neo4j.initQuery({ serialiser: SubscriptionModel });

    query.queryParams = {
      stripeSubscriptionId: params.stripeSubscriptionId,
    };

    query.query = `
      MATCH (${subscriptionMeta.nodeName}:${subscriptionMeta.labelName} {stripeSubscriptionId: $stripeSubscriptionId})-[:BELONGS_TO]->(${billingCustomerMeta.nodeName}:${billingCustomerMeta.labelName})
      MATCH (${subscriptionMeta.nodeName})-[:USES_PRICE]->(${stripePriceMeta.nodeName}:${stripePriceMeta.labelName})-[:BELONGS_TO]->(${stripeProductMeta.nodeName}:${stripeProductMeta.labelName})
      RETURN ${subscriptionMeta.nodeName}, ${stripePriceMeta.nodeName}, ${stripeProductMeta.nodeName}
    `;

    return this.neo4j.readOne(query);
  }

  /**
   * Create a new subscription
   *
   * Creates a Subscription node with BELONGS_TO relationship to BillingCustomer
   * and USES_PRICE relationship to StripePrice.
   *
   * @param params - Creation parameters
   * @param params.billingCustomerId - Billing customer ID to link to
   * @param params.priceId - Price ID to link to
   * @param params.stripeSubscriptionId - Stripe subscription ID
   * @param params.stripeSubscriptionItemId - Optional Stripe subscription item ID
   * @param params.status - Subscription status
   * @param params.currentPeriodStart - Current billing period start date
   * @param params.currentPeriodEnd - Current billing period end date
   * @param params.cancelAtPeriodEnd - Whether subscription cancels at period end
   * @param params.trialStart - Optional trial start date
   * @param params.trialEnd - Optional trial end date
   * @param params.quantity - Subscription quantity
   * @returns Created Subscription
   */
  async create(params: {
    billingCustomerId: string;
    priceId: string;
    stripeSubscriptionId: string;
    stripeSubscriptionItemId?: string;
    status: SubscriptionStatus;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    cancelAtPeriodEnd: boolean;
    trialStart?: Date;
    trialEnd?: Date;
    quantity: number;
  }): Promise<Subscription> {
    const query = this.neo4j.initQuery({ serialiser: SubscriptionModel });

    const id = randomUUID();

    query.queryParams = {
      id,
      billingCustomerId: params.billingCustomerId,
      priceId: params.priceId,
      stripeSubscriptionId: params.stripeSubscriptionId,
      stripeSubscriptionItemId: params.stripeSubscriptionItemId ?? null,
      status: params.status,
      currentPeriodStart: params.currentPeriodStart.toISOString(),
      currentPeriodEnd: params.currentPeriodEnd.toISOString(),
      cancelAtPeriodEnd: params.cancelAtPeriodEnd,
      trialStart: params.trialStart?.toISOString() ?? null,
      trialEnd: params.trialEnd?.toISOString() ?? null,
      quantity: params.quantity,
    };

    query.query = `
      MATCH (${billingCustomerMeta.nodeName}:${billingCustomerMeta.labelName} {id: $billingCustomerId})
      MATCH (${stripePriceMeta.nodeName}:${stripePriceMeta.labelName} {id: $priceId})-[:BELONGS_TO]->(${stripeProductMeta.nodeName}:${stripeProductMeta.labelName})
      CREATE (${subscriptionMeta.nodeName}:${subscriptionMeta.labelName} {
        id: $id,
        stripeSubscriptionId: $stripeSubscriptionId,
        stripeSubscriptionItemId: $stripeSubscriptionItemId,
        status: $status,
        currentPeriodStart: datetime($currentPeriodStart),
        currentPeriodEnd: datetime($currentPeriodEnd),
        cancelAtPeriodEnd: $cancelAtPeriodEnd,
        trialStart: CASE WHEN $trialStart IS NOT NULL THEN datetime($trialStart) ELSE null END,
        trialEnd: CASE WHEN $trialEnd IS NOT NULL THEN datetime($trialEnd) ELSE null END,
        quantity: $quantity,
        createdAt: datetime(),
        updatedAt: datetime()
      })
      CREATE (${subscriptionMeta.nodeName})-[:BELONGS_TO]->(${billingCustomerMeta.nodeName})
      CREATE (${subscriptionMeta.nodeName})-[:USES_PRICE]->(${stripePriceMeta.nodeName})
      RETURN ${subscriptionMeta.nodeName}, ${stripePriceMeta.nodeName}, ${stripeProductMeta.nodeName}
    `;

    return this.neo4j.writeOne(query);
  }

  /**
   * Update subscription by internal ID
   *
   * @param params - Update parameters
   * @param params.id - Internal subscription ID
   * @param params.status - Optional new status
   * @param params.currentPeriodStart - Optional new period start
   * @param params.currentPeriodEnd - Optional new period end
   * @param params.cancelAtPeriodEnd - Optional cancel at period end flag
   * @param params.canceledAt - Optional cancellation date (null to clear)
   * @param params.trialStart - Optional trial start date
   * @param params.trialEnd - Optional trial end date
   * @param params.pausedAt - Optional pause date (null to clear)
   * @param params.quantity - Optional new quantity
   * @returns Updated Subscription
   */
  async update(params: {
    id: string;
    status?: SubscriptionStatus;
    currentPeriodStart?: Date;
    currentPeriodEnd?: Date;
    cancelAtPeriodEnd?: boolean;
    canceledAt?: Date | null;
    trialStart?: Date;
    trialEnd?: Date;
    pausedAt?: Date | null;
    quantity?: number;
  }): Promise<Subscription> {
    const query = this.neo4j.initQuery({ serialiser: SubscriptionModel });

    const setParams: string[] = [];
    setParams.push(`${subscriptionMeta.nodeName}.updatedAt = datetime()`);

    if (params.status !== undefined) {
      setParams.push(`${subscriptionMeta.nodeName}.status = $status`);
    }
    if (params.currentPeriodStart !== undefined) {
      setParams.push(`${subscriptionMeta.nodeName}.currentPeriodStart = datetime($currentPeriodStart)`);
    }
    if (params.currentPeriodEnd !== undefined) {
      setParams.push(`${subscriptionMeta.nodeName}.currentPeriodEnd = datetime($currentPeriodEnd)`);
    }
    if (params.cancelAtPeriodEnd !== undefined) {
      setParams.push(`${subscriptionMeta.nodeName}.cancelAtPeriodEnd = $cancelAtPeriodEnd`);
    }
    if (params.canceledAt !== undefined) {
      setParams.push(
        params.canceledAt === null
          ? `${subscriptionMeta.nodeName}.canceledAt = null`
          : `${subscriptionMeta.nodeName}.canceledAt = datetime($canceledAt)`,
      );
    }
    if (params.trialStart !== undefined) {
      setParams.push(`${subscriptionMeta.nodeName}.trialStart = datetime($trialStart)`);
    }
    if (params.trialEnd !== undefined) {
      setParams.push(`${subscriptionMeta.nodeName}.trialEnd = datetime($trialEnd)`);
    }
    if (params.pausedAt !== undefined) {
      setParams.push(
        params.pausedAt === null
          ? `${subscriptionMeta.nodeName}.pausedAt = null`
          : `${subscriptionMeta.nodeName}.pausedAt = datetime($pausedAt)`,
      );
    }
    if (params.quantity !== undefined) {
      setParams.push(`${subscriptionMeta.nodeName}.quantity = $quantity`);
    }

    query.queryParams = {
      id: params.id,
      status: params.status,
      currentPeriodStart: params.currentPeriodStart?.toISOString(),
      currentPeriodEnd: params.currentPeriodEnd?.toISOString(),
      cancelAtPeriodEnd: params.cancelAtPeriodEnd,
      canceledAt: params.canceledAt?.toISOString(),
      trialStart: params.trialStart?.toISOString(),
      trialEnd: params.trialEnd?.toISOString(),
      pausedAt: params.pausedAt?.toISOString(),
      quantity: params.quantity,
    };

    query.query = `
      MATCH (${subscriptionMeta.nodeName}:${subscriptionMeta.labelName} {id: $id})-[:BELONGS_TO]->(${billingCustomerMeta.nodeName}:${billingCustomerMeta.labelName})
      MATCH (${subscriptionMeta.nodeName})-[:USES_PRICE]->(${stripePriceMeta.nodeName}:${stripePriceMeta.labelName})-[:BELONGS_TO]->(${stripeProductMeta.nodeName}:${stripeProductMeta.labelName})
      SET ${setParams.join(", ")}
      RETURN ${subscriptionMeta.nodeName}, ${stripePriceMeta.nodeName}, ${stripeProductMeta.nodeName}
    `;

    return this.neo4j.writeOne(query);
  }

  /**
   * Update subscription by Stripe subscription ID
   *
   * Used primarily by webhook handlers to sync subscription data from Stripe.
   *
   * @param params - Update parameters
   * @param params.stripeSubscriptionId - Stripe subscription ID
   * @param params.status - Optional new status
   * @param params.currentPeriodStart - Optional new period start
   * @param params.currentPeriodEnd - Optional new period end
   * @param params.cancelAtPeriodEnd - Optional cancel at period end flag
   * @param params.canceledAt - Optional cancellation date (null to clear)
   * @param params.trialStart - Optional trial start date
   * @param params.trialEnd - Optional trial end date
   * @param params.pausedAt - Optional pause date (null to clear)
   * @param params.quantity - Optional new quantity
   * @returns Updated Subscription if found, null otherwise
   */
  async updateByStripeSubscriptionId(params: {
    stripeSubscriptionId: string;
    status?: SubscriptionStatus;
    currentPeriodStart?: Date;
    currentPeriodEnd?: Date;
    cancelAtPeriodEnd?: boolean;
    canceledAt?: Date | null;
    trialStart?: Date;
    trialEnd?: Date;
    pausedAt?: Date | null;
    quantity?: number;
  }): Promise<Subscription | null> {
    const existing = await this.findByStripeSubscriptionId({ stripeSubscriptionId: params.stripeSubscriptionId });
    if (!existing) return null;

    return this.update({
      id: existing.id,
      ...params,
    });
  }

  /**
   * Update subscription price (change plan)
   *
   * Removes old USES_PRICE relationship and creates new one to different price.
   *
   * @param params - Update parameters
   * @param params.id - Internal subscription ID
   * @param params.newPriceId - New price ID to switch to
   * @returns Updated Subscription with new price relationship
   */
  async updatePrice(params: { id: string; newPriceId: string }): Promise<Subscription> {
    const query = this.neo4j.initQuery({ serialiser: SubscriptionModel });

    query.queryParams = {
      id: params.id,
      newPriceId: params.newPriceId,
    };

    query.query = `
      MATCH (${subscriptionMeta.nodeName}:${subscriptionMeta.labelName} {id: $id})-[:BELONGS_TO]->(${billingCustomerMeta.nodeName}:${billingCustomerMeta.labelName})
      MATCH (${subscriptionMeta.nodeName})-[oldRel:USES_PRICE]->(:${stripePriceMeta.labelName})
      DELETE oldRel
      WITH ${subscriptionMeta.nodeName}, ${billingCustomerMeta.nodeName}
      MATCH (newPrice:${stripePriceMeta.labelName} {id: $newPriceId})-[:BELONGS_TO]->(${stripeProductMeta.nodeName}:${stripeProductMeta.labelName})
      CREATE (${subscriptionMeta.nodeName})-[:USES_PRICE]->(newPrice)
      SET ${subscriptionMeta.nodeName}.updatedAt = datetime()
      RETURN ${subscriptionMeta.nodeName}, newPrice as ${stripePriceMeta.nodeName}, ${stripeProductMeta.nodeName}
    `;

    return this.neo4j.writeOne(query);
  }

  /**
   * Delete subscription
   *
   * Performs a DETACH DELETE to remove the subscription and all relationships.
   *
   * @param params - Deletion parameters
   * @param params.id - Internal subscription ID
   * @returns Promise that resolves when deletion is complete
   */
  async delete(params: { id: string }): Promise<void> {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      id: params.id,
    };

    query.query = `
      MATCH (${subscriptionMeta.nodeName}:${subscriptionMeta.labelName} {id: $id})
      DETACH DELETE ${subscriptionMeta.nodeName}
    `;

    await this.neo4j.writeOne(query);
  }

  /**
   * Cancel all active subscriptions for a Stripe customer
   *
   * Bulk operation to cancel all active, trialing, or past_due subscriptions
   * when a customer is deleted. Sets status to canceled and updates timestamps.
   *
   * @param params - Cancellation parameters
   * @param params.stripeCustomerId - Stripe customer ID
   * @returns Number of subscriptions canceled
   */
  async cancelAllByStripeCustomerId(params: { stripeCustomerId: string }): Promise<number> {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      stripeCustomerId: params.stripeCustomerId,
      canceledStatus: "canceled" as SubscriptionStatus,
      canceledAt: new Date().toISOString(),
    };

    query.query = `
      MATCH (${subscriptionMeta.nodeName}:${subscriptionMeta.labelName})-[:BELONGS_TO]->(${billingCustomerMeta.nodeName}:${billingCustomerMeta.labelName} {stripeCustomerId: $stripeCustomerId})
      WHERE ${subscriptionMeta.nodeName}.status IN ['active', 'trialing', 'past_due']
      SET ${subscriptionMeta.nodeName}.status = $canceledStatus,
          ${subscriptionMeta.nodeName}.canceledAt = datetime($canceledAt),
          ${subscriptionMeta.nodeName}.cancelAtPeriodEnd = false,
          ${subscriptionMeta.nodeName}.updatedAt = datetime()
      RETURN count(${subscriptionMeta.nodeName}) as count
    `;

    const result = await this.neo4j.writeOne(query);
    return result?.count ?? 0;
  }
}
