import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { CoreModuleId } from "../../../common/constants/core-module.ids";
import { ModuleACL } from "../../../common/decorators/module.decorator";
import { ReferralVisitPostDTO } from "../dtos/referral-visit.post.dto";
import { referralVisitMeta } from "../entities/referral-visit.meta";
import { ReferralService } from "../services/referral.service";

/**
 * Public referral routes (no guard). Kept apart from ReferralController, which
 * carries a class-level JwtAuthGuard.
 *
 * No @CacheInvalidate: nothing cached reads ReferralVisit.
 */
@Controller()
@ModuleACL({ module: CoreModuleId.Referral })
export class ReferralPublicController {
  constructor(private readonly referralService: ReferralService) {}

  /**
   * POST /referrals/visits — records one visit to a referral link. Answers 204
   * for any body carrying a code string, whether or not the code is known or the
   * feature is enabled, so the answer leaks nothing about which codes exist.
   */
  @Post(referralVisitMeta.endpoint)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async recordVisit(@Body() body: ReferralVisitPostDTO): Promise<void> {
    await this.referralService.recordVisit({ referralCode: body.data.attributes.referralCode });
  }
}
