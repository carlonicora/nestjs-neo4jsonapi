import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { JsonApiDataInterface } from "@carlonicora/nestjs-neo4jsonapi";
import { JsonApiPaginator } from "@carlonicora/nestjs-neo4jsonapi";
import { JsonApiService } from "@carlonicora/nestjs-neo4jsonapi";
import { StripeProductService } from "@carlonicora/nestjs-neo4jsonapi";
import { StripePriceModel } from "../entities/stripe-price.model";
import { StripeProductModel } from "../entities/stripe-product.model";
import { StripePriceRepository } from "../repositories/stripe-price.repository";
import { StripeProductRepository } from "../repositories/stripe-product.repository";

/**
 * BillingAdminService
 *
 * Administrative service for managing Stripe products and prices in the billing system.
 * Provides CRUD operations for products and prices, with two-way sync between Stripe and local database.
 *
 * Key Features:
 * - Product management (create, update, archive, list)
 * - Price management (create, update, list)
 * - Support for one-time and recurring prices
 * - Support for usage-based billing with meters
 * - Sync products and prices from Stripe webhooks
 * - Filter products and prices by active status
 *
 * This service is typically used by admin/backend operations to set up billing offerings
 * before customers subscribe.
 */
@Injectable()
export class BillingAdminService {
  constructor(
    private readonly stripeProductRepository: StripeProductRepository,
    private readonly stripePriceRepository: StripePriceRepository,
    private readonly stripeProductService: StripeProductService,
    private readonly jsonApiService: JsonApiService,
  ) {}

  /**
   * List all products
   *
   * @param params - Parameters
   * @param params.query - JSON:API query parameters for pagination
   * @param params.active - Optional filter by active status
   * @returns JSON:API formatted list of products
   *
   * @example
   * ```typescript
   * const products = await billingAdminService.listProducts({
   *   query: { page: { number: 1, size: 10 } },
   *   active: true
   * });
   * ```
   */
  async listProducts(params: { query: any; active?: boolean }): Promise<JsonApiDataInterface> {
    const paginator = new JsonApiPaginator(params.query);

    const products = await this.stripeProductRepository.findAll({
      active: params.active,
    });

    return this.jsonApiService.buildList(StripeProductModel, products, paginator);
  }

  /**
   * Get a single product by ID
   *
   * @param params - Parameters
   * @param params.id - Product ID
   * @returns JSON:API formatted product data
   * @throws {HttpException} NOT_FOUND if product not found
   */
  async getProduct(params: { id: string }): Promise<JsonApiDataInterface> {
    const product = await this.stripeProductRepository.findById({ id: params.id });

    if (!product) {
      throw new HttpException("Product not found", HttpStatus.NOT_FOUND);
    }

    return this.jsonApiService.buildSingle(StripeProductModel, product);
  }

  /**
   * Create a new product
   *
   * Creates both a Stripe product and a local database record.
   *
   * @param params - Product parameters
   * @param params.name - Product name
   * @param params.description - Optional product description
   * @param params.metadata - Optional metadata key-value pairs
   * @returns JSON:API formatted product data
   *
   * @example
   * ```typescript
   * const product = await billingAdminService.createProduct({
   *   name: 'Premium Plan',
   *   description: 'Full access to all features',
   *   metadata: { tier: 'premium' }
   * });
   * ```
   */
  async createProduct(params: {
    name: string;
    description?: string;
    metadata?: Record<string, string>;
  }): Promise<JsonApiDataInterface> {
    const stripeProduct = await this.stripeProductService.createProduct({
      name: params.name,
      description: params.description,
      metadata: params.metadata,
    });

    const product = await this.stripeProductRepository.create({
      stripeProductId: stripeProduct.id,
      name: params.name,
      description: params.description,
      active: stripeProduct.active,
      metadata: params.metadata ? JSON.stringify(params.metadata) : undefined,
    });

    return this.jsonApiService.buildSingle(StripeProductModel, product);
  }

  /**
   * Update an existing product
   *
   * @param params - Update parameters
   * @param params.id - Product ID
   * @param params.name - Optional new name
   * @param params.description - Optional new description
   * @param params.metadata - Optional new metadata
   * @returns JSON:API formatted updated product data
   * @throws {HttpException} NOT_FOUND if product not found
   */
  async updateProduct(params: {
    id: string;
    name?: string;
    description?: string;
    metadata?: Record<string, string>;
  }): Promise<JsonApiDataInterface> {
    const existingProduct = await this.stripeProductRepository.findById({ id: params.id });

    if (!existingProduct) {
      throw new HttpException("Product not found", HttpStatus.NOT_FOUND);
    }

    await this.stripeProductService.updateProduct({
      productId: existingProduct.stripeProductId,
      name: params.name,
      description: params.description,
      metadata: params.metadata,
    });

    const product = await this.stripeProductRepository.update({
      id: params.id,
      name: params.name,
      description: params.description,
      metadata: params.metadata ? JSON.stringify(params.metadata) : undefined,
    });

    return this.jsonApiService.buildSingle(StripeProductModel, product);
  }

