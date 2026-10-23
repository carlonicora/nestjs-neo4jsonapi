import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../../common";
import { ValidatePromotionCodeDTO } from "../dtos/stripe-promotion-code.dto";
import {
  PromotionCodeValidationResult,
  StripePromotionCodeApiService,
} from "../services/stripe-promotion-code-api.service";
import { ModuleACL } from "../../../common/decorators/module.decorator";
import { CoreModuleId } from "../../../common/constants/core-module.ids";

@ModuleACL({ module: CoreModuleId.Billing })
@Controller("stripe-promotion-codes")
@UseGuards(JwtAuthGuard)
export class StripePromotionCodeController {
  constructor(private readonly promotionCodeService: StripePromotionCodeApiService) {}

  @ModuleACL({ module: CoreModuleId.Billing, action: "read" })
  @Post("validate")
  async validatePromotionCode(@Body() dto: ValidatePromotionCodeDTO): Promise<PromotionCodeValidationResult> {
    return this.promotionCodeService.validatePromotionCode({
      code: dto.data.attributes.code,
      stripePriceId: dto.data.attributes.stripePriceId,
    });
  }
}
