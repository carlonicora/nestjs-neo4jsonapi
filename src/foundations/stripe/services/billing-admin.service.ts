import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { JsonApiDataInterface } from "@carlonicora/nestjs-neo4jsonapi";
import { JsonApiPaginator } from "@carlonicora/nestjs-neo4jsonapi";
import { JsonApiService } from "@carlonicora/nestjs-neo4jsonapi";
import { StripeProductService } from "@carlonicora/nestjs-neo4jsonapi";
import { StripePriceModel } from "../entities/stripe-price.model";
import { StripeProductModel } from "../entities/stripe-product.model";
import { StripePriceRepository } from "../repositories/stripe-price.repository";
import { StripeProductRepository } from "../repositories/stripe-product.repository";

@Injectable()
export class BillingAdminService {
  constructor(
    private readonly stripeProductRepository: StripeProductRepository,
    private readonly stripePriceRepository: StripePriceRepository,
    private readonly stripeProductService: StripeProductService,
    private readonly jsonApiService: JsonApiService,
  ) {}

  // Products

  async listProducts(params: { query: any; active?: boolean }): Promise<JsonApiDataInterface> {
    const paginator = new JsonApiPaginator(params.query);

    const products = await this.stripeProductRepository.findAll({
      active: params.active,
    });

    return this.jsonApiService.buildList(StripeProductModel, products, paginator);
  }

  async getProduct(params: { id: string }): Promise<JsonApiDataInterface> {
    const product = await this.stripeProductRepository.findById({ id: params.id });

    if (!product) {
      throw new HttpException("Product not found", HttpStatus.NOT_FOUND);
    }

    return this.jsonApiService.buildSingle(StripeProductModel, product);
  }

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

  // Prices

  async listPrices(params: { query: any; productId?: string; active?: boolean }): Promise<JsonApiDataInterface> {
    const paginator = new JsonApiPaginator(params.query);

    const prices = await this.stripePriceRepository.findAll({
      productId: params.productId,
      active: params.active,
    });

    return this.jsonApiService.buildList(StripePriceModel, prices, paginator);
  }

  async getPrice(params: { id: string }): Promise<JsonApiDataInterface> {
    const price = await this.stripePriceRepository.findById({ id: params.id });

    if (!price) {
      throw new HttpException("Price not found", HttpStatus.NOT_FOUND);
    }

    return this.jsonApiService.buildSingle(StripePriceModel, price);
  }

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
