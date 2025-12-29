import { Injectable, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "crypto";
import { Neo4jService } from "@carlonicora/nestjs-neo4jsonapi";
import { billingCustomerMeta } from "../entities/billing-customer.meta";
import { stripePriceMeta } from "../entities/stripe-price.meta";
import { stripeProductMeta } from "../entities/stripe-product.meta";
import { Subscription, SubscriptionStatus } from "../entities/subscription.entity";
import { subscriptionMeta } from "../entities/subscription.meta";
import { SubscriptionModel } from "../entities/subscription.model";

@Injectable()
export class SubscriptionRepository implements OnModuleInit {
  constructor(private readonly neo4j: Neo4jService) {}

  async onModuleInit() {
    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT ${subscriptionMeta.nodeName}_id IF NOT EXISTS FOR (${subscriptionMeta.nodeName}:${subscriptionMeta.labelName}) REQUIRE ${subscriptionMeta.nodeName}.id IS UNIQUE`,
    });

    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT ${subscriptionMeta.nodeName}_stripeSubscriptionId IF NOT EXISTS FOR (${subscriptionMeta.nodeName}:${subscriptionMeta.labelName}) REQUIRE ${subscriptionMeta.nodeName}.stripeSubscriptionId IS UNIQUE`,
    });
  }

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
}
