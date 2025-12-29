import { Injectable } from "@nestjs/common";
import Stripe from "stripe";
import { StripeService } from "./stripe.service";
import { HandleStripeErrors } from "../errors/stripe.errors";

@Injectable()
export class StripeProductService {
  constructor(private readonly stripeService: StripeService) {}

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

  @HandleStripeErrors()
  async retrieveProduct(productId: string): Promise<Stripe.Product> {
    const stripe = this.stripeService.getClient();
    return stripe.products.retrieve(productId);
  }

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

  @HandleStripeErrors()
  async archiveProduct(productId: string): Promise<Stripe.Product> {
    const stripe = this.stripeService.getClient();
    return stripe.products.update(productId, { active: false });
  }

  @HandleStripeErrors()
  async listProducts(active?: boolean): Promise<Stripe.Product[]> {
    const stripe = this.stripeService.getClient();
    const params: Stripe.ProductListParams = { limit: 100 };
    if (active !== undefined) params.active = active;
    const products = await stripe.products.list(params);
    return products.data;
  }

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

  @HandleStripeErrors()
  async retrievePrice(priceId: string): Promise<Stripe.Price> {
    const stripe = this.stripeService.getClient();
    return stripe.prices.retrieve(priceId);
  }

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