  /**
   * Archive a product
   *
   * Sets the product as inactive in both Stripe and the local database.
   * Archived products cannot be used for new subscriptions.
   *
   * @param params - Parameters
   * @param params.id - Product ID
   * @returns Promise that resolves when archival is complete
   * @throws {HttpException} NOT_FOUND if product not found
   */
  async archiveProduct(params: { id: string }): Promise<void> {
    const existingProduct = await this.stripeProductRepository.findById({ id: params.id });

    if (!existingProduct) {
      throw new HttpException("Product not found", HttpStatus.NOT_FOUND);
    }

    await this.stripeProductService.archiveProduct(existingProduct.stripeProductId);

    await this.stripeProductRepository.update({
      id: params.id,
      active: false,
    });
  }

  /**
   * List all prices
   *
   * @param params - Parameters
   * @param params.query - JSON:API query parameters for pagination
   * @param params.productId - Optional filter by product ID
   * @param params.active - Optional filter by active status
   * @returns JSON:API formatted list of prices
   *
   * @example
   * ```typescript
   * const prices = await billingAdminService.listPrices({
   *   query: { page: { number: 1, size: 10 } },
   *   productId: 'prod_123',
   *   active: true
   * });
   * ```
   */
  async listPrices(params: { query: any; productId?: string; active?: boolean }): Promise<JsonApiDataInterface> {
    const paginator = new JsonApiPaginator(params.query);

    const prices = await this.stripePriceRepository.findAll({
      productId: params.productId,
      active: params.active,
    });

    return this.jsonApiService.buildList(StripePriceModel, prices, paginator);
  }

  /**
   * Get a single price by ID
   *
   * @param params - Parameters
   * @param params.id - Price ID
   * @returns JSON:API formatted price data
   * @throws {HttpException} NOT_FOUND if price not found
   */
  async getPrice(params: { id: string }): Promise<JsonApiDataInterface> {
    const price = await this.stripePriceRepository.findById({ id: params.id });

    if (!price) {
      throw new HttpException("Price not found", HttpStatus.NOT_FOUND);
    }

    return this.jsonApiService.buildSingle(StripePriceModel, price);
  }

  /**
   * Create a new price
   *
   * Creates both a Stripe price and a local database record. Supports both one-time
   * and recurring prices, including usage-based billing with meters.
   *
   * @param params - Price parameters
   * @param params.productId - Product ID to attach price to
   * @param params.unitAmount - Price amount in smallest currency unit (e.g., cents)
   * @param params.currency - Currency code (e.g., 'usd', 'eur')
   * @param params.nickname - Optional display name
   * @param params.lookupKey - Optional lookup key for referencing price
   * @param params.recurring - Optional recurring billing configuration
   * @param params.recurring.interval - Billing interval (day, week, month, year)
   * @param params.recurring.intervalCount - Number of intervals between billings
   * @param params.recurring.meter - Optional meter ID for usage-based billing
   * @param params.metadata - Optional metadata key-value pairs
   * @returns JSON:API formatted price data
   * @throws {HttpException} NOT_FOUND if product not found
   *
   * @example
   * ```typescript
   * // Create a monthly subscription price
   * const price = await billingAdminService.createPrice({
   *   productId: 'prod_123',
   *   unitAmount: 2999, // $29.99
   *   currency: 'usd',
   *   nickname: 'Monthly Premium',
   *   recurring: {
   *     interval: 'month',
   *     intervalCount: 1
   *   }
   * });
   * ```
   */
  async createPrice(params: {
    productId: string;
    unitAmount: number;
    currency: string;
    nickname?: string;
    lookupKey?: string;
    recurring?: {
      interval: "day" | "week" | "month" | "year";
      intervalCount?: number;
      meter?: string;
    };
    metadata?: Record<string, string>;
  }): Promise<JsonApiDataInterface> {
    const product = await this.stripeProductRepository.findById({ id: params.productId });

    if (!product) {
      throw new HttpException("Product not found", HttpStatus.NOT_FOUND);
    }

    const stripePrice = await this.stripeProductService.createPrice({
      productId: product.stripeProductId,
      unitAmount: params.unitAmount,
      currency: params.currency,
      nickname: params.nickname,
      lookupKey: params.lookupKey,
      recurring: params.recurring,
      metadata: params.metadata,
    });

    const price = await this.stripePriceRepository.create({
      productId: params.productId,
      stripePriceId: stripePrice.id,
      active: stripePrice.active,
      currency: params.currency,
      unitAmount: params.unitAmount,
      priceType: params.recurring ? "recurring" : "one_time",
      recurringInterval: params.recurring?.interval,
      recurringIntervalCount: params.recurring?.intervalCount,
      recurringUsageType: params.recurring?.meter ? "metered" : "licensed",
      nickname: params.nickname,
      lookupKey: params.lookupKey,
      metadata: params.metadata ? JSON.stringify(params.metadata) : undefined,
    });

    return this.jsonApiService.buildSingle(StripePriceModel, price);
  }

