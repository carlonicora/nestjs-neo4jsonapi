import { Injectable, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "crypto";
import { Neo4jService } from "../../../core/neo4j";
import { stripeProductMeta } from "../../stripe-product";
import {
  StripePrice,
  StripePriceRecurringInterval,
  StripePriceRecurringUsageType,
  StripePriceType,
} from "../entities/stripe-price.entity";
import { stripePriceMeta } from "../entities/stripe-price.meta";
import { StripePriceModel } from "../entities/stripe-price.model";

/**
 * StripePriceRepository
 *
 * Neo4j repository for managing StripePrice nodes and their relationships to StripeProduct nodes.
 * Handles price catalog storage with support for recurring, one-time, and usage-based pricing.
 *
 * Key Features:
 * - Automatic constraint creation for ID and Stripe price ID uniqueness
 * - Query prices by ID, Stripe ID, product, or active status
 * - Create and update operations with product relationships
 * - Support for both recurring and one-time prices
 * - Support for usage-based (metered) billing
 * - Sync operations for webhook data
 * - Maintains BELONGS_TO relationship with StripeProduct
 *
 * @example
 * ```typescript
 * const price = await stripePriceRepository.create({
 *   productId: 'prod_123',
 *   stripePriceId: 'price_stripe456',
 *   active: true,
 *   currency: 'usd',
 *   unitAmount: 2999,
 *   priceType: 'recurring',
 *   recurringInterval: 'month',
 *   recurringIntervalCount: 1,
 *   recurringUsageType: 'licensed'
 * });
 * ```
 */
@Injectable()
export class StripePriceRepository implements OnModuleInit {
  constructor(private readonly neo4j: Neo4jService) {}

  /**
   * Initialize repository constraints
   *
   * Creates unique constraints on module initialization.
   */
  async onModuleInit() {
    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT ${stripePriceMeta.nodeName}_id IF NOT EXISTS FOR (${stripePriceMeta.nodeName}:${stripePriceMeta.labelName}) REQUIRE ${stripePriceMeta.nodeName}.id IS UNIQUE`,
    });

    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT ${stripePriceMeta.nodeName}_stripePriceId IF NOT EXISTS FOR (${stripePriceMeta.nodeName}:${stripePriceMeta.labelName}) REQUIRE ${stripePriceMeta.nodeName}.stripePriceId IS UNIQUE`,
    });
  }

  /**
   * Find all prices
   *
   * @param params - Optional query parameters
   * @param params.productId - Optional filter by product ID
   * @param params.active - Optional filter by active status
   * @returns Array of prices ordered by creation date descending
   */
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

  /**
   * Find price by internal ID
   *
   * @param params - Query parameters
   * @param params.id - Internal price ID
   * @returns StripePrice if found, null otherwise
   */
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

  /**
   * Find price by Stripe price ID
   *
   * @param params - Query parameters
   * @param params.stripePriceId - Stripe price ID
   * @returns StripePrice if found, null otherwise
   */
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

  /**
   * Create a new price
   *
   * Creates a StripePrice node and establishes BELONGS_TO relationship with StripeProduct.
   *
   * @param params - Creation parameters
   * @param params.productId - Internal product ID to link to
   * @param params.stripePriceId - Stripe price ID
   * @param params.active - Whether price is active
   * @param params.currency - Currency code (e.g., 'usd')
   * @param params.unitAmount - Optional price amount in smallest currency unit
   * @param params.priceType - Price type ('recurring' or 'one_time')
   * @param params.recurringInterval - Optional billing interval (day, week, month, year)
   * @param params.recurringIntervalCount - Optional interval count
   * @param params.recurringUsageType - Optional usage type ('licensed' or 'metered')
   * @param params.nickname - Optional display name
   * @param params.lookupKey - Optional lookup key
   * @param params.metadata - Optional metadata JSON string
   * @param params.description - Optional description
   * @param params.features - Optional features JSON string
   * @returns Created StripePrice
   */
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
    description?: string;
    features?: string;
    token?: number;
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
      description: params.description ?? null,
      features: params.features ?? null,
      token: params.token ?? null,
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
        description: $description,
        features: $features,
        token: $token,
        createdAt: datetime(),
        updatedAt: datetime()
      })
      CREATE (${stripePriceMeta.nodeName})-[:BELONGS_TO]->(${stripeProductMeta.nodeName})
      RETURN ${stripePriceMeta.nodeName}, ${stripeProductMeta.nodeName}
    `;

    return this.neo4j.writeOne(query);
  }

  /**
   * Update price by internal ID
   *
   * Note: Most price fields are immutable in Stripe. Only active, nickname, and metadata can be updated.
   *
   * @param params - Update parameters
   * @param params.id - Internal price ID
   * @param params.active - Optional new active status
   * @param params.nickname - Optional new nickname
   * @param params.metadata - Optional new metadata JSON string
   * @param params.description - Optional new description
   * @param params.features - Optional new features JSON string
   * @returns Updated StripePrice
   */
  async update(params: {
    id: string;
    active?: boolean;
    nickname?: string;
    metadata?: string;
    description?: string;
    features?: string;
    token?: number;
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
    if (params.description !== undefined) {
      setParams.push(`${stripePriceMeta.nodeName}.description = $description`);
    }
    if (params.features !== undefined) {
      setParams.push(`${stripePriceMeta.nodeName}.features = $features`);
    }
    if (params.token !== undefined) {
      setParams.push(`${stripePriceMeta.nodeName}.token = $token`);
    }

    query.queryParams = {
      id: params.id,
      active: params.active,
      nickname: params.nickname,
      metadata: params.metadata,
      description: params.description,
      features: params.features,
      token: params.token,
    };

    query.query = `
      MATCH (${stripePriceMeta.nodeName}:${stripePriceMeta.labelName} {id: $id})-[:BELONGS_TO]->(${stripeProductMeta.nodeName}:${stripeProductMeta.labelName})
      SET ${setParams.join(", ")}
      RETURN ${stripePriceMeta.nodeName}, ${stripeProductMeta.nodeName}
    `;

    return this.neo4j.writeOne(query);
  }

  /**
   * Update price by Stripe price ID
   *
   * Used primarily by webhook handlers to sync price data from Stripe.
   *
   * @param params - Update parameters
   * @param params.stripePriceId - Stripe price ID
   * @param params.active - Optional new active status
   * @param params.nickname - Optional new nickname
   * @param params.metadata - Optional new metadata JSON string
   * @param params.description - Optional new description
   * @param params.features - Optional new features JSON string
   * @returns Updated StripePrice
   */
  async updateByStripePriceId(params: {
    stripePriceId: string;
    active?: boolean;
    nickname?: string;
    metadata?: string;
    description?: string;
    features?: string;
    token?: number;
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
    if (params.description !== undefined) {
      setParams.push(`${stripePriceMeta.nodeName}.description = $description`);
    }
    if (params.features !== undefined) {
      setParams.push(`${stripePriceMeta.nodeName}.features = $features`);
    }
    if (params.token !== undefined) {
      setParams.push(`${stripePriceMeta.nodeName}.token = $token`);
    }

    query.queryParams = {
      stripePriceId: params.stripePriceId,
      active: params.active,
      nickname: params.nickname,
      metadata: params.metadata,
      description: params.description,
      features: params.features,
      token: params.token,
    };

    query.query = `
      MATCH (${stripePriceMeta.nodeName}:${stripePriceMeta.labelName} {stripePriceId: $stripePriceId})-[:BELONGS_TO]->(${stripeProductMeta.nodeName}:${stripeProductMeta.labelName})
      SET ${setParams.join(", ")}
      RETURN ${stripePriceMeta.nodeName}, ${stripeProductMeta.nodeName}
    `;

    return this.neo4j.writeOne(query);
  }
}
