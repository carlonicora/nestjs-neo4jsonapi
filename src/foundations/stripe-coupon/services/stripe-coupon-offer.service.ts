import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { JsonApiListDocument } from "../../../core/jsonapi/interfaces/jsonapi.document.interface";
import { JsonApiPaginator } from "../../../core/jsonapi/serialisers/jsonapi.paginator";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AbstractService } from "../../../core/neo4j/abstracts/abstract.service";
import { StripeCouponCode, StripeCouponCodeDescriptor } from "../entities/stripe-coupon-code";
import { StripeCouponOffer, StripeCouponOfferDescriptor } from "../entities/stripe-coupon-offer";
import { StripeCouponCodeRepository } from "../repositories/stripe-coupon-code.repository";
import { placesLeft, placesTotal } from "../utils/places-left";

/**
 * The public offer: places left on the automatic code, as a synthetic `stripe-coupon-offers`
 * list of 0 or 1 offer. Reads our copy only, never Stripe.
 */
@Injectable()
export class StripeCouponOfferService extends AbstractService<
  StripeCouponCode,
  typeof StripeCouponCodeDescriptor.relationships
> {
  protected readonly descriptor = StripeCouponCodeDescriptor;

  constructor(
    jsonApiService: JsonApiService,
    private readonly stripeCouponCodeRepository: StripeCouponCodeRepository,
    clsService: ClsService,
  ) {
    super(jsonApiService, stripeCouponCodeRepository, clsService, StripeCouponCodeDescriptor.model);
  }

  async findPublicOffers(params: { query: any }): Promise<JsonApiListDocument> {
    const paginator = new JsonApiPaginator(params.query);
    const offer = await this.buildOffer();

    return this.jsonApiService.buildList(StripeCouponOfferDescriptor.model, offer ? [offer] : [], paginator);
  }

  private async buildOffer(): Promise<StripeCouponOffer | null> {
    const code = await this.stripeCouponCodeRepository.findAutomatic();
    if (!code || !code.active || !code.automatic) return null;

    const coupon = code.coupon;
    if (!coupon || !coupon.valid) return null;

    const now = Date.now();
    if (coupon.redeemBy && new Date(coupon.redeemBy).getTime() <= now) return null;
    if (code.expiresAt && new Date(code.expiresAt).getTime() <= now) return null;

    const left = placesLeft(code, coupon);
    const total = placesTotal(code, coupon);
    if (left === null || total === null || left <= 0) return null;

    return {
      id: code.id,
      discountType: coupon.discountType,
      percentOff: coupon.percentOff,
      amountOff: coupon.amountOff,
      currency: coupon.currency,
      duration: coupon.duration,
      durationInMonths: coupon.durationInMonths,
      placesLeft: left,
      placesTotal: total,
    } as StripeCouponOffer;
  }
}
