import { Injectable, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "crypto";
import { Neo4jService } from "@carlonicora/nestjs-neo4jsonapi";
import {
  StripePrice,
  StripePriceRecurringInterval,
  StripePriceRecurringUsageType,
  StripePriceType,
} from "../entities/stripe-price.entity";
import { stripePriceMeta } from "../entities/stripe-price.meta";
import { StripePriceModel } from "../entities/stripe-price.model";
import { stripeProductMeta } from "../entities/stripe-product.meta";

@Injectable()
export class StripePriceRepository implements OnModuleInit {
  constructor(private readonly neo4j: Neo4jService) {}

  async onModuleInit() {
    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT ${stripePriceMeta.nodeName}_id IF NOT EXISTS FOR (${stripePriceMeta.nodeName}:${stripePriceMeta.labelName}) REQUIRE ${stripePriceMeta.nodeName}.id IS UNIQUE`,
    });

    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT ${stripePriceMeta.nodeName}_stripePriceId IF NOT EXISTS FOR (${stripePriceMeta.nodeName}:${stripePriceMeta.labelName}) REQUIRE ${stripePriceMeta.nodeName}.stripePriceId IS UNIQUE`,
    });
  }

  async findAll(params?: { productId?: string; active?: boolean }): Promise<StripePrice[]> {
    const query = this.neo4j.initQuery({ serialiser: StripePriceModel });

    const whereParams: string[] = [];

    if (params?.active !== undefined) {
      query.queryParams.active = params.active;
      whereParams.push(`${stripePriceMeta.nodeName}.active = $active`);
    }

    const where = whereParams.length > 0 ? `WHERE ${whereParams.join(" AND ")}` : "";

    if (params?.productId) {
      query.queryParams.productId = params.productId;
      query.query = `
        MATCH (${stripePriceMeta.nodeName}:${stripePriceMeta.labelName})-[:BELONGS_TO]->(${stripeProductMeta.nodeName}:${stripeProductMeta.labelName} {id: $productId})
        ${where}
        RETURN ${stripePriceMeta.nodeName}, ${stripeProductMeta.nodeName}
        ORDER BY ${stripePriceMeta.nodeName}.createdAt DESC
      `;
    } else {
      query.query = `
        MATCH (${stripePriceMeta.nodeName}:${stripePriceMeta.labelName})-[:BELONGS_TO]->(${stripeProductMeta.nodeName}:${stripeProductMeta.labelName})
        ${where}
        RETURN ${stripePriceMeta.nodeName}, ${stripeProductMeta.nodeName}
        ORDER BY ${stripePriceMeta.nodeName}.createdAt DESC
      `;
    }

    return this.neo4j.readMany(query);
  }

  async findById(params: { id: string }): Promise<StripePrice | null> {
    const query = this.neo4j.initQuery({ serialiser: StripePriceModel });

    query.queryParams = {
      id: params.id,
    };

    query.query = `
      MATCH (${stripePriceMeta.nodeName}:${stripePriceMeta.labelName} {id: $id})-[:BELONGS_TO]->(${stripeProductMeta.nodeName}:${stripeProductMeta.labelName})
      RETURN ${stripePriceMeta.nodeName}, ${stripeProductMeta.nodeName}
    `;

    return this.neo4j.readOne(query);
  }

  async findByStripePriceId(params: { stripePriceId: string }): Promise<StripePrice | null> {
    const query = this.neo4j.initQuery({ serialiser: StripePriceModel });

    query.queryParams = {
      stripePriceId: params.stripePriceId,
    };

    query.query = `
      MATCH (${stripePriceMeta.nodeName}:${stripePriceMeta.labelName} {stripePriceId: $stripePriceId})-[:BELONGS_TO]->(${stripeProductMeta.nodeName}:${stripeProductMeta.labelName})
      RETURN ${stripePriceMeta.nodeName}, ${stripeProductMeta.nodeName}
    `;

    return this.neo4j.readOne(query);
  }

  async create(params: {
    productId: string;
    stripePriceId: string;
    active: boolean;
    currency: string;
    unitAmount?: number;
    priceType: StripePriceType;
    recurringInterval?: StripePriceRecurringInterval;
    recurringIntervalCount?: number;
    recurringUsageType?: StripePriceRecurringUsageType;
    nickname?: string;
    lookupKey?: string;
    metadata?: string;
  }): Promise<StripePrice> {
    const query = this.neo4j.initQuery({ serialiser: StripePriceModel });

    const id = randomUUID();

    query.queryParams = {
      id,
      productId: params.productId,
      stripePriceId: params.stripePriceId,
      active: params.active,
      currency: params.currency,
      unitAmount: params.unitAmount ?? null,
      priceType: params.priceType,
      recurringInterval: params.recurringInterval ?? null,
      recurringIntervalCount: params.recurringIntervalCount ?? null,
      recurringUsageType: params.recurringUsageType ?? null,
      nickname: params.nickname ?? null,
      lookupKey: params.lookupKey ?? null,
      metadata: params.metadata ?? null,
    };

    query.query = `
      MATCH (${stripeProductMeta.nodeName}:${stripeProductMeta.labelName} {id: $productId})
      CREATE (${stripePriceMeta.nodeName}:${stripePriceMeta.labelName} {
        id: $id,
        stripePriceId: $stripePriceId,
        active: $active,
        currency: $currency,
        unitAmount: $unitAmount,
        priceType: $priceType,
        recurringInterval: $recurringInterval,
        recurringIntervalCount: $recurringIntervalCount,
        recurringUsageType: $recurringUsageType,
        nickname: $nickname,
        lookupKey: $lookupKey,
        metadata: $metadata,
        createdAt: datetime(),
        updatedAt: datetime()
      })
      CREATE (${stripePriceMeta.nodeName})-[:BELONGS_TO]->(${stripeProductMeta.nodeName})
      RETURN ${stripePriceMeta.nodeName}, ${stripeProductMeta.nodeName}
    `;

    return this.neo4j.writeOne(query);
  }

  async update(params: { id: string; active?: boolean; nickname?: string; metadata?: string }): Promise<StripePrice> {
    const query = this.neo4j.initQuery({ serialiser: StripePriceModel });

    const setParams: string[] = [];
    setParams.push(`${stripePriceMeta.nodeName}.updatedAt = datetime()`);

    if (params.active !== undefined) {
      setParams.push(`${stripePriceMeta.nodeName}.active = $active`);
    }
    if (params.nickname !== undefined) {
      setParams.push(`${stripePriceMeta.nodeName}.nickname = $nickname`);
    }
    if (params.metadata !== undefined) {
      setParams.push(`${stripePriceMeta.nodeName}.metadata = $metadata`);
    }

    query.queryParams = {
      id: params.id,
      active: params.active,
      nickname: params.nickname,
      metadata: params.metadata,
    };

    query.query = `
      MATCH (${stripePriceMeta.nodeName}:${stripePriceMeta.labelName} {id: $id})-[:BELONGS_TO]->(${stripeProductMeta.nodeName}:${stripeProductMeta.labelName})
      SET ${setParams.join(", ")}
      RETURN ${stripePriceMeta.nodeName}, ${stripeProductMeta.nodeName}
    `;

    return this.neo4j.writeOne(query);
  }

  async updateByStripePriceId(params: {
    stripePriceId: string;
    active?: boolean;
    nickname?: string;
    metadata?: string;
  }): Promise<StripePrice> {
    const query = this.neo4j.initQuery({ serialiser: StripePriceModel });

    const setParams: string[] = [];
    setParams.push(`${stripePriceMeta.nodeName}.updatedAt = datetime()`);

    if (params.active !== undefined) {
      setParams.push(`${stripePriceMeta.nodeName}.active = $active`);
    }
    if (params.nickname !== undefined) {
      setParams.push(`${stripePriceMeta.nodeName}.nickname = $nickname`);
    }
    if (params.metadata !== undefined) {
      setParams.push(`${stripePriceMeta.nodeName}.metadata = $metadata`);
    }

    query.queryParams = {
      stripePriceId: params.stripePriceId,
      active: params.active,
      nickname: params.nickname,
      metadata: params.metadata,
    };

    query.query = `
      MATCH (${stripePriceMeta.nodeName}:${stripePriceMeta.labelName} {stripePriceId: $stripePriceId})-[:BELONGS_TO]->(${stripeProductMeta.nodeName}:${stripeProductMeta.labelName})
      SET ${setParams.join(", ")}
      RETURN ${stripePriceMeta.nodeName}, ${stripeProductMeta.nodeName}
    `;

    return this.neo4j.writeOne(query);
  }
}
