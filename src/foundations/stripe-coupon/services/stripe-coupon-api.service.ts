import { Injectable } from "@nestjs/common";
import Stripe from "stripe";
import { HandleStripeErrors } from "../../stripe/errors/stripe.errors";
import { StripeService } from "../../stripe/services/stripe.service";
import type { StripeCouponDiscountTerms, StripeCouponDurationTerms } from "../entities/stripe-coupon";

const toUnixSeconds = (date: Date): number => Math.floor(date.getTime() / 1000);

/**
 * Stripe Coupon API Service
 *
 * Thin wrapper over the Stripe SDK for coupons and their customer-facing promotion codes.
 * Stripe only allows a coupon's name (and metadata) to change after creation, and a
 * promotion code's `active` flag, so there is no general update method.
 */
@Injectable()
export class StripeCouponApiService {
  constructor(private readonly stripeService: StripeService) {}

  /**
   * Create a coupon: a percentage or a fixed amount (with its currency), for once, for ever or
   * for a number of months.
   */
  @HandleStripeErrors()
  async createCoupon(params: {
    id?: string;
    name: string;
    discount: StripeCouponDiscountTerms;
    duration: StripeCouponDurationTerms;
    stripeProductIds?: string[];
    redeemBy?: Date;
    maxRedemptions?: number;
  }): Promise<Stripe.Coupon> {
    const stripe = this.stripeService.getClient();

    const couponParams: Stripe.CouponCreateParams = {
      name: params.name,
      duration: params.duration.duration,
    };

    if (params.id) couponParams.id = params.id;

    if (params.discount.discountType === "percent_off") {
      couponParams.percent_off = params.discount.percentOff;
    } else {
      couponParams.amount_off = params.discount.amountOff;
      couponParams.currency = params.discount.currency;
    }

    if (params.duration.duration === "repeating") {
      couponParams.duration_in_months = params.duration.durationInMonths;
    }

    if (params.maxRedemptions !== undefined && params.maxRedemptions !== null) {
      couponParams.max_redemptions = params.maxRedemptions;
    }

    if (params.stripeProductIds?.length) {
      couponParams.applies_to = { products: params.stripeProductIds };
    }

    if (params.redeemBy) couponParams.redeem_by = toUnixSeconds(params.redeemBy);

    return stripe.coupons.create(couponParams);
  }

  /**
   * Rename a coupon (the name is shown to customers on invoices).
   */
  @HandleStripeErrors()
  async renameCoupon(params: { stripeCouponId: string; name: string }): Promise<Stripe.Coupon> {
    const stripe = this.stripeService.getClient();
    return stripe.coupons.update(params.stripeCouponId, { name: params.name });
  }

  /**
   * Delete a coupon. Used to roll back a coupon whose first code could not be created.
   */
  @HandleStripeErrors()
  async deleteCoupon(stripeCouponId: string): Promise<void> {
    const stripe = this.stripeService.getClient();
    await stripe.coupons.del(stripeCouponId);
  }

  @HandleStripeErrors()
  async retrieveCoupon(stripeCouponId: string): Promise<Stripe.Coupon> {
    const stripe = this.stripeService.getClient();
    return stripe.coupons.retrieve(stripeCouponId);
  }

  /**
   * Create a customer-facing promotion code on a coupon. With this API version the coupon
   * goes under `promotion` (`{ type: "coupon", coupon }`), not on the code itself.
   * Stripe generates the code text when `code` is empty.
   */
  @HandleStripeErrors()
  async createPromotionCode(params: {
    stripeCouponId: string;
    code?: string;
    firstTimeTransaction?: boolean;
    minimumAmount?: number;
    minimumAmountCurrency?: string;
    stripeCustomerId?: string;
    expiresAt?: Date;
    maxRedemptions?: number;
  }): Promise<Stripe.PromotionCode> {
    const stripe = this.stripeService.getClient();

    const codeParams: Stripe.PromotionCodeCreateParams = {
      promotion: { type: "coupon", coupon: params.stripeCouponId },
    };

    if (params.code) codeParams.code = params.code;
    if (params.stripeCustomerId) codeParams.customer = params.stripeCustomerId;
    if (params.expiresAt) codeParams.expires_at = toUnixSeconds(params.expiresAt);
    if (params.maxRedemptions !== undefined && params.maxRedemptions !== null) {
      codeParams.max_redemptions = params.maxRedemptions;
    }

    const restrictions: Stripe.PromotionCodeCreateParams.Restrictions = {};
    if (params.firstTimeTransaction !== undefined) restrictions.first_time_transaction = params.firstTimeTransaction;
    if (params.minimumAmount !== undefined && params.minimumAmount !== null) {
      restrictions.minimum_amount = params.minimumAmount;
      if (params.minimumAmountCurrency) restrictions.minimum_amount_currency = params.minimumAmountCurrency;
    }
    if (Object.keys(restrictions).length > 0) codeParams.restrictions = restrictions;

    return stripe.promotionCodes.create(codeParams);
  }

  /**
   * Deactivate or reactivate a promotion code. An expired or used-up code stays unusable.
   */
  @HandleStripeErrors()
  async setPromotionCodeActive(params: {
    stripePromotionCodeId: string;
    active: boolean;
  }): Promise<Stripe.PromotionCode> {
    const stripe = this.stripeService.getClient();
    return stripe.promotionCodes.update(params.stripePromotionCodeId, { active: params.active });
  }

  /**
   * Retrieve a promotion code with its coupon expanded. The coupon hangs off `promotion`,
   * so the expansion is `promotion.coupon` (expanding `coupon` is silently ignored).
   */
  @HandleStripeErrors()
  async retrievePromotionCode(stripePromotionCodeId: string): Promise<Stripe.PromotionCode> {
    const stripe = this.stripeService.getClient();
    return stripe.promotionCodes.retrieve(stripePromotionCodeId, { expand: ["promotion.coupon"] });
  }
}
