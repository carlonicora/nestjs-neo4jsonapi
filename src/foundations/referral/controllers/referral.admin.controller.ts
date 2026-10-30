import { Controller, Get, Query, Res, UseGuards } from "@nestjs/common";
import { FastifyReply } from "fastify";
import { CoreModuleId } from "../../../common/constants/core-module.ids";
import { SystemRoles } from "../../../common/constants/system.roles";
import { ModuleACL } from "../../../common/decorators/module.decorator";
import { Roles } from "../../../common/decorators/roles.decorator";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { referralAdminReferralMeta } from "../entities/referral-admin-referral.meta";
import { referralAdminReferrerMeta } from "../entities/referral-admin-referrer.meta";
import { referralAdminSummaryMeta } from "../entities/referral-admin-summary.meta";
import {
  REFERRAL_ADMIN_PERIODS,
  REFERRAL_ADMIN_SORTS,
  ReferralAdminPeriod,
  ReferralAdminSort,
} from "../repositories/referral.admin.repository";
import { ReferralAdminService } from "../services/referral.admin.service";

const DEFAULT_PERIOD: ReferralAdminPeriod = "30d";
const DEFAULT_SORT: ReferralAdminSort = "paying";

/**
 * Platform-wide referral report. Every route is administrator-only:
 * JwtAuthGuard._validateRoles enforces @Roles and always admits the
 * Administrator role.
 *
 * Not gated by the referral feature flag: the report reads data that exists
 * while the feature is off (referrals recorded directly); only the public visit
 * write is gated.
 *
 * `period` and `sort` are resolved against the repository's allowlists; an
 * unknown value falls back to the default instead of reaching the query.
 */
@UseGuards(JwtAuthGuard)
@ModuleACL({ module: CoreModuleId.Referral })
@Controller()
export class ReferralAdminController {
  constructor(private readonly service: ReferralAdminService) {}

  @Get(referralAdminSummaryMeta.endpoint)
  @Roles(SystemRoles.Administrator)
  async getSummary(@Res() reply: FastifyReply, @Query("period") period?: string) {
    reply.send(await this.service.getSummary({ period: this._period(period) }));
  }

  @Get(referralAdminReferrerMeta.endpoint)
  @Roles(SystemRoles.Administrator)
  async getReferrers(@Res() reply: FastifyReply, @Query("period") period?: string, @Query("sort") sort?: string) {
    reply.send(await this.service.getReferrers({ period: this._period(period), sort: this._sort(sort) }));
  }

  @Get(referralAdminReferralMeta.endpoint)
  @Roles(SystemRoles.Administrator)
  async getReferrals(@Res() reply: FastifyReply, @Query("period") period?: string) {
    reply.send(await this.service.getReferrals({ period: this._period(period) }));
  }

  private _period(value?: string): ReferralAdminPeriod {
    return value !== undefined && Object.prototype.hasOwnProperty.call(REFERRAL_ADMIN_PERIODS, value)
      ? (value as ReferralAdminPeriod)
      : DEFAULT_PERIOD;
  }

  private _sort(value?: string): ReferralAdminSort {
    return value !== undefined && Object.prototype.hasOwnProperty.call(REFERRAL_ADMIN_SORTS, value)
      ? (value as ReferralAdminSort)
      : DEFAULT_SORT;
  }
}
