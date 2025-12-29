import { Injectable, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "crypto";
import { Neo4jService } from "@carlonicora/nestjs-neo4jsonapi";
import { StripeProduct } from "../entities/stripe-product.entity";
import { stripeProductMeta } from "../entities/stripe-product.meta";
import { StripeProductModel } from "../entities/stripe-product.model";

/**
 * StripeProductRepository
 *
 * Neo4j repository for managing StripeProduct nodes representing billing products.
 * Handles product catalog storage and queries with active status filtering.
 *
 * Key Features:
 * - Automatic constraint creation for ID and Stripe product ID uniqueness
 * - Query products by ID, Stripe ID, or active status
 * - Create and update operations for product data
 * - Support for product archival (setting active=false)
 * - Sync operations for webhook data
 * - Metadata storage for custom product attributes
 *
 * @example
 * ```typescript
 * const product = await stripeProductRepository.create({
 *   stripeProductId: 'prod_stripe123',
 *   name: 'Premium Plan',
 *   description: 'Full access to all features',
 *   active: true,
 *   metadata: JSON.stringify({ tier: 'premium' })
 * });
 * ```
 */
@Injectable()
export class StripeProductRepository implements OnModuleInit {
  constructor(private readonly neo4j: Neo4jService) {}

  /**
   * Initialize repository constraints
   *
   * Creates unique constraints on module initialization.
   */
  async onModuleInit() {
    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT ${stripeProductMeta.nodeName}_id IF NOT EXISTS FOR (${stripeProductMeta.nodeName}:${stripeProductMeta.labelName}) REQUIRE ${stripeProductMeta.nodeName}.id IS UNIQUE`,
    });

    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT ${stripeProductMeta.nodeName}_stripeProductId IF NOT EXISTS FOR (${stripeProductMeta.nodeName}:${stripeProductMeta.labelName}) REQUIRE ${stripeProductMeta.nodeName}.stripeProductId IS UNIQUE`,
    });
  }

  /**
   * Find all products
   *
   * @param params - Optional query parameters
   * @param params.active - Optional filter by active status
   * @returns Array of products ordered by name
   */
  async findAll(params?: { active?: boolean }): Promise<StripeProduct[]> {
    const query = this.neo4j.initQuery({ serialiser: StripeProductModel });

    const whereParams: string[] = [];
    if (params?.active !== undefined) {
      query.queryParams.active = params.active;
      whereParams.push(`${stripeProductMeta.nodeName}.active = $active`);
    }

    const where = whereParams.length > 0 ? `WHERE ${whereParams.join(" AND ")}` : "";

    query.query = `
      MATCH (${stripeProductMeta.nodeName}:${stripeProductMeta.labelName})
      ${where}
      RETURN ${stripeProductMeta.nodeName}
      ORDER BY ${stripeProductMeta.nodeName}.name
    `;

    return this.neo4j.readMany(query);
  }

  /**
   * Find product by internal ID
   *
   * @param params - Query parameters
   * @param params.id - Internal product ID
   * @returns StripeProduct if found, null otherwise
   */
  async findById(params: { id: string }): Promise<StripeProduct | null> {
    const query = this.neo4j.initQuery({ serialiser: StripeProductModel });

    query.queryParams = {
      id: params.id,
    };

    query.query = `
      MATCH (${stripeProductMeta.nodeName}:${stripeProductMeta.labelName} {id: $id})
      RETURN ${stripeProductMeta.nodeName}
    `;

    return this.neo4j.readOne(query);
  }

  /**
   * Find product by Stripe product ID
   *
   * @param params - Query parameters
   * @param params.stripeProductId - Stripe product ID
   * @returns StripeProduct if found, null otherwise
   */
  async findByStripeProductId(params: { stripeProductId: string }): Promise<StripeProduct | null> {
    const query = this.neo4j.initQuery({ serialiser: StripeProductModel });

    query.queryParams = {
      stripeProductId: params.stripeProductId,
    };

    query.query = `
      MATCH (${stripeProductMeta.nodeName}:${stripeProductMeta.labelName} {stripeProductId: $stripeProductId})
      RETURN ${stripeProductMeta.nodeName}
    `;

    return this.neo4j.readOne(query);
  }

  /**
   * Create a new product
   *
   * @param params - Creation parameters
   * @param params.stripeProductId - Stripe product ID
   * @param params.name - Product name
   * @param params.description - Optional product description
   * @param params.active - Whether product is active
   * @param params.metadata - Optional metadata JSON string
   * @returns Created StripeProduct
   */
  async create(params: {
    stripeProductId: string;
    name: string;
    description?: string;
    active: boolean;
    metadata?: string;
  }): Promise<StripeProduct> {
    const query = this.neo4j.initQuery({ serialiser: StripeProductModel });

    const id = randomUUID();

    query.queryParams = {
      id,
      stripeProductId: params.stripeProductId,
      name: params.name,
      description: params.description ?? null,
      active: params.active,
      metadata: params.metadata ?? null,
    };

    query.query = `
      CREATE (${stripeProductMeta.nodeName}:${stripeProductMeta.labelName} {
        id: $id,
        stripeProductId: $stripeProductId,
        name: $name,
        description: $description,
        active: $active,
        metadata: $metadata,
        createdAt: datetime(),
        updatedAt: datetime()
      })
      RETURN ${stripeProductMeta.nodeName}
    `;

    return this.neo4j.writeOne(query);
  }

  /**
   * Update product by internal ID
   *
   * @param params - Update parameters
   * @param params.id - Internal product ID
   * @param params.name - Optional new name
   * @param params.description - Optional new description
   * @param params.active - Optional new active status
   * @param params.metadata - Optional new metadata JSON string
   * @returns Updated StripeProduct
   */
  async update(params: {
    id: string;
    name?: string;
    description?: string;
    active?: boolean;
    metadata?: string;
  }): Promise<StripeProduct> {
    const query = this.neo4j.initQuery({ serialiser: StripeProductModel });

    const setParams: string[] = [];
    setParams.push(`${stripeProductMeta.nodeName}.updatedAt = datetime()`);

    if (params.name !== undefined) {
      setParams.push(`${stripeProductMeta.nodeName}.name = $name`);
    }
    if (params.description !== undefined) {
      setParams.push(`${stripeProductMeta.nodeName}.description = $description`);
    }
    if (params.active !== undefined) {
      setParams.push(`${stripeProductMeta.nodeName}.active = $active`);
    }
    if (params.metadata !== undefined) {
      setParams.push(`${stripeProductMeta.nodeName}.metadata = $metadata`);
    }

    query.queryParams = {
      id: params.id,
      name: params.name,
      description: params.description,
      active: params.active,
      metadata: params.metadata,
    };

    query.query = `
      MATCH (${stripeProductMeta.nodeName}:${stripeProductMeta.labelName} {id: $id})
      SET ${setParams.join(", ")}
      RETURN ${stripeProductMeta.nodeName}
    `;

    return this.neo4j.writeOne(query);
  }

  /**
   * Update product by Stripe product ID
   *
   * Used primarily by webhook handlers to sync product data from Stripe.
   *
   * @param params - Update parameters
   * @param params.stripeProductId - Stripe product ID
   * @param params.name - Optional new name
   * @param params.description - Optional new description
   * @param params.active - Optional new active status
   * @param params.metadata - Optional new metadata JSON string
   * @returns Updated StripeProduct
   */
  async updateByStripeProductId(params: {
    stripeProductId: string;
    name?: string;
    description?: string;
    active?: boolean;
    metadata?: string;
  }): Promise<StripeProduct> {
    const query = this.neo4j.initQuery({ serialiser: StripeProductModel });

    const setParams: string[] = [];
    setParams.push(`${stripeProductMeta.nodeName}.updatedAt = datetime()`);

    if (params.name !== undefined) {
      setParams.push(`${stripeProductMeta.nodeName}.name = $name`);
    }
    if (params.description !== undefined) {
      setParams.push(`${stripeProductMeta.nodeName}.description = $description`);
    }
    if (params.active !== undefined) {
      setParams.push(`${stripeProductMeta.nodeName}.active = $active`);
    }
    if (params.metadata !== undefined) {
      setParams.push(`${stripeProductMeta.nodeName}.metadata = $metadata`);
    }

    query.queryParams = {
      stripeProductId: params.stripeProductId,
      name: params.name,
      description: params.description,
      active: params.active,
      metadata: params.metadata,
    };

    query.query = `
      MATCH (${stripeProductMeta.nodeName}:${stripeProductMeta.labelName} {stripeProductId: $stripeProductId})
      SET ${setParams.join(", ")}
      RETURN ${stripeProductMeta.nodeName}
    `;

    return this.neo4j.writeOne(query);
  }

  /**
   * Delete product
   *
   * Performs a DETACH DELETE to remove the product and all relationships.
   *
   * @param params - Deletion parameters
   * @param params.id - Internal product ID
   * @returns Promise that resolves when deletion is complete
   */
  async delete(params: { id: string }): Promise<void> {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      id: params.id,
    };

    query.query = `
      MATCH (${stripeProductMeta.nodeName}:${stripeProductMeta.labelName} {id: $id})
      DETACH DELETE ${stripeProductMeta.nodeName}
    `;

    await this.neo4j.writeOne(query);
  }
}
