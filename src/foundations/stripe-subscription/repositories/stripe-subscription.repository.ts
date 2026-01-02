import { Injectable, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "crypto";
import { Neo4jService } from "../../../core/neo4j";
import { companyMeta } from "../../company";
import { stripeCustomerMeta } from "../../stripe-customer/entities/stripe-customer.meta";
import { stripePriceMeta } from "../../stripe-price/entities/stripe-price.meta";
import { stripeProductMeta } from "../../stripe-product/entities/stripe-product.meta";
import { StripeSubscription, StripeSubscriptionStatus } from "../entities/stripe-subscription.entity";
import { stripeSubscriptionMeta } from "../entities/stripe-subscription.meta";
import { StripeSubscriptionModel } from "../entities/stripe-subscription.model";

/**
 * StripeSubscriptionRepository
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
 *   stripeCustomerId: 'cust_123',
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
export class StripeSubscriptionRepository implements OnModuleInit {
  constructor(private readonly neo4j: Neo4jService) {}

  /**
   * Initialize repository constraints
   *
   * Creates unique constraints and indexes on module initialization.
   */
  async onModuleInit() {
    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT ${stripeSubscriptionMeta.nodeName}_id IF NOT EXISTS FOR (${stripeSubscriptionMeta.nodeName}:${stripeSubscriptionMeta.labelName}) REQUIRE ${stripeSubscriptionMeta.nodeName}.id IS UNIQUE`,
    });

    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT ${stripeSubscriptionMeta.nodeName}_stripeSubscriptionId IF NOT EXISTS FOR (${stripeSubscriptionMeta.nodeName}:${stripeSubscriptionMeta.labelName}) REQUIRE ${stripeSubscriptionMeta.nodeName}.stripeSubscriptionId IS UNIQUE`,
    });
  }

  /**
   * Find subscriptions by stripe customer ID
   *
   * @param params - Query parameters
   * @param params.stripeCustomerId - Stripe customer identifier (internal ID)
   * @param params.status - Optional filter by subscription status
   * @returns Array of subscriptions ordered by creation date descending
   */
  async findByStripeCustomerId(params: {
    stripeCustomerId: string;
    status?: StripeSubscriptionStatus;
  }): Promise<StripeSubscription[]> {
    const query = this.neo4j.initQuery({ serialiser: StripeSubscriptionModel });

    const whereParams: string[] = [];
    if (params.status) {
      query.queryParams.status = params.status;
      whereParams.push(`${stripeSubscriptionMeta.nodeName}.status = $status`);
    }

    const where = whereParams.length > 0 ? `AND ${whereParams.join(" AND ")}` : "";

    query.queryParams.stripeCustomerId = params.stripeCustomerId;

    query.query = `
      MATCH (${stripeSubscriptionMeta.nodeName}:${stripeSubscriptionMeta.labelName})-[:BELONGS_TO]->(${stripeCustomerMeta.nodeName}:${stripeCustomerMeta.labelName} {id: $stripeCustomerId})
      MATCH (${stripeSubscriptionMeta.nodeName})-[:USES_PRICE]->(${stripeSubscriptionMeta.nodeName}_${stripePriceMeta.nodeName}:${stripePriceMeta.labelName})-[:BELONGS_TO]->(${stripeSubscriptionMeta.nodeName}_${stripePriceMeta.nodeName}_${stripeProductMeta.nodeName}:${stripeProductMeta.labelName})
      WHERE 1=1 ${where}
      RETURN ${stripeSubscriptionMeta.nodeName}, ${stripeSubscriptionMeta.nodeName}_${stripePriceMeta.nodeName}, ${stripeSubscriptionMeta.nodeName}_${stripePriceMeta.nodeName}_${stripeProductMeta.nodeName}
      ORDER BY ${stripeSubscriptionMeta.nodeName}.createdAt DESC
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
  async findById(params: { id: string }): Promise<StripeSubscription | null> {
    const query = this.neo4j.initQuery({ serialiser: StripeSubscriptionModel });

    query.queryParams = {
      id: params.id,
    };

    query.query = `
      MATCH (${stripeSubscriptionMeta.nodeName}:${stripeSubscriptionMeta.labelName} {id: $id})-[:BELONGS_TO]->(${stripeSubscriptionMeta.nodeName}_${stripeCustomerMeta.nodeName}:${stripeCustomerMeta.labelName})
      MATCH (${stripeSubscriptionMeta.nodeName})-[:USES_PRICE]->(${stripeSubscriptionMeta.nodeName}_${stripePriceMeta.nodeName}:${stripePriceMeta.labelName})-[:BELONGS_TO]->(${stripeSubscriptionMeta.nodeName}_${stripePriceMeta.nodeName}_${stripeProductMeta.nodeName}:${stripeProductMeta.labelName})
      RETURN ${stripeSubscriptionMeta.nodeName}, ${stripeSubscriptionMeta.nodeName}_${stripeCustomerMeta.nodeName}, ${stripeSubscriptionMeta.nodeName}_${stripePriceMeta.nodeName}, ${stripeSubscriptionMeta.nodeName}_${stripePriceMeta.nodeName}_${stripeProductMeta.nodeName}
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
  async findByStripeSubscriptionId(params: { stripeSubscriptionId: string }): Promise<StripeSubscription | null> {
    const query = this.neo4j.initQuery({ serialiser: StripeSubscriptionModel });

    query.queryParams = {
      stripeSubscriptionId: params.stripeSubscriptionId,
    };

    query.query = `
      MATCH (${stripeSubscriptionMeta.nodeName}:${stripeSubscriptionMeta.labelName} {stripeSubscriptionId: $stripeSubscriptionId})-[:BELONGS_TO]->(${stripeCustomerMeta.nodeName}:${stripeCustomerMeta.labelName})
      MATCH (${stripeSubscriptionMeta.nodeName})-[:USES_PRICE]->(${stripeSubscriptionMeta.nodeName}_${stripePriceMeta.nodeName}:${stripePriceMeta.labelName})-[:BELONGS_TO]->(${stripeSubscriptionMeta.nodeName}_${stripePriceMeta.nodeName}_${stripeProductMeta.nodeName}:${stripeProductMeta.labelName})
      RETURN ${stripeSubscriptionMeta.nodeName}, ${stripeSubscriptionMeta.nodeName}_${stripePriceMeta.nodeName}, ${stripeSubscriptionMeta.nodeName}_${stripePriceMeta.nodeName}_${stripeProductMeta.nodeName}
    `;

    return this.neo4j.readOne(query);
  }

  /**
   * Create a new subscription
   *
   * Creates a Subscription node with BELONGS_TO relationship to StripeCustomer
   * and USES_PRICE relationship to StripePrice.
   *
   * @param params - Creation parameters
   * @param params.stripeCustomerId - Stripe customer ID to link to
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
    stripeCustomerId: string;
    priceId: string;
    stripeSubscriptionId: string;
    stripeSubscriptionItemId?: string;
    status: StripeSubscriptionStatus;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    cancelAtPeriodEnd: boolean;
    trialStart?: Date;
    trialEnd?: Date;
    quantity: number;
  }): Promise<StripeSubscription> {
    const query = this.neo4j.initQuery({ serialiser: StripeSubscriptionModel });

    const id = randomUUID();

    query.queryParams = {
      ...query.queryParams,
      id: id,
      stripeCustomerId: params.stripeCustomerId,
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

    query.query += `
      MATCH (${stripeCustomerMeta.nodeName}:${stripeCustomerMeta.labelName} {id: $stripeCustomerId})
      MATCH (${stripeSubscriptionMeta.nodeName}_${stripePriceMeta.nodeName}:${stripePriceMeta.labelName} {id: $priceId})-[:BELONGS_TO]->(${stripeSubscriptionMeta.nodeName}_${stripePriceMeta.nodeName}_${stripeProductMeta.nodeName}:${stripeProductMeta.labelName})
      CREATE (${stripeSubscriptionMeta.nodeName}:${stripeSubscriptionMeta.labelName} {
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
      CREATE (${stripeSubscriptionMeta.nodeName})-[:BELONGS_TO]->(${stripeCustomerMeta.nodeName})
      CREATE (${stripeSubscriptionMeta.nodeName})-[:USES_PRICE]->(${stripeSubscriptionMeta.nodeName}_${stripePriceMeta.nodeName})
      CREATE (${stripeSubscriptionMeta.nodeName})-[:BELONGS_TO]->(${companyMeta.nodeName})
      CREATE (${stripeSubscriptionMeta.nodeName})-[:CREATED_BY]->(currentUser)
      RETURN ${stripeSubscriptionMeta.nodeName}, ${stripeSubscriptionMeta.nodeName}_${stripePriceMeta.nodeName}, ${stripeSubscriptionMeta.nodeName}_${stripePriceMeta.nodeName}_${stripeProductMeta.nodeName}
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
    status?: StripeSubscriptionStatus;
    currentPeriodStart?: Date;
    currentPeriodEnd?: Date;
    cancelAtPeriodEnd?: boolean;
    canceledAt?: Date | null;
    trialStart?: Date;
    trialEnd?: Date;
    pausedAt?: Date | null;
    quantity?: number;
  }): Promise<StripeSubscription> {
    const query = this.neo4j.initQuery({ serialiser: StripeSubscriptionModel });

    const setParams: string[] = [];
    setParams.push(`${stripeSubscriptionMeta.nodeName}.updatedAt = datetime()`);

    if (params.status !== undefined) {
      setParams.push(`${stripeSubscriptionMeta.nodeName}.status = $status`);
    }
    if (params.currentPeriodStart !== undefined) {
      setParams.push(`${stripeSubscriptionMeta.nodeName}.currentPeriodStart = datetime($currentPeriodStart)`);
    }
    if (params.currentPeriodEnd !== undefined) {
      setParams.push(`${stripeSubscriptionMeta.nodeName}.currentPeriodEnd = datetime($currentPeriodEnd)`);
    }
    if (params.cancelAtPeriodEnd !== undefined) {
      setParams.push(`${stripeSubscriptionMeta.nodeName}.cancelAtPeriodEnd = $cancelAtPeriodEnd`);
    }
    if (params.canceledAt !== undefined) {
      setParams.push(
        params.canceledAt === null
          ? `${stripeSubscriptionMeta.nodeName}.canceledAt = null`
          : `${stripeSubscriptionMeta.nodeName}.canceledAt = datetime($canceledAt)`,
      );
    }
    if (params.trialStart !== undefined) {
      setParams.push(`${stripeSubscriptionMeta.nodeName}.trialStart = datetime($trialStart)`);
    }
    if (params.trialEnd !== undefined) {
      setParams.push(`${stripeSubscriptionMeta.nodeName}.trialEnd = datetime($trialEnd)`);
    }
    if (params.pausedAt !== undefined) {
      setParams.push(
        params.pausedAt === null
          ? `${stripeSubscriptionMeta.nodeName}.pausedAt = null`
          : `${stripeSubscriptionMeta.nodeName}.pausedAt = datetime($pausedAt)`,
      );
    }
    if (params.quantity !== undefined) {
      setParams.push(`${stripeSubscriptionMeta.nodeName}.quantity = $quantity`);
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
      MATCH (${stripeSubscriptionMeta.nodeName}:${stripeSubscriptionMeta.labelName} {id: $id})-[:BELONGS_TO]->(${stripeCustomerMeta.nodeName}:${stripeCustomerMeta.labelName})
      MATCH (${stripeSubscriptionMeta.nodeName})-[:USES_PRICE]->(${stripeSubscriptionMeta.nodeName}_${stripePriceMeta.nodeName}:${stripePriceMeta.labelName})-[:BELONGS_TO]->(${stripeSubscriptionMeta.nodeName}_${stripePriceMeta.nodeName}_${stripeProductMeta.nodeName}:${stripeProductMeta.labelName})
      SET ${setParams.join(", ")}
      RETURN ${stripeSubscriptionMeta.nodeName}, ${stripeSubscriptionMeta.nodeName}_${stripePriceMeta.nodeName}, ${stripeSubscriptionMeta.nodeName}_${stripePriceMeta.nodeName}_${stripeProductMeta.nodeName}
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
    status?: StripeSubscriptionStatus;
    currentPeriodStart?: Date;
    currentPeriodEnd?: Date;
    cancelAtPeriodEnd?: boolean;
    canceledAt?: Date | null;
    trialStart?: Date;
    trialEnd?: Date;
    pausedAt?: Date | null;
    quantity?: number;
  }): Promise<StripeSubscription | null> {
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
  async updatePrice(params: { id: string; newPriceId: string }): Promise<StripeSubscription> {
    const query = this.neo4j.initQuery({ serialiser: StripeSubscriptionModel });

    query.queryParams = {
      id: params.id,
      newPriceId: params.newPriceId,
    };

    query.query = `
      MATCH (${stripeSubscriptionMeta.nodeName}:${stripeSubscriptionMeta.labelName} {id: $id})-[:BELONGS_TO]->(${stripeCustomerMeta.nodeName}:${stripeCustomerMeta.labelName})
      MATCH (${stripeSubscriptionMeta.nodeName})-[oldRel:USES_PRICE]->(:${stripePriceMeta.labelName})
      DELETE oldRel
      WITH ${stripeSubscriptionMeta.nodeName}, ${stripeCustomerMeta.nodeName}
      MATCH (${stripeSubscriptionMeta.nodeName}_${stripePriceMeta.nodeName}:${stripePriceMeta.labelName} {id: $newPriceId})-[:BELONGS_TO]->(${stripeSubscriptionMeta.nodeName}_${stripePriceMeta.nodeName}_${stripeProductMeta.nodeName}:${stripeProductMeta.labelName})
      CREATE (${stripeSubscriptionMeta.nodeName})-[:USES_PRICE]->(${stripeSubscriptionMeta.nodeName}_${stripePriceMeta.nodeName})
      SET ${stripeSubscriptionMeta.nodeName}.updatedAt = datetime()
      RETURN ${stripeSubscriptionMeta.nodeName}, ${stripeSubscriptionMeta.nodeName}_${stripePriceMeta.nodeName}, ${stripeSubscriptionMeta.nodeName}_${stripePriceMeta.nodeName}_${stripeProductMeta.nodeName}
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
      MATCH (${stripeSubscriptionMeta.nodeName}:${stripeSubscriptionMeta.labelName} {id: $id})
      DETACH DELETE ${stripeSubscriptionMeta.nodeName}
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
      canceledStatus: "canceled" as StripeSubscriptionStatus,
      canceledAt: new Date().toISOString(),
    };

    query.query = `
      MATCH (${stripeSubscriptionMeta.nodeName}:${stripeSubscriptionMeta.labelName})-[:BELONGS_TO]->(${stripeCustomerMeta.nodeName}:${stripeCustomerMeta.labelName} {stripeCustomerId: $stripeCustomerId})
      WHERE ${stripeSubscriptionMeta.nodeName}.status IN ['active', 'trialing', 'past_due']
      SET ${stripeSubscriptionMeta.nodeName}.status = $canceledStatus,
          ${stripeSubscriptionMeta.nodeName}.canceledAt = datetime($canceledAt),
          ${stripeSubscriptionMeta.nodeName}.cancelAtPeriodEnd = false,
          ${stripeSubscriptionMeta.nodeName}.updatedAt = datetime()
      RETURN count(${stripeSubscriptionMeta.nodeName}) as count
    `;

    const result = await this.neo4j.writeOne(query);
    return result?.count ?? 0;
  }
}
