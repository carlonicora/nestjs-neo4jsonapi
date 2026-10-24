import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { ClsService } from "nestjs-cls";
import { JsonApiSingleDocument } from "../../../core/jsonapi/interfaces/jsonapi.document.interface";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AbstractService } from "../../../core/neo4j/abstracts/abstract.service";
import { StripeProductRepository } from "../../stripe-product/repositories/stripe-product.repository";
import { StripeCouponPatchDataDTO } from "../dtos/stripe-coupon.patch.dto";
import { StripeCouponPostAttributesDTO, StripeCouponPostDataDTO } from "../dtos/stripe-coupon.post.dto";
import { StripeCoupon, StripeCouponDescriptor } from "../entities/stripe-coupon";
import { StripeCouponCodeRepository } from "../repositories/stripe-coupon-code.repository";
import { StripeCouponRepository } from "../repositories/stripe-coupon.repository";
import { StripeCouponApiService } from "./stripe-coupon-api.service";
import { assertCouponCodeAttributes, couponCodeNodeParams, couponCodeStripeParams } from "./stripe-coupon-code.service";

/**
 * StripeCouponService
 *
 * Admin operations on coupons. A coupon is created in Stripe together with its
 * first customer-facing code, then both are mirrored as nodes. Stripe forbids
 * changing a coupon's discount, duration and limits, so the only edit is a
 * rename; counts are refreshed from Stripe on demand.
 */
@Injectable()
export class StripeCouponService extends AbstractService<StripeCoupon, typeof StripeCouponDescriptor.relationships> {
  protected readonly descriptor = StripeCouponDescriptor;
  private readonly logger = new Logger(StripeCouponService.name);

  constructor(
    jsonApiService: JsonApiService,
    private readonly stripeCouponRepository: StripeCouponRepository,
    clsService: ClsService,
    private readonly stripeCouponCodeRepository: StripeCouponCodeRepository,
    private readonly stripeCouponApiService: StripeCouponApiService,
    private readonly stripeProductRepository: StripeProductRepository,
  ) {
    super(jsonApiService, stripeCouponRepository, clsService, StripeCouponDescriptor.model);
  }

  /**
   * Creates the Stripe coupon, then its first promotion code, then both nodes.
   * When anything after the coupon fails, the Stripe coupon is deleted (which
   * also deactivates any code already made from it) and the error re-thrown.
   */
  async createWithFirstCode(params: { data: StripeCouponPostDataDTO }): Promise<JsonApiSingleDocument> {
    const attributes = params.data.attributes;
    const firstCode = attributes.firstCode;

    this.assertCouponAttributes(attributes);
    assertCouponCodeAttributes(firstCode);

    const stripeProductIds = await this.mapProductIds(attributes.productIds);

    const stripeCoupon = await this.stripeCouponApiService.createCoupon({
      id: attributes.stripeCouponId,
      name: attributes.name,
      percentOff: attributes.discountType === "percent_off" ? attributes.percentOff : undefined,
      amountOff: attributes.discountType === "amount_off" ? attributes.amountOff : undefined,
      currency: attributes.discountType === "amount_off" ? attributes.currency?.toLowerCase() : undefined,
      duration: attributes.duration,
      durationInMonths: attributes.duration === "repeating" ? attributes.durationInMonths : undefined,
      stripeProductIds,
      redeemBy: attributes.redeemBy ? new Date(attributes.redeemBy) : undefined,
      maxRedemptions: attributes.maxRedemptions,
    });

    const codeId = randomUUID();
    let couponNodeCreated = false;

    try {
      const promotionCode = await this.stripeCouponApiService.createPromotionCode(
        couponCodeStripeParams(stripeCoupon.id, firstCode),
      );

      await this.stripeCouponRepository.create({
        id: params.data.id,
        stripeCouponId: stripeCoupon.id,
        name: attributes.name,
        discountType: attributes.discountType,
        percentOff: attributes.discountType === "percent_off" ? attributes.percentOff : undefined,
        amountOff: attributes.discountType === "amount_off" ? attributes.amountOff : undefined,
        currency: attributes.discountType === "amount_off" ? attributes.currency?.toLowerCase() : undefined,
        duration: attributes.duration,
        durationInMonths: attributes.duration === "repeating" ? attributes.durationInMonths : undefined,
        stripeProductIds,
        redeemBy: attributes.redeemBy,
        maxRedemptions: attributes.maxRedemptions,
        timesRedeemed: stripeCoupon.times_redeemed ?? 0,
        valid: stripeCoupon.valid,
      });
      couponNodeCreated = true;

      await this.stripeCouponCodeRepository.create(
        couponCodeNodeParams({ id: codeId, couponId: params.data.id, attributes: firstCode, promotionCode }),
      );
    } catch (error) {
      await this.rollback({
        stripeCouponId: stripeCoupon.id,
        couponId: couponNodeCreated ? params.data.id : undefined,
      });
      throw error;
    }

    if (firstCode.automatic) await this.stripeCouponCodeRepository.setAutomatic({ id: codeId, automatic: true });

    return this.findById({ id: params.data.id });
  }

