import { Injectable, Logger } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import Stripe from "stripe";
import { JsonApiListDocument } from "../../../core/jsonapi/interfaces/jsonapi.document.interface";
import { JsonApiPaginator } from "../../../core/jsonapi/serialisers/jsonapi.paginator";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AbstractService } from "../../../core/neo4j/abstracts/abstract.service";
import { StripeCustomerRepository } from "../../stripe-customer/repositories/stripe-customer.repository";
import { StripePriceRepository } from "../../stripe-price/repositories/stripe-price.repository";
import { StripeSubscriptionRepository } from "../../stripe-subscription/repositories/stripe-subscription.repository";
import { StripeCouponCode, StripeCouponCodeDescriptor } from "../entities/stripe-coupon-code";
import { StripeCouponCodeRepository } from "../repositories/stripe-coupon-code.repository";
import { StripeCouponRepository } from "../repositories/stripe-coupon.repository";
import { placesLeft } from "../utils/places-left";
import { StripeCouponApiService } from "./stripe-coupon-api.service";

/**
 * Checkout-side reads and writes on stored coupon codes: which code applies itself at a
 * GM's first payment, whether Stripe has run out of places, and keeping our counts current.
 */
@Injectable()
export class StripeCouponCodeCheckoutService extends AbstractService<
  StripeCouponCode,
  typeof StripeCouponCodeDescriptor.relationships
