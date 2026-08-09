import { Injectable } from "@nestjs/common";
import Stripe from "stripe";
import { StripeService } from "../../stripe/services/stripe.service";
import { HandleStripeErrors } from "../../stripe/errors/stripe.errors";
import { stripePromotionCodeMeta } from "../entities/stripe-promotion-code.meta";
import { toStripeCouponDuration, type StripeCouponDuration } from "../entities/stripe-promotion-code.entity";

export interface PromotionCodeValidationAttributes {
  valid: boolean;
  promotionCodeId?: string;
  code: string;
  discountType?: "percent_off" | "amount_off";
  discountValue?: number;
  currency?: string;
  duration?: StripeCouponDuration;
  durationInMonths?: number;
  errorMessage?: string;
}

export interface PromotionCodeValidationResult {
  data: {
    type: string;
    id: string;
    attributes: PromotionCodeValidationAttributes;
  };
}

@Injectable()
export class StripePromotionCodeApiService {
  constructor(private readonly stripeService: StripeService) {}

  private createResponse(attributes: PromotionCodeValidationAttributes): PromotionCodeValidationResult {
    return {
      data: {
        type: stripePromotionCodeMeta.type,
        id: attributes.promotionCodeId || attributes.code,
        attributes,
      },
    };
  }

  @HandleStripeErrors()
  async validatePromotionCode(params: {
    code: string;
    stripeCustomerId?: string;
    stripePriceId?: string;
  }): Promise<PromotionCodeValidationResult> {
    const stripe = this.stripeService.getClient();

    // 1. Look up promotion code with expanded coupon
    const promotionCodes = await stripe.promotionCodes.list({
      code: params.code,
      active: true,
      limit: 1,
      expand: ["data.coupon"],
    });

    if (promotionCodes.data.length === 0) {
      return this.createResponse({
        valid: false,
        code: params.code,
        errorMessage: "Invalid promotion code",
      });
    }

    const promoCode = promotionCodes.data[0] as any;

    // Get the coupon directly from the promotion code object
    // Note: TypeScript types may not include coupon, but Stripe API returns it
    const coupon = promoCode.coupon as Stripe.Coupon;
    if (!coupon) {
      return this.createResponse({
        valid: false,
        code: params.code,
        errorMessage: "Unable to validate promotion code",
      });
    }

    // 2. Check coupon validity
    if (!coupon.valid) {
      return this.createResponse({
        valid: false,
        code: params.code,
        errorMessage: "This promotion code is no longer valid",
      });
    }

    // 3. Check redemption limits
    if (promoCode.max_redemptions && promoCode.times_redeemed >= promoCode.max_redemptions) {
      return this.createResponse({
        valid: false,
        code: params.code,
        errorMessage: "This promotion code has reached its usage limit",
      });
    }

    // 4. Check expiration
    if (promoCode.expires_at && promoCode.expires_at < Math.floor(Date.now() / 1000)) {
      return this.createResponse({
        valid: false,
        code: params.code,
        errorMessage: "This promotion code has expired",
      });
    }

    // 5. Check product restrictions if priceId provided
    if (params.stripePriceId && coupon.applies_to?.products) {
      const price = await stripe.prices.retrieve(params.stripePriceId);
      const productId = typeof price.product === "string" ? price.product : price.product.id;

      if (!coupon.applies_to.products.includes(productId)) {
        return this.createResponse({
          valid: false,
          code: params.code,
          errorMessage: "This promotion code does not apply to the selected plan",
        });
      }
    }

    // 6. Check first-time customer restriction
    if (promoCode.restrictions?.first_time_transaction && params.stripeCustomerId) {
      const subscriptions = await stripe.subscriptions.list({
        customer: params.stripeCustomerId,
        limit: 1,
      });

      if (subscriptions.data.length > 0) {
        return this.createResponse({
          valid: false,
          code: params.code,
          errorMessage: "This promotion code is only valid for first-time subscribers",
        });
      }
    }

    // Valid code - return discount details
    return this.createResponse({
      valid: true,
      promotionCodeId: promoCode.id,
      code: params.code,
      discountType: coupon.percent_off ? "percent_off" : "amount_off",
      discountValue: coupon.percent_off || coupon.amount_off || 0,
      currency: coupon.currency || undefined,
      duration: toStripeCouponDuration(coupon.duration),
      durationInMonths: coupon.duration_in_months || undefined,
    });
  }
}