  /**
   * Renames the coupon in Stripe, then on the node. Nothing else is editable.
   */
  async rename(params: { data: StripeCouponPatchDataDTO }): Promise<JsonApiSingleDocument> {
    const coupon = await this.stripeCouponRepository.findById({ id: params.data.id });
    if (!coupon) throw new NotFoundException("Coupon not found");

    const name = params.data.attributes.name;
    if (name === undefined) return this.findById({ id: coupon.id });

    await this.stripeCouponApiService.renameCoupon({ stripeCouponId: coupon.stripeCouponId, name });

    return this.patch({ id: coupon.id, name });
  }

  /**
   * Re-reads the coupon and each of its codes from Stripe and writes the
   * redemption counts and status to the nodes.
   */
  async refreshCounts(params: { id: string }): Promise<JsonApiSingleDocument> {
    const coupon = await this.stripeCouponRepository.findById({ id: params.id });
    if (!coupon) throw new NotFoundException("Coupon not found");

    const stripeCoupon = await this.stripeCouponApiService.retrieveCoupon(coupon.stripeCouponId);
    await this.stripeCouponRepository.patch({
      id: coupon.id,
      timesRedeemed: stripeCoupon.times_redeemed ?? 0,
      valid: stripeCoupon.valid,
    });

    for (const code of coupon.codes ?? []) {
      const promotionCode = await this.stripeCouponApiService.retrievePromotionCode(code.stripePromotionCodeId);
      await this.stripeCouponCodeRepository.patch({
        id: code.id,
        timesRedeemed: promotionCode.times_redeemed ?? 0,
        active: promotionCode.active,
      });
    }

    return this.findById({ id: coupon.id });
  }

  private assertCouponAttributes(attributes: StripeCouponPostAttributesDTO): void {
    if (attributes.discountType === "percent_off") {
      if (attributes.percentOff === undefined) throw new BadRequestException("A percentage coupon needs percentOff");
      if (attributes.amountOff !== undefined || attributes.currency !== undefined)
        throw new BadRequestException("A percentage coupon cannot have amountOff or currency");
    } else {
      if (attributes.amountOff === undefined || !attributes.currency)
        throw new BadRequestException("A fixed-amount coupon needs amountOff and currency");
      if (attributes.percentOff !== undefined)
        throw new BadRequestException("A fixed-amount coupon cannot have percentOff");
    }

    if (attributes.duration === "repeating") {
      if (attributes.durationInMonths === undefined)
        throw new BadRequestException("A repeating coupon needs durationInMonths");
    } else if (attributes.durationInMonths !== undefined) {
      throw new BadRequestException("durationInMonths applies only to a repeating coupon");
    }
  }

  /**
   * Maps our StripeProduct ids to Stripe product ids. Unknown ids are rejected.
   */
  private async mapProductIds(productIds?: string[]): Promise<string[] | undefined> {
    if (!productIds?.length) return undefined;

    const stripeProductIds: string[] = [];
    for (const id of productIds) {
      const product = await this.stripeProductRepository.findById({ id });
      if (!product) throw new BadRequestException(`Product ${id} not found`);
      stripeProductIds.push(product.stripeProductId);
    }

    return stripeProductIds;
  }

  private async rollback(params: { stripeCouponId: string; couponId?: string }): Promise<void> {
    try {
      await this.stripeCouponApiService.deleteCoupon(params.stripeCouponId);
    } catch (error) {
      this.logger.error(`Could not delete Stripe coupon ${params.stripeCouponId} after a failed create`, error);
    }

    if (!params.couponId) return;

    try {
      await this.stripeCouponRepository.delete({ id: params.couponId });
    } catch (error) {
      this.logger.error(`Could not delete coupon node ${params.couponId} after a failed create`, error);
    }
  }
}
