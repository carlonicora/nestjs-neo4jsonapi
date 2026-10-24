import { Controller, Get, Query, Res } from "@nestjs/common";
import { FastifyReply } from "fastify";
import { stripeCouponOfferMeta } from "../entities/stripe-coupon-offer.meta";
import { StripeCouponOfferService } from "../services/stripe-coupon-offer.service";

/**
 * Public coupon routes (no guard): the pricing page reads the places left on the automatic code.
 */
@Controller()
export class StripeCouponPublicController {
  constructor(private readonly stripeCouponOfferService: StripeCouponOfferService) {}

  // GET /stripe-coupon-offers
  @Get(stripeCouponOfferMeta.endpoint)
  async findOffers(@Res() reply: FastifyReply, @Query() query: any) {
    const response = await this.stripeCouponOfferService.findPublicOffers({ query });
    reply.send(response);
  }
}
