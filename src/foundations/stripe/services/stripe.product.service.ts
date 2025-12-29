import { Injectable } from "@nestjs/common";
import Stripe from "stripe";
import { StripeService } from "./stripe.service";
import { HandleStripeErrors } from "../errors/stripe.errors";

/**
 * Stripe Product Service
 *
 * Manages Stripe products and prices. Products represent goods or services offered,
 * while prices define how those products are charged (one-time or recurring).
 * Supports usage-based pricing with Stripe Billing Meters (v20+).
 *
 * @example
 * ```typescript
 * const product = await stripeProductService.createProduct({
 *   name: 'Premium Plan',
 *   description: 'Full access to all features',
 * });
 *
 * const price = await stripeProductService.createPrice({
 *   productId: product.id,
 *   unitAmount: 2999,
 *   currency: 'usd',
 *   recurring: { interval: 'month' },
 * });
 * ```
 */
@Injectable()
export class StripeProductService {
  constructor(private readonly stripeService: StripeService) {}

  /**
   * Create a new product
   *
   * @param params - Product creation parameters
   * @param params.name - Product name
   * @param params.description - Product description (optional)
   * @param params.metadata - Additional metadata (optional)
   * @returns Promise resolving to the created product
   * @throws {StripeError} If product creation fails
   *
   * @example
   * ```typescript
   * const product = await service.createProduct({
   *   name: 'Premium Plan',
   *   description: 'Full access to all features',
   *   metadata: { tier: 'premium' },
   * });
   * ```
   */
  @HandleStripeErrors()
  async createProduct(params: {
    name: string;
    description?: string;
    metadata?: Record<string, string>;
  }): Promise<Stripe.Product> {
    const stripe = this.stripeService.getClient();
    return stripe.products.create({
      name: params.name,
      description: params.description,
      metadata: params.metadata,
    });
  }

  /**
   * Retrieve a product by ID
   *
   * @param productId - The Stripe product ID
   * @returns Promise resolving to the product
   * @throws {StripeError} If retrieval fails
   *
   * @example
   * ```typescript
   * const product = await service.retrieveProduct('prod_abc123');
   * ```
   */
  @HandleStripeErrors()
  async retrieveProduct(productId: string): Promise<Stripe.Product> {
    const stripe = this.stripeService.getClient();
    return stripe.products.retrieve(productId);
  }

  /**
   * Update a product
   *
   * @param params - Product update parameters
   * @param params.productId - The product ID to update
   * @param params.name - New name (optional)
   * @param params.description - New description (optional)
   * @param params.active - Active status (optional)
   * @param params.metadata - Updated metadata (optional)
   * @returns Promise resolving to the updated product
   * @throws {StripeError} If update fails
   *
   * @example
   * ```typescript
   * const product = await service.updateProduct({
   *   productId: 'prod_abc123',
   *   name: 'Updated Premium Plan',
   *   active: true,
   * });
   * ```
   */
  @HandleStripeErrors()
  async updateProduct(params: {
    productId: string;
    name?: string;
    description?: string;
    active?: boolean;
    metadata?: Record<string, string>;
  }): Promise<Stripe.Product> {
    const stripe = this.stripeService.getClient();
    const updateData: Stripe.ProductUpdateParams = {};
    if (params.name !== undefined) updateData.name = params.name;
    if (params.description !== undefined) updateData.description = params.description;
    if (params.active !== undefined) updateData.active = params.active;
    if (params.metadata) updateData.metadata = params.metadata;
    return stripe.products.update(params.productId, updateData);
  }

  /**
   * Archive a product by setting it to inactive
   *
   * @param productId - The product ID to archive
   * @returns Promise resolving to the archived product
   * @throws {StripeError} If archiving fails
   *
   * @example
   * ```typescript
   * const product = await service.archiveProduct('prod_abc123');
   * ```
   *
   * @remarks
   * Archived products cannot be used for new purchases but existing subscriptions continue.
   */
  @HandleStripeErrors()
  async archiveProduct(productId: string): Promise<Stripe.Product> {
    const stripe = this.stripeService.getClient();
    return stripe.products.update(productId, { active: false });
  }

  /**
   * List all products
   *
   * @param active - Filter by active status (optional)
   * @returns Promise resolving to array of products
   * @throws {StripeError} If listing fails
   *
   * @example
   * ```typescript
   * // List all products
   * const allProducts = await service.listProducts();
   *
   * // List only active products
   * const activeProducts = await service.listProducts(true);
   * ```
   */
  @HandleStripeErrors()
  async listProducts(active?: boolean): Promise<Stripe.Product[]> {
    const stripe = this.stripeService.getClient();
    const params: Stripe.ProductListParams = { limit: 100 };
    if (active !== undefined) params.active = active;
    const products = await stripe.products.list(params);
    return products.data;
  }