> {
  protected readonly descriptor = StripeCouponCodeDescriptor;
  private readonly logger: Logger = new Logger(StripeCouponCodeCheckoutService.name);

  constructor(
    jsonApiService: JsonApiService,
    private readonly stripeCouponCodeRepository: StripeCouponCodeRepository,
    clsService: ClsService,
    private readonly stripeCouponRepository: StripeCouponRepository,
    private readonly stripeCouponApiService: StripeCouponApiService,
    private readonly stripePriceRepository: StripePriceRepository,
    private readonly stripeCustomerRepository: StripeCustomerRepository,
    private readonly stripeSubscriptionRepository: StripeSubscriptionRepository,
  ) {
    super(jsonApiService, stripeCouponCodeRepository, clsService, StripeCouponCodeDescriptor.model);
  }

  /**
   * The automatic code, when it applies to this company paying this price for the first time.
   * Returns null whenever any rule fails: the GM then pays the normal price, with no error.
   */
  async findAutomaticForPrice(params: { companyId: string; priceId: string }): Promise<StripeCouponCode | null> {
    const code = await this.stripeCouponCodeRepository.findAutomatic();
    if (!code || !code.active || !code.automatic) return null;

    const coupon = code.coupon;
    if (!coupon || !coupon.valid) return null;

    const now = new Date();
    if (coupon.redeemBy && new Date(coupon.redeemBy).getTime() <= now.getTime()) return null;
    if (code.expiresAt && new Date(code.expiresAt).getTime() <= now.getTime()) return null;

    // Stripe treats a trial's €0 invoice as a past transaction, so a trial GM would be refused.
    if (code.firstTimeTransaction) return null;

    const left = placesLeft(code, coupon);
    if (left !== null && left <= 0) return null;

    const price = await this.stripePriceRepository.findById({ id: params.priceId });
    if (!price || price.priceType !== "recurring" || price.isTrial) return null;

    if (coupon.stripeProductIds?.length) {
      const stripeProductId = price.stripeProduct?.stripeProductId;
      if (!stripeProductId || !coupon.stripeProductIds.includes(stripeProductId)) return null;
    }

    if (code.minimumAmount !== undefined && code.minimumAmount !== null) {
      if (
        code.minimumAmountCurrency &&
        code.minimumAmountCurrency.toLowerCase() !== (price.currency ?? "").toLowerCase()
      )
        return null;
      if ((price.unitAmount ?? 0) < code.minimumAmount) return null;
    }

    const customer = await this.stripeCustomerRepository.findByCompanyId({ companyId: params.companyId });
    if (!customer) return null;

    if (code.stripeCustomerId && code.stripeCustomerId !== customer.stripeCustomerId) return null;

    // A first payment only: any subscription (canceled included) on a paid recurring price rules it out.
    const subscriptions = await this.stripeSubscriptionRepository.findByStripeCustomerId({
      stripeCustomerId: customer.id,
    });
    const hasPaidRecurring = subscriptions.some(
      (subscription) => subscription.stripePrice?.priceType === "recurring" && !subscription.stripePrice?.isTrial,
    );
    if (hasPaidRecurring) return null;

    return code;
  }

  /**
   * Checks a promotion code the browser sent at checkout against our automatic code.
   * - "not_automatic": not one of our automatic codes (typed or unknown); pass it to Stripe as is.
   * - "eligible": it is the automatic code and it applies to this first payment right now.
   * - "sold_out": it is the automatic code, it does not apply, and it has no places left.
   * - "unavailable": it is the automatic code and it does not apply for any other reason.
   * Uses the same rules as findAutomaticForPrice, so the review and the payment agree.
   */
  async checkAutomaticForPrice(params: {
    companyId: string;
    priceId: string;
    stripePromotionCodeId: string;
    firstPayment: boolean;
  }): Promise<"eligible" | "sold_out" | "unavailable" | "not_automatic"> {
    const code = await this.stripeCouponCodeRepository.findByStripePromotionCodeId({
      stripePromotionCodeId: params.stripePromotionCodeId,
    });
    if (!code || !code.automatic) return "not_automatic";

    // The automatic code only ever applies to a first payment, whatever its places.
    if (!params.firstPayment) return "unavailable";

    const current = await this.findAutomaticForPrice({ companyId: params.companyId, priceId: params.priceId });
    if (current?.stripePromotionCodeId === params.stripePromotionCodeId) return "eligible";

    return (await this.hasNoPlacesLeft(code)) ? "sold_out" : "unavailable";
  }

  /**
   * The automatic code for a price as a JSON:API list of 0 or 1 code, coupon included.
   */
  async findAutomaticForPriceDocument(params: {
    companyId: string;
    priceId: string;
    query: any;
  }): Promise<JsonApiListDocument> {
    const paginator = new JsonApiPaginator(params.query);
    const code = await this.findAutomaticForPrice({ companyId: params.companyId, priceId: params.priceId });

    return this.jsonApiService.buildList(StripeCouponCodeDescriptor.model, code ? [code] : [], paginator);
  }

  /**
   * Reads the promotion code and its coupon live from Stripe and tells whether either has run out.
   */
  async isExhausted(stripePromotionCodeId: string): Promise<boolean> {
    const promotionCode = await this.stripeCouponApiService.retrievePromotionCode(stripePromotionCodeId);

    if (!promotionCode.active) return true;
    if (this.limitReached(promotionCode.max_redemptions, promotionCode.times_redeemed)) return true;

    const coupon = await this.resolveCoupon(promotionCode);
    if (!coupon) return false;
    if (!coupon.valid) return true;

    return this.limitReached(coupon.max_redemptions, coupon.times_redeemed);
  }

  /**
   * Re-reads a promotion code and its coupon from Stripe and writes the counts to our nodes.
   * A no-op when the code is not one of ours; logs and never throws.
   */
  async refreshCountsByStripePromotionCodeId(stripePromotionCodeId: string): Promise<void> {
    try {
      const code = await this.stripeCouponCodeRepository.findByStripePromotionCodeId({ stripePromotionCodeId });
      if (!code) return;

      const promotionCode = await this.stripeCouponApiService.retrievePromotionCode(stripePromotionCodeId);

      await this.stripeCouponCodeRepository.patch({
        id: code.id,
        timesRedeemed: promotionCode.times_redeemed,
        active: promotionCode.active,
      });

      const coupon = await this.resolveCoupon(promotionCode);
      if (coupon && code.coupon?.id) {
        await this.stripeCouponRepository.patch({
          id: code.coupon.id,
          timesRedeemed: coupon.times_redeemed,
          valid: coupon.valid,
        });
      }
    } catch (error) {
      this.logger.error(`Failed to refresh coupon counts for promotion code ${stripePromotionCodeId}:`, error);
    }
  }

  /**
   * No places left: our copy says 0, or Stripe says so live. A failed live read counts as "has places".
   */
  private async hasNoPlacesLeft(code: StripeCouponCode): Promise<boolean> {
    if (code.coupon && placesLeft(code, code.coupon) === 0) return true;

    try {
      return await this.isExhausted(code.stripePromotionCodeId);
    } catch (error) {
      this.logger.error(`Failed to read live places for promotion code ${code.stripePromotionCodeId}:`, error);
      return false;
    }
  }

  private limitReached(maxRedemptions: number | null | undefined, timesRedeemed: number): boolean {
    return maxRedemptions !== null && maxRedemptions !== undefined && timesRedeemed >= maxRedemptions;
  }

  private async resolveCoupon(promotionCode: Stripe.PromotionCode): Promise<Stripe.Coupon | null> {
    const coupon = promotionCode.promotion?.coupon;
    if (!coupon) return null;
    if (typeof coupon === "string") return this.stripeCouponApiService.retrieveCoupon(coupon);
    return coupon;
  }
}
