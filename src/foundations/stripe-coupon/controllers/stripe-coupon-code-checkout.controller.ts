import { BadRequestException, Controller, Get, Query, Req, Res, UseGuards } from "@nestjs/common";
import { FastifyReply } from "fastify";
import { JwtAuthGuard, RoleId, Roles } from "../../../common";
import { CoreModuleId } from "../../../common/constants/core-module.ids";
import { ModuleACL } from "../../../common/decorators/module.decorator";
import { AuthenticatedRequest } from "../../../common/interfaces/authenticated.request.interface";
import { STRIPE_COUPON_CODE_AUTOMATIC_SEGMENT, stripeCouponCodeMeta } from "../entities/stripe-coupon-code.meta";
import { StripeCouponCodeCheckoutService } from "../services/stripe-coupon-code-checkout.service";

/**
 * Checkout-side coupon code routes for a logged-in company administrator. Kept apart from the
 * admin controller and registered first, so the literal `automatic` segment never collides
 * with `stripe-coupon-codes/:codeId`.
 */
@ModuleACL({ module: CoreModuleId.Billing })
@Controller()
export class StripeCouponCodeCheckoutController {
  constructor(private readonly stripeCouponCodeCheckoutService: StripeCouponCodeCheckoutService) {}

  // GET /stripe-coupon-codes/automatic?priceId=
  @Get(`${stripeCouponCodeMeta.endpoint}/${STRIPE_COUPON_CODE_AUTOMATIC_SEGMENT}`)
  @UseGuards(JwtAuthGuard)
  @Roles(RoleId.CompanyAdministrator)
  @ModuleACL({ module: CoreModuleId.Billing, action: "read" })
  async findAutomatic(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Query() query: any,
    @Query("priceId") priceId?: string,
  ) {
    if (!priceId) throw new BadRequestException("priceId is required");

    const response = await this.stripeCouponCodeCheckoutService.findAutomaticForPriceDocument({
      companyId: req.user.companyId,
      priceId,
      query,
    });

    reply.send(response);
  }
}
