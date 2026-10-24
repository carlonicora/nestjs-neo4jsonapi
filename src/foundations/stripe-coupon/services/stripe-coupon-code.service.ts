import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import Stripe from "stripe";
import { JsonApiSingleDocument } from "../../../core/jsonapi/interfaces/jsonapi.document.interface";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AbstractService } from "../../../core/neo4j/abstracts/abstract.service";
import { StripeCouponCodePatchDataDTO } from "../dtos/stripe-coupon-code.patch.dto";
import { StripeCouponCodePostAttributesDTO, StripeCouponCodePostDataDTO } from "../dtos/stripe-coupon-code.post.dto";
import { StripeCouponCode, StripeCouponCodeDescriptor } from "../entities/stripe-coupon-code";
import { StripeCouponCodeRepository } from "../repositories/stripe-coupon-code.repository";
import { StripeCouponRepository } from "../repositories/stripe-coupon.repository";
import { StripeCouponApiService } from "./stripe-coupon-api.service";

/**
 * Cross-field checks on a code's attributes, run before any Stripe call.
 */
export function assertCouponCodeAttributes(attributes: StripeCouponCodePostAttributesDTO): void {
  if (attributes.minimumAmount !== undefined && !attributes.minimumAmountCurrency)
    throw new BadRequestException("A minimum amount needs a currency");
  if (attributes.minimumAmount === undefined && attributes.minimumAmountCurrency)
    throw new BadRequestException("A minimum amount currency needs a minimum amount");
}

/**
 * The Stripe promotion code parameters for a code POST's attributes.
 */
export function couponCodeStripeParams(stripeCouponId: string, attributes: StripeCouponCodePostAttributesDTO) {
  return {
    stripeCouponId,
    code: attributes.code,
    firstTimeTransaction: attributes.firstTimeTransaction,
    minimumAmount: attributes.minimumAmount,
    minimumAmountCurrency: attributes.minimumAmountCurrency?.toLowerCase(),
    stripeCustomerId: attributes.stripeCustomerId,
    expiresAt: attributes.expiresAt ? new Date(attributes.expiresAt) : undefined,
    maxRedemptions: attributes.maxRedemptions,
  };
}

/**
 * The StripeCouponCode node parameters for a promotion code Stripe has just created.
 */
export function couponCodeNodeParams(params: {
  id: string;
  couponId: string;
  attributes: StripeCouponCodePostAttributesDTO;
  promotionCode: Stripe.PromotionCode;
}) {
  return {
    id: params.id,
    stripePromotionCodeId: params.promotionCode.id,
    code: params.promotionCode.code,
    active: params.promotionCode.active,
    automatic: params.attributes.automatic ?? false,
    firstTimeTransaction: params.attributes.firstTimeTransaction ?? false,
    minimumAmount: params.attributes.minimumAmount,
    minimumAmountCurrency: params.attributes.minimumAmountCurrency?.toLowerCase(),
    stripeCustomerId: params.attributes.stripeCustomerId,
    expiresAt: params.attributes.expiresAt,
    maxRedemptions: params.attributes.maxRedemptions,
    timesRedeemed: params.promotionCode.times_redeemed ?? 0,
    coupon: params.couponId,
  };
}

/**
 * StripeCouponCodeService
 *
 * Admin operations on the customer-facing codes of a coupon: add a code to an
 * existing coupon, switch "Apply automatically", deactivate / reactivate.
 * Every code is created in Stripe first, then mirrored as a node.
 */
@Injectable()
export class StripeCouponCodeService extends AbstractService<
  StripeCouponCode,
  typeof StripeCouponCodeDescriptor.relationships
> {
  protected readonly descriptor = StripeCouponCodeDescriptor;

  constructor(
    jsonApiService: JsonApiService,
    private readonly stripeCouponCodeRepository: StripeCouponCodeRepository,
    clsService: ClsService,
    private readonly stripeCouponRepository: StripeCouponRepository,
    private readonly stripeCouponApiService: StripeCouponApiService,
  ) {
    super(jsonApiService, stripeCouponCodeRepository, clsService, StripeCouponCodeDescriptor.model);
  }

  async createForCoupon(params: { data: StripeCouponCodePostDataDTO }): Promise<JsonApiSingleDocument> {
    const attributes = params.data.attributes;
    const couponId = params.data.relationships.coupon.data.id;

    assertCouponCodeAttributes(attributes);

    const coupon = await this.stripeCouponRepository.findById({ id: couponId });
    if (!coupon) throw new NotFoundException("Coupon not found");

    const promotionCode = await this.stripeCouponApiService.createPromotionCode(
      couponCodeStripeParams(coupon.stripeCouponId, attributes),
    );

    await this.stripeCouponCodeRepository.create(
      couponCodeNodeParams({ id: params.data.id, couponId, attributes, promotionCode }),
    );

    if (attributes.automatic)
      await this.stripeCouponCodeRepository.setAutomatic({ id: params.data.id, automatic: true });

    return this.findById({ id: params.data.id });
  }

  /**
   * Switches "active" (in Stripe, then on the node) and / or "Apply
   * automatically" (ours only: turning it on clears every other code).
   */
  async updateFlags(params: { data: StripeCouponCodePatchDataDTO }): Promise<JsonApiSingleDocument> {
    const attributes = params.data.attributes;

    const code = await this.stripeCouponCodeRepository.findById({ id: params.data.id });
    if (!code) throw new NotFoundException("Code not found");

    if (attributes.active !== undefined) {
      await this.stripeCouponApiService.setPromotionCodeActive({
        stripePromotionCodeId: code.stripePromotionCodeId,
        active: attributes.active,
      });
      await this.stripeCouponCodeRepository.patch({ id: code.id, active: attributes.active });
    }

    if (attributes.automatic !== undefined)
      await this.stripeCouponCodeRepository.setAutomatic({ id: code.id, automatic: attributes.automatic });

    return this.findById({ id: code.id });
  }

  /**
   * The id of the coupon a code belongs to, so callers can refresh the
   * coupon's cached entry after a change to one of its codes.
   */
  async findCouponId(params: { codeId: string }): Promise<string | undefined> {
    const code = await this.stripeCouponCodeRepository.findById({ id: params.codeId });
    return code?.coupon?.id;
  }
}
