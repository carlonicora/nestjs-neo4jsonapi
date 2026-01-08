import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { JsonApiDataInterface, JsonApiPaginator, JsonApiService } from "../../../core/jsonapi";
import { StripeProductRepository } from "../../stripe-product/repositories/stripe-product.repository";
import { StripeProductAdminService } from "../../stripe-product/services/stripe-product-admin.service";
import { StripeProductApiService } from "../../stripe-product/services/stripe-product-api.service";
import { StripePricePostDataDTO, StripePricePutDataDTO } from "../dtos/stripe-price.dto";
import { StripePriceModel } from "../entities/stripe-price.model";
import { StripePriceRepository } from "../repositories/stripe-price.repository";

/**
 * StripePriceAdminService
 *
 * Administrative service for managing Stripe prices in the billing system.
 * Provides CRUD operations for prices, with two-way sync between Stripe and local database.
 *
 * Key Features:
 * - Price management (create, update, list)
 * - Support for one-time and recurring prices
 * - Support for usage-based billing with meters
 * - Sync prices from Stripe webhooks
 * - Filter prices by active status and product
 *
 * This service is typically used by admin/backend operations to set up billing pricing
 * before customers subscribe.
 */
@Injectable()
export class StripePriceAdminService {
  constructor(
    private readonly stripePriceRepository: StripePriceRepository,
    private readonly stripeProductRepository: StripeProductRepository,
    private readonly stripeProductApiService: StripeProductApiService,
    private readonly stripeProductAdminService: StripeProductAdminService,
    private readonly jsonApiService: JsonApiService,
  ) {}

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
   * const prices = await stripePriceAdminService.listPrices({
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
   * @param params - JSONAPI formatted price creation data
   * @param params.data - JSONAPI data object
   * @param params.data.attributes - Price attributes
   * @param params.data.attributes.productId - Product ID to attach price to
   * @param params.data.attributes.unitAmount - Price amount in smallest currency unit (e.g., cents)
   * @param params.data.attributes.currency - Currency code (e.g., 'usd', 'eur')
   * @param params.data.attributes.nickname - Optional display name
   * @param params.data.attributes.lookupKey - Optional lookup key for referencing price
   * @param params.data.attributes.recurring - Optional recurring billing configuration
   * @param params.data.attributes.metadata - Optional metadata key-value pairs
   * @returns JSON:API formatted price data
   * @throws {HttpException} NOT_FOUND if product not found
   *
   * @example
   * ```typescript
   * // Create a monthly subscription price
   * const price = await stripePriceAdminService.createPrice({
   *   data: {
   *     type: 'stripe-prices',
   *     id: uuid(),
   *     attributes: {
   *       productId: 'prod_123',
   *       unitAmount: 2999, // $29.99
   *       currency: 'usd',
   *       nickname: 'Monthly Premium',
   *       recurring: {
   *         interval: 'month',
   *         intervalCount: 1
   *       }
   *     }
   *   }
   * });
   * ```
   */
  async createPrice(params: { data: StripePricePostDataDTO }): Promise<JsonApiDataInterface> {
    const product = await this.stripeProductRepository.findById({ id: params.data.attributes.productId });

    if (!product) {
      throw new HttpException("Product not found", HttpStatus.NOT_FOUND);
    }

    const stripePrice = await this.stripeProductApiService.createPrice({
      productId: product.stripeProductId,
      unitAmount: params.data.attributes.unitAmount,
      currency: params.data.attributes.currency,
      nickname: params.data.attributes.nickname,
      lookupKey: params.data.attributes.lookupKey,
      recurring: params.data.attributes.recurring,
      metadata: params.data.attributes.metadata,
    });

    const price = await this.stripePriceRepository.create({
      productId: params.data.attributes.productId,
      stripePriceId: stripePrice.id,
      active: stripePrice.active,
      currency: params.data.attributes.currency,
      unitAmount: params.data.attributes.unitAmount,
      priceType: params.data.attributes.recurring ? "recurring" : "one_time",
      recurringInterval: params.data.attributes.recurring?.interval,
      recurringIntervalCount: params.data.attributes.recurring?.intervalCount,
      recurringUsageType: params.data.attributes.recurring?.meter ? "metered" : "licensed",
      nickname: params.data.attributes.nickname,
      lookupKey: params.data.attributes.lookupKey,
      metadata: params.data.attributes.metadata ? JSON.stringify(params.data.attributes.metadata) : undefined,
      description: params.data.attributes.description,
      features: params.data.attributes.features,
      token: params.data.attributes.token,
    });

    return this.jsonApiService.buildSingle(StripePriceModel, price);
  }

  /**
   * Update an existing price
   *
   * Note: Most price fields are immutable in Stripe. Only nickname and metadata can be updated.
   *
   * @param params - JSONAPI formatted price update data
   * @param params.data - JSONAPI data object
   * @param params.data.id - Price ID (UUID)
   * @param params.data.attributes - Price attributes to update
   * @param params.data.attributes.nickname - Optional new nickname
   * @param params.data.attributes.metadata - Optional new metadata
   * @returns JSON:API formatted updated price data
   * @throws {HttpException} NOT_FOUND if price not found
   */
  async updatePrice(params: { data: StripePricePutDataDTO }): Promise<JsonApiDataInterface> {
    const existingPrice = await this.stripePriceRepository.findById({ id: params.data.id });

    if (!existingPrice) {
      throw new HttpException("Price not found", HttpStatus.NOT_FOUND);
    }

    await this.stripeProductApiService.updatePrice({
      priceId: existingPrice.stripePriceId,
      nickname: params.data.attributes?.nickname,
      metadata: params.data.attributes?.metadata,
    });

    const price = await this.stripePriceRepository.update({
      id: params.data.id,
      nickname: params.data.attributes?.nickname,
      metadata: params.data.attributes?.metadata ? JSON.stringify(params.data.attributes.metadata) : undefined,
      description: params.data.attributes?.description,
      features: params.data.attributes?.features,
      token: params.data.attributes?.token,
    });

    return this.jsonApiService.buildSingle(StripePriceModel, price);
  }

  /**
   * Archive a price
   *
   * Sets the price as inactive in both Stripe and the local database.
   * Archived prices cannot be used for new subscriptions.
   *
   * @param params - Parameters
   * @param params.id - Price ID
   * @returns Promise that resolves when archival is complete
   * @throws {HttpException} NOT_FOUND if price not found
   */
  async archivePrice(params: { id: string }): Promise<void> {
    const existingPrice = await this.stripePriceRepository.findById({ id: params.id });

    if (!existingPrice) {
      throw new HttpException("Price not found", HttpStatus.NOT_FOUND);
    }

    await this.stripeProductApiService.archivePrice(existingPrice.stripePriceId);

    await this.stripePriceRepository.update({
      id: params.id,
      active: false,
    });
  }

  /**
   * Reactivate a price
   *
   * Sets the price as active in both Stripe and the local database.
   * Active prices can be used for new subscriptions.
   *
   * @param params - Parameters
   * @param params.id - Price ID
   * @returns Promise that resolves when reactivation is complete
   * @throws {HttpException} NOT_FOUND if price not found
   */
  async reactivatePrice(params: { id: string }): Promise<void> {
    const existingPrice = await this.stripePriceRepository.findById({ id: params.id });

    if (!existingPrice) {
      throw new HttpException("Price not found", HttpStatus.NOT_FOUND);
    }

    await this.stripeProductApiService.reactivatePrice(existingPrice.stripePriceId);

    await this.stripePriceRepository.update({
      id: params.id,
      active: true,
    });
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
    const stripePrice = await this.stripeProductApiService.retrievePrice(params.stripePriceId);

    // Get nickname from Stripe price, or fallback to metadata.nickname if not set
    const nickname = stripePrice.nickname ?? (stripePrice.metadata?.nickname as string | undefined) ?? undefined;

    const existingPrice = await this.stripePriceRepository.findByStripePriceId({
      stripePriceId: params.stripePriceId,
    });

    if (existingPrice) {
      await this.stripePriceRepository.updateByStripePriceId({
        stripePriceId: params.stripePriceId,
        active: stripePrice.active,
        nickname,
        metadata: stripePrice.metadata ? JSON.stringify(stripePrice.metadata) : undefined,
      });
    } else {
      const productId = typeof stripePrice.product === "string" ? stripePrice.product : stripePrice.product.id;

      let product = await this.stripeProductRepository.findByStripeProductId({
        stripeProductId: productId,
      });

      if (!product) {
        await this.stripeProductAdminService.syncProductFromStripe({ stripeProductId: productId });
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
          nickname,
          lookupKey: stripePrice.lookup_key ?? undefined,
          metadata: stripePrice.metadata ? JSON.stringify(stripePrice.metadata) : undefined,
        });
      }
    }
  }
}