  /**
   * Create a price for a product
   *
   * @param params - Price creation parameters
   * @param params.productId - The product ID to create a price for
   * @param params.unitAmount - Price amount in cents
   * @param params.currency - Three-letter currency code (e.g., 'usd')
   * @param params.nickname - Internal nickname for the price (optional)
   * @param params.lookupKey - Lookup key for retrieving the price (optional)
   * @param params.recurring - Recurring billing configuration (optional)
   * @param params.recurring.interval - Billing interval (day/week/month/year)
   * @param params.recurring.intervalCount - Number of intervals between billings (optional)
   * @param params.recurring.meter - Billing meter ID for usage-based pricing (Stripe v20+) (optional)
   * @param params.metadata - Additional metadata (optional)
   * @returns Promise resolving to the created price
   * @throws {StripeError} If price creation fails
   *
   * @example
   * ```typescript
   * // One-time price
   * const oneTimePrice = await service.createPrice({
   *   productId: 'prod_abc123',
   *   unitAmount: 9999,
   *   currency: 'usd',
   * });
   *
   * // Monthly recurring price
   * const monthlyPrice = await service.createPrice({
   *   productId: 'prod_abc123',
   *   unitAmount: 2999,
   *   currency: 'usd',
   *   recurring: { interval: 'month' },
   * });
   *
   * // Usage-based price with billing meter
   * const usagePrice = await service.createPrice({
   *   productId: 'prod_abc123',
   *   unitAmount: 100,
   *   currency: 'usd',
   *   recurring: {
   *     interval: 'month',
   *     meter: 'mtr_api_calls',
   *   },
   * });
   * ```
   */
  @HandleStripeErrors()
  async createPrice(params: {
    productId: string;
    unitAmount: number;
    currency: string;
    nickname?: string;
    lookupKey?: string;
    recurring?: {
      interval: "day" | "week" | "month" | "year";
      intervalCount?: number;
      meter?: string; // Billing meter ID for usage-based pricing (Stripe v20+)
    };
    metadata?: Record<string, string>;
  }): Promise<Stripe.Price> {
    const stripe = this.stripeService.getClient();

    const priceParams: Stripe.PriceCreateParams = {
      product: params.productId,
      unit_amount: params.unitAmount,
      currency: params.currency,
      nickname: params.nickname,
      lookup_key: params.lookupKey,
      metadata: params.metadata,
    };

    if (params.recurring) {
      priceParams.recurring = {
        interval: params.recurring.interval,
        interval_count: params.recurring.intervalCount,
        meter: params.recurring.meter, // For usage-based pricing with Billing Meters
      };
    }

    return stripe.prices.create(priceParams);
  }

  /**
   * Retrieve a price by ID
   *
   * @param priceId - The Stripe price ID
   * @returns Promise resolving to the price
   * @throws {StripeError} If retrieval fails
   *
   * @example
   * ```typescript
   * const price = await service.retrievePrice('price_abc123');
   * ```
   */
  @HandleStripeErrors()
  async retrievePrice(priceId: string): Promise<Stripe.Price> {
    const stripe = this.stripeService.getClient();
    return stripe.prices.retrieve(priceId);
  }

  /**
   * Update a price
   *
   * @param params - Price update parameters
   * @param params.priceId - The price ID to update
   * @param params.nickname - New nickname (optional)
   * @param params.active - Active status (optional)
   * @param params.metadata - Updated metadata (optional)
   * @returns Promise resolving to the updated price
   * @throws {StripeError} If update fails
   *
   * @example
   * ```typescript
   * const price = await service.updatePrice({
   *   priceId: 'price_abc123',
   *   nickname: 'Monthly Premium',
   *   active: false,
   * });
   * ```
   *
   * @remarks
   * Most price properties cannot be updated after creation. Create a new price instead.
   */
  @HandleStripeErrors()
  async updatePrice(params: {
    priceId: string;
    nickname?: string;
    active?: boolean;
    metadata?: Record<string, string>;
  }): Promise<Stripe.Price> {
    const stripe = this.stripeService.getClient();
    const updateData: Stripe.PriceUpdateParams = {};
    if (params.nickname !== undefined) updateData.nickname = params.nickname;
    if (params.active !== undefined) updateData.active = params.active;
    if (params.metadata) updateData.metadata = params.metadata;
    return stripe.prices.update(params.priceId, updateData);
  }

  /**
   * List prices with optional filters
   *
   * @param params - Listing parameters (optional)
   * @param params.productId - Filter by product ID (optional)
   * @param params.active - Filter by active status (optional)
   * @returns Promise resolving to array of prices with expanded product data
   * @throws {StripeError} If listing fails
   *
   * @example
   * ```typescript
   * // List all prices
   * const allPrices = await service.listPrices();
   *
   * // List prices for a specific product
   * const productPrices = await service.listPrices({ productId: 'prod_abc123' });
   *
   * // List only active prices
   * const activePrices = await service.listPrices({ active: true });
   * ```
   */
  @HandleStripeErrors()
  async listPrices(params?: { productId?: string; active?: boolean }): Promise<Stripe.Price[]> {
    const stripe = this.stripeService.getClient();
    const listParams: Stripe.PriceListParams = { limit: 100, expand: ["data.product"] };
    if (params?.productId) listParams.product = params.productId;
    if (params?.active !== undefined) listParams.active = params.active;
    const prices = await stripe.prices.list(listParams);
    return prices.data;
  }
}
