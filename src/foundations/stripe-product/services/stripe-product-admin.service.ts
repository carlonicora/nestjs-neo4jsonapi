import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { JsonApiPaginator, JsonApiService, JsonApiListDocument, JsonApiSingleDocument } from "../../../core/jsonapi";
import { StripeProductPostDataDTO, StripeProductPutDataDTO } from "../dtos/stripe-product.dto";
import { StripeProductModel } from "../entities/stripe-product.model";
import { StripeProductRepository } from "../repositories/stripe-product.repository";
import { StripeProductApiService } from "./stripe-product-api.service";

/**
 * StripeProductAdminService
 *
 * Administrative service for managing Stripe products in the billing system.
 * Provides CRUD operations for products, with two-way sync between Stripe and local database.
 *
 * Key Features:
 * - Product management (create, update, archive, list)
 * - Sync products from Stripe webhooks
 * - Filter products by active status
 *
 * This service is typically used by admin/backend operations to set up billing product offerings
 * before customers subscribe.
 */
@Injectable()
export class StripeProductAdminService {
  constructor(
    private readonly stripeProductRepository: StripeProductRepository,
    private readonly stripeProductApiService: StripeProductApiService,
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
   * const products = await stripeProductAdminService.listProducts({
   *   query: { page: { number: 1, size: 10 } },
   *   active: true
   * });
   * ```
   */
  async listProducts(params: { query: any; active?: boolean }): Promise<JsonApiListDocument> {
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
  async getProduct(params: { id: string }): Promise<JsonApiSingleDocument> {
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
   * @param params - JSONAPI-formatted product parameters
   * @param params.data - Product data wrapper
   * @param params.data.id - Product UUID
   * @param params.data.type - Product type (must be 'stripe-products')
   * @param params.data.attributes - Product attributes
   * @param params.data.attributes.name - Product name
   * @param params.data.attributes.description - Optional product description
   * @param params.data.attributes.metadata - Optional metadata key-value pairs
   * @returns JSON:API formatted product data
   *
   * @example
   * ```typescript
   * const product = await stripeProductAdminService.createProduct({
   *   data: {
   *     id: uuidv4(),
   *     type: 'stripe-products',
   *     attributes: {
   *       name: 'Premium Plan',
   *       description: 'Full access to all features',
   *       metadata: { tier: 'premium' }
   *     }
   *   }
   * });
   * ```
   */
  async createProduct(params: { data: StripeProductPostDataDTO }): Promise<JsonApiSingleDocument> {
    const stripeProduct = await this.stripeProductApiService.createProduct({
      name: params.data.attributes.name,
      description: params.data.attributes.description,
      metadata: params.data.attributes.metadata,
    });

    const product = await this.stripeProductRepository.create({
      id: params.data.id,
      stripeProductId: stripeProduct.id,
      name: params.data.attributes.name,
      description: params.data.attributes.description,
      active: stripeProduct.active,
      metadata: params.data.attributes.metadata ? JSON.stringify(params.data.attributes.metadata) : undefined,
    });

    return this.jsonApiService.buildSingle(StripeProductModel, product);
  }

  /**
   * Update an existing product
   *
   * @param params - JSONAPI-formatted update parameters
   * @param params.data - Product data wrapper
   * @param params.data.id - Product UUID
   * @param params.data.type - Product type (must be 'stripe-products')
   * @param params.data.attributes - Optional product attributes to update
   * @param params.data.attributes.name - Optional new name
   * @param params.data.attributes.description - Optional new description
   * @param params.data.attributes.metadata - Optional new metadata
   * @returns JSON:API formatted updated product data
   * @throws {HttpException} NOT_FOUND if product not found
   */
  async updateProduct(params: { data: StripeProductPutDataDTO }): Promise<JsonApiSingleDocument> {
    const existingProduct = await this.stripeProductRepository.findById({ id: params.data.id });

    if (!existingProduct) {
      throw new HttpException("Product not found", HttpStatus.NOT_FOUND);
    }

    await this.stripeProductApiService.updateProduct({
      productId: existingProduct.stripeProductId,
      name: params.data.attributes?.name,
      description: params.data.attributes?.description,
      metadata: params.data.attributes?.metadata,
    });

    const product = await this.stripeProductRepository.update({
      id: params.data.id,
      name: params.data.attributes?.name,
      description: params.data.attributes?.description,
      metadata: params.data.attributes?.metadata ? JSON.stringify(params.data.attributes.metadata) : undefined,
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

    await this.stripeProductApiService.archiveProduct(existingProduct.stripeProductId);

    await this.stripeProductRepository.update({
      id: params.id,
      active: false,
    });
  }

  /**
   * Reactivate a product
   *
   * Sets the product as active in both Stripe and the local database.
   * Active products can be used for new subscriptions.
   *
   * @param params - Parameters
   * @param params.id - Product ID
   * @returns Promise that resolves when reactivation is complete
   * @throws {HttpException} NOT_FOUND if product not found
   */
  async reactivateProduct(params: { id: string }): Promise<void> {
    const existingProduct = await this.stripeProductRepository.findById({ id: params.id });

    if (!existingProduct) {
      throw new HttpException("Product not found", HttpStatus.NOT_FOUND);
    }

    await this.stripeProductApiService.reactivateProduct(existingProduct.stripeProductId);

    await this.stripeProductRepository.update({
      id: params.id,
      active: true,
    });
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
    const stripeProduct = await this.stripeProductApiService.retrieveProduct(params.stripeProductId);

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
}
