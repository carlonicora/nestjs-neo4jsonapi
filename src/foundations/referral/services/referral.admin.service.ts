import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { JsonApiListDocument } from "../../../core/jsonapi/interfaces/jsonapi.document.interface";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AbstractService } from "../../../core/neo4j/abstracts/abstract.service";
import { UserRepository } from "../../user/repositories/user.repository";
import { Referral, ReferralDescriptor } from "../entities/referral";
import { ReferralAdminReferralDescriptor } from "../entities/referral-admin-referral";
import { ReferralAdminReferrerDescriptor } from "../entities/referral-admin-referrer";
import { ReferralAdminSummaryDescriptor } from "../entities/referral-admin-summary";
import {
  REFERRAL_ADMIN_PERIODS,
  ReferralAdminPeriod,
  ReferralAdminRepository,
  ReferralAdminSort,
} from "../repositories/referral.admin.repository";
import { ReferralRepository } from "../repositories/referral.repository";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Serialises the platform-wide referral report as JSON:API documents.
 *
 * Extends AbstractService over the Referral descriptor and its repository,
 * mirroring AnalyticsAdminService: the inherited CRUD is not reachable from any
 * route on ReferralAdminController, but keeps the base class coherent. Summary,
 * referrers and referrals serialise with their synthetic descriptors' models,
 * because their rows are aggregates, not nodes.
 *
 * Platform administrators' companies are excluded from every number.
 */
@Injectable()
export class ReferralAdminService extends AbstractService<Referral, typeof ReferralDescriptor.relationships> {
  protected readonly descriptor = ReferralDescriptor;

  constructor(
    jsonApiService: JsonApiService,
    referralRepository: ReferralRepository,
    clsService: ClsService,
    private readonly referralAdminRepository: ReferralAdminRepository,
    private readonly userRepository: UserRepository,
  ) {
    super(jsonApiService, referralRepository, clsService, ReferralDescriptor.model);
  }

  async getSummary(params: { period: ReferralAdminPeriod }): Promise<JsonApiListDocument> {
    const now = new Date();
    const days = REFERRAL_ADMIN_PERIODS[params.period];
    const excludeUserIds = await this._excludeUserIds();

    const rows = await this.referralAdminRepository.findSummary({
      from: days === null ? null : this._daysBefore(now, days),
      previousFrom: days === null ? null : this._daysBefore(now, 2 * days),
      to: now.toISOString(),
      excludeUserIds,
    });

    return this.jsonApiService.buildList(ReferralAdminSummaryDescriptor.model, rows);
  }

  async getReferrers(params: { period: ReferralAdminPeriod; sort: ReferralAdminSort }): Promise<JsonApiListDocument> {
    const excludeUserIds = await this._excludeUserIds();

    const rows = await this.referralAdminRepository.findReferrers({
      from: this._from(params.period),
      sort: params.sort,
      excludeUserIds,
    });

    return this.jsonApiService.buildList(ReferralAdminReferrerDescriptor.model, rows);
  }

  async getReferrals(params: { period: ReferralAdminPeriod }): Promise<JsonApiListDocument> {
    const excludeUserIds = await this._excludeUserIds();

    const rows = await this.referralAdminRepository.findReferrals({
      from: this._from(params.period),
      excludeUserIds,
    });

    return this.jsonApiService.buildList(ReferralAdminReferralDescriptor.model, rows);
  }

  /** The period's start as an ISO datetime, or null for "all". */
  private _from(period: ReferralAdminPeriod): string | null {
    const days = REFERRAL_ADMIN_PERIODS[period];
    return days === null ? null : this._daysBefore(new Date(), days);
  }

  private _daysBefore(now: Date, days: number): string {
    return new Date(now.getTime() - days * ONE_DAY_MS).toISOString();
  }

  private async _excludeUserIds(): Promise<string[]> {
    const admins = await this.userRepository.findPlatformAdministrators();
    return admins.map((admin) => admin.id);
  }
}
