import { Controller, Get, Query, Res } from "@nestjs/common";
import { FastifyReply } from "fastify";
import { CoreModuleId } from "../../../common/constants/core-module.ids";
import { ModuleACL } from "../../../common/decorators/module.decorator";
import { stripeCouponOfferMeta } from "../entities/stripe-coupon-offer.meta";
import { StripeCouponOfferService } from "../services/stripe-coupon-offer.service";

/**
 * Public coupon routes (no guard): the pricing page reads the places left on the automatic code.
 * The section only takes effect behind a session guard, so it never gates this unauthenticated read.
 */
@ModuleACL({ module: CoreModuleId.Billing })
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