  /**
   * Update an existing price
   *
   * Note: Most price fields are immutable in Stripe. Only nickname and metadata can be updated.
   *
   * @param params - Update parameters
   * @param params.id - Price ID
   * @param params.nickname - Optional new nickname
   * @param params.metadata - Optional new metadata
   * @returns JSON:API formatted updated price data
   * @throws {HttpException} NOT_FOUND if price not found
   */
  async updatePrice(params: {
    id: string;
    nickname?: string;
    metadata?: Record<string, string>;
  }): Promise<JsonApiDataInterface> {
    const existingPrice = await this.stripePriceRepository.findById({ id: params.id });

    if (!existingPrice) {
      throw new HttpException("Price not found", HttpStatus.NOT_FOUND);
    }

    await this.stripeProductService.updatePrice({
      priceId: existingPrice.stripePriceId,
      nickname: params.nickname,
      metadata: params.metadata,
    });

    const price = await this.stripePriceRepository.update({
      id: params.id,
      nickname: params.nickname,
      metadata: params.metadata ? JSON.stringify(params.metadata) : undefined,
    });

    return this.jsonApiService.buildSingle(StripePriceModel, price);
  }

  /**
   * Sync product data from Stripe to local database
   *
   * Fetches the latest product data from Stripe and updates or creates the local database record.
   * Used primarily by webhook handlers to keep data in sync.
   *
   * @param params - Parameters
   * @param params.stripeProductId - Stripe product ID to sync
   * @returns Promise that resolves when sync is complete
   */
  async syncProductFromStripe(params: { stripeProductId: string }): Promise<void> {
    const stripeProduct = await this.stripeProductService.retrieveProduct(params.stripeProductId);

    const existingProduct = await this.stripeProductRepository.findByStripeProductId({
      stripeProductId: params.stripeProductId,
    });

    if (existingProduct) {
      await this.stripeProductRepository.updateByStripeProductId({
        stripeProductId: params.stripeProductId,
        name: stripeProduct.name,
        description: stripeProduct.description ?? undefined,
        active: stripeProduct.active,
        metadata: stripeProduct.metadata ? JSON.stringify(stripeProduct.metadata) : undefined,
      });
    } else {
      await this.stripeProductRepository.create({
        stripeProductId: stripeProduct.id,
        name: stripeProduct.name,
        description: stripeProduct.description ?? undefined,
        active: stripeProduct.active,
        metadata: stripeProduct.metadata ? JSON.stringify(stripeProduct.metadata) : undefined,
      });
    }
  }

  /**
   * Sync price data from Stripe to local database
   *
   * Fetches the latest price data from Stripe and updates or creates the local database record.
   * Automatically syncs the associated product if not found locally.
   * Used primarily by webhook handlers to keep data in sync.
   *
   * @param params - Parameters
   * @param params.stripePriceId - Stripe price ID to sync
   * @returns Promise that resolves when sync is complete
   */
  async syncPriceFromStripe(params: { stripePriceId: string }): Promise<void> {
    const stripePrice = await this.stripeProductService.retrievePrice(params.stripePriceId);

    const existingPrice = await this.stripePriceRepository.findByStripePriceId({
      stripePriceId: params.stripePriceId,
    });

    if (existingPrice) {
      await this.stripePriceRepository.updateByStripePriceId({
        stripePriceId: params.stripePriceId,
        active: stripePrice.active,
        nickname: stripePrice.nickname ?? undefined,
        metadata: stripePrice.metadata ? JSON.stringify(stripePrice.metadata) : undefined,
      });
    } else {
      const productId = typeof stripePrice.product === "string" ? stripePrice.product : stripePrice.product.id;

      let product = await this.stripeProductRepository.findByStripeProductId({
        stripeProductId: productId,
      });

      if (!product) {
        await this.syncProductFromStripe({ stripeProductId: productId });
        product = await this.stripeProductRepository.findByStripeProductId({
          stripeProductId: productId,
        });
      }

      if (product) {
        await this.stripePriceRepository.create({
          productId: product.id,
          stripePriceId: stripePrice.id,
          active: stripePrice.active,
          currency: stripePrice.currency,
          unitAmount: stripePrice.unit_amount ?? undefined,
          priceType: stripePrice.type === "recurring" ? "recurring" : "one_time",
          recurringInterval: stripePrice.recurring?.interval,
          recurringIntervalCount: stripePrice.recurring?.interval_count,
          recurringUsageType: stripePrice.recurring?.meter ? "metered" : "licensed",
          nickname: stripePrice.nickname ?? undefined,
          lookupKey: stripePrice.lookup_key ?? undefined,
          metadata: stripePrice.metadata ? JSON.stringify(stripePrice.metadata) : undefined,
        });
      }
    }
  }
}
