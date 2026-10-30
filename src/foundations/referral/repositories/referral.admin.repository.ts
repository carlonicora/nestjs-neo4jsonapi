// nja-lint-ignore-file: cross-tenant administrative read repository.
//
// Every query here deliberately omits buildDefaultMatch(): that helper scopes to
// the CALLER's company via CLS, which is exactly wrong for a platform-wide
// referral report that reads every company's invites, visits and referrals at
// once. Access is gated instead by the controller's JwtAuthGuard +
// @Roles(Administrator) (see referral.admin.controller.ts). The RETURNs are
// scalar columns (counts, sums, owner names), not graph nodes, so
// readOne()/readMany() cannot map them: entityFactory.createGraphList expects
// nodes. Same shape and same rationale as
// foundations/analytics/repositories/analytics.admin.repository.ts.
//
// For the same reason it also does NOT call Neo4jService.initQuery(): that
// helper prepends its own CLS-scoped company MATCH whenever the caller's CLS
// carries a companyId, and a platform administrator who also owns a company
// does. That would reduce every count to the administrator's own company.
// Every query here seeds itself from _adminQuery() instead. No query here binds
// a parameter named companyId.
//
// The architecture gate raises a FILE-LEVEL manual-query-no-company-scope finding
// on this shape; per-line ignores do not clear it, so this header note is the
// documented resolution.
import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { convertFieldValue } from "../../../common/helpers/define-entity";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { companyMeta } from "../../company/entities/company.meta";
import { userMeta } from "../../user/entities/user.meta";
import { Referral, ReferralDescriptor } from "../entities/referral";
import { ReferralAdminReferralDescriptor, ReferralAdminReferralEntity } from "../entities/referral-admin-referral";
import { ReferralAdminReferrerDescriptor, ReferralAdminReferrerEntity } from "../entities/referral-admin-referrer";
import { ReferralAdminSummaryEntity } from "../entities/referral-admin-summary";
import { referralInviteMeta } from "../entities/referral-invite.meta";
import { REFERRAL_SOURCE } from "../entities/referral-source";
import { referralVisitMeta } from "../entities/referral-visit.meta";
import { referralMeta } from "../entities/referral.meta";

/** The periods the admin endpoints accept, in days back from now (`all` has no start). */
export const REFERRAL_ADMIN_PERIODS = { "30d": 30, "90d": 90, all: null } as const;
export type ReferralAdminPeriod = keyof typeof REFERRAL_ADMIN_PERIODS;

/**
 * The ORDER BY clauses the referrers list may emit, keyed by the sort it accepts.
 * A lookup rather than an interpolation of the caller's string: nothing that did
 * not come from this table can ever reach the query text.
 */
export const REFERRAL_ADMIN_SORTS = {
  paying: "paying DESC, signups DESC",
  signups: "signups DESC, paying DESC",
  invites: "invitesSent DESC, paying DESC",
  conversion: "conversion DESC, paying DESC",
  credits: "creditsEarned DESC, paying DESC",
} as const;
export type ReferralAdminSort = keyof typeof REFERRAL_ADMIN_SORTS;

type ReferralAdminWindow = "current" | "previous";
type AdminQuery = { query: string; queryParams: Record<string, unknown> };

const COMPANY = companyMeta.labelName;
const USER = userMeta.labelName;
const REFERRAL = referralMeta.labelName;
const INVITE = referralInviteMeta.labelName;
const VISIT = referralVisitMeta.labelName;

/** Driver Integers arrive as { toNumber() }. */
const int = (value: any): number => (value?.toNumber ? value.toNumber() : Number(value ?? 0) || 0);

/**
 * Platform-wide reads behind /referrals/administration/*. The Referral
 * descriptor is only there to satisfy the base class; nothing here goes through
 * the inherited CRUD.
 *
 * Counting rules:
 * - every window is [from, to): an inclusive start, so a record created exactly
 *   at the period start counts; `from = null` ("all") has no start;
 * - visits and invites count by their createdAt; sign-ups are Referrals created
 *   in the window (both sources); paying are Referrals with status completed
 *   and completedAt in the window; credits given are twice the sum of their
 *   tokensAwarded (both sides are rewarded);
 * - companies with a user in $excludeUserIds (platform administrators) are left
 *   out on both sides; demo companies (isDemo) are left out on the referred side.
 */
@Injectable()
export class ReferralAdminRepository extends AbstractRepository<Referral, typeof ReferralDescriptor.relationships> {
  protected readonly descriptor = ReferralDescriptor;

  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  /**
   * One row per window: "current" = [from, to), plus "previous" =
   * [previousFrom, from) when previousFrom is not null.
   */
  async findSummary(params: {
    from: string | null;
    previousFrom: string | null;
    to: string;
    excludeUserIds: string[];
  }): Promise<ReferralAdminSummaryEntity[]> {
    const windows: Array<Promise<ReferralAdminSummaryEntity>> = [
      this._summaryWindow({
        window: "current",
        from: params.from,
        to: params.to,
        excludeUserIds: params.excludeUserIds,
      }),
    ];

    if (params.previousFrom !== null && params.from !== null)
      windows.push(
        this._summaryWindow({
          window: "previous",
          from: params.previousFrom,
          to: params.from,
          excludeUserIds: params.excludeUserIds,
        }),
      );

    return Promise.all(windows);
  }

  /**
   * One row per referrer company with at least one visit, invite or referral in
   * the period, so a company with only visits still appears with zeros
   * elsewhere. lastInviteAt is the company's most recent invite, in or before
   * the period.
   */
  async findReferrers(params: {
    from: string | null;
    sort: ReferralAdminSort;
    excludeUserIds: string[];
  }): Promise<ReferralAdminReferrerEntity[]> {
    const orderBy = Object.prototype.hasOwnProperty.call(REFERRAL_ADMIN_SORTS, params.sort)
      ? REFERRAL_ADMIN_SORTS[params.sort]
      : REFERRAL_ADMIN_SORTS.paying;
    const seed = this._adminQuery({
      from: params.from,
      to: new Date().toISOString(),
      excludeUserIds: params.excludeUserIds,
    });

    seed.query = `
      CALL {
        MATCH (active_visit:${VISIT})-[:VISITED]->(active_company:${COMPANY})
        WHERE ${this._inWindow("active_visit.createdAt")}
        RETURN active_company
        UNION
        MATCH (active_invite:${INVITE})-[:SENT_BY]->(active_company:${COMPANY})
        WHERE ${this._inWindow("active_invite.createdAt")}
        RETURN active_company
        UNION
        MATCH (active_referral:${REFERRAL})-[:REFERRED_BY]->(active_company:${COMPANY})
        MATCH (active_referral)-[:REFERS_TO]->(active_referred:${COMPANY})
        WHERE ${this._inWindow("active_referral.createdAt")}
          AND ${this._referredAllowed("active_referred")}
        RETURN active_company
      }
      WITH DISTINCT active_company AS referrer
      WHERE ${this._notAdministrators("referrer")}
      CALL {
        WITH referrer
        OPTIONAL MATCH (referrer_member:${USER})-[:BELONGS_TO]->(referrer)
        WITH referrer_member
        ORDER BY referrer_member.createdAt ASC
        RETURN head(collect(referrer_member)) AS referrer_owner
      }
      CALL {
        WITH referrer
        OPTIONAL MATCH (referrer_visit:${VISIT})-[:VISITED]->(referrer)
        WHERE ${this._inWindow("referrer_visit.createdAt")}
        RETURN count(referrer_visit) AS visits
      }
      CALL {
        WITH referrer
        OPTIONAL MATCH (referrer_invite:${INVITE})-[:SENT_BY]->(referrer)
        WHERE referrer_invite.createdAt < datetime($to)
        RETURN count(CASE WHEN ${this._inWindow("referrer_invite.createdAt")} THEN 1 END) AS invitesSent,
               max(referrer_invite.createdAt) AS lastInviteAt
      }
      CALL {
        WITH referrer
        OPTIONAL MATCH (referrer)<-[:REFERRED_BY]-(signup:${REFERRAL})-[:REFERS_TO]->(signup_referred:${COMPANY})
        WHERE ${this._inWindow("signup.createdAt")}
          AND ${this._referredAllowed("signup_referred")}
        RETURN count(CASE WHEN signup.source = $linkSource THEN 1 END) AS signupsLink,
               count(CASE WHEN signup.source = $directSource THEN 1 END) AS signupsDirect
      }
      CALL {
        WITH referrer
        OPTIONAL MATCH (referrer)<-[:REFERRED_BY]-(completed:${REFERRAL})-[:REFERS_TO]->(completed_referred:${COMPANY})
        WHERE completed.status = 'completed'
          AND ${this._inWindow("completed.completedAt")}
          AND ${this._referredAllowed("completed_referred")}
        RETURN count(completed) AS paying,
               sum(coalesce(completed.tokensAwarded, 0)) AS creditsEarned
      }
      WITH referrer, referrer_owner, visits, invitesSent, lastInviteAt, signupsLink, signupsDirect, paying, creditsEarned,
           signupsLink + signupsDirect AS signups,
           CASE WHEN invitesSent = 0 THEN 0.0 ELSE toFloat(paying) / invitesSent END AS conversion
      ORDER BY ${orderBy}, referrer.id ASC
      RETURN referrer.id                          AS id,
             coalesce(referrer_owner.name, '')    AS name,
             coalesce(referrer_owner.email, '')   AS email,
             visits                               AS visits,
             invitesSent                          AS invitesSent,
             signupsLink                          AS signupsLink,
             signupsDirect                        AS signupsDirect,
             paying                               AS paying,
             creditsEarned                        AS creditsEarned,
             lastInviteAt                         AS lastInviteAt
    `;

    const result = await this.neo4j.read(seed.query, seed.queryParams);

    // The driver hands back a native Neo4j DateTime. convertFieldValue is the
    // framework's single read-path conversion, the one the generated mapper
    // uses; the type is read off the descriptor so the two never drift.
    const lastInviteType = ReferralAdminReferrerDescriptor.fields.lastInviteAt?.type ?? "datetime";

    return (result.records as any[]).map((r) => {
      const lastInviteAt = r.get("lastInviteAt");
      return {
        id: String(r.get("id")),
        name: r.get("name") ?? "",
        email: r.get("email") ?? "",
        visits: int(r.get("visits")),
        invitesSent: int(r.get("invitesSent")),
        signupsLink: int(r.get("signupsLink")),
        signupsDirect: int(r.get("signupsDirect")),
        paying: int(r.get("paying")),
        creditsEarned: int(r.get("creditsEarned")),
        lastInviteAt: lastInviteAt == null ? undefined : (convertFieldValue(lastInviteAt, lastInviteType) as Date),
      };
    }) as ReferralAdminReferrerEntity[];
  }

  /**
   * Every Referral created in the period, newest first, unpaginated (like the
   * library's other cross-tenant admin lists). Owners are each company's
   * earliest-created user. A Referral written before sources existed has an
   * unknown source and comes back as an empty string.
   */
  async findReferrals(params: {
    from: string | null;
    excludeUserIds: string[];
  }): Promise<ReferralAdminReferralEntity[]> {
    const seed = this._adminQuery({
      from: params.from,
      to: new Date().toISOString(),
      excludeUserIds: params.excludeUserIds,
    });

    seed.query = `
      MATCH (referral:${REFERRAL})-[:REFERS_TO]->(referral_referred:${COMPANY})
      MATCH (referral)-[:REFERRED_BY]->(referral_referrer:${COMPANY})
      WHERE ${this._inWindow("referral.createdAt")}
        AND ${this._referredAllowed("referral_referred")}
        AND ${this._notAdministrators("referral_referrer")}
      CALL {
        WITH referral_referred
        OPTIONAL MATCH (referred_member:${USER})-[:BELONGS_TO]->(referral_referred)
        WITH referred_member
        ORDER BY referred_member.createdAt ASC
        RETURN head(collect(referred_member)) AS referred_owner
      }
      CALL {
        WITH referral_referrer
        OPTIONAL MATCH (referrer_member:${USER})-[:BELONGS_TO]->(referral_referrer)
        WITH referrer_member
        ORDER BY referrer_member.createdAt ASC
        RETURN head(collect(referrer_member)) AS referrer_owner
      }
      RETURN referral.id                              AS id,
             coalesce(referred_owner.name, '')        AS name,
             coalesce(referred_owner.email, '')       AS email,
             coalesce(referrer_owner.name, '')        AS referrerName,
             coalesce(referrer_owner.email, '')       AS referrerEmail,
             coalesce(referral.source, '')            AS source,
             referral.status                          AS status,
             referral.createdAt                       AS referredAt,
             referral.completedAt                     AS completedAt,
             referral.tokensAwarded                   AS tokensAwarded
      ORDER BY referral.createdAt DESC
    `;

    const result = await this.neo4j.read(seed.query, seed.queryParams);

    // Same read-path conversion as findReferrers: the types come off the descriptor.
    const referredAtType = ReferralAdminReferralDescriptor.fields.referredAt?.type ?? "datetime";
    const completedAtType = ReferralAdminReferralDescriptor.fields.completedAt?.type ?? "datetime";

    return (result.records as any[]).map((r) => {
      const completedAt = r.get("completedAt");
      const tokensAwarded = r.get("tokensAwarded");
      return {
        id: String(r.get("id")),
        name: r.get("name") ?? "",
        email: r.get("email") ?? "",
        referrerName: r.get("referrerName") ?? "",
        referrerEmail: r.get("referrerEmail") ?? "",
        source: r.get("source") ?? "",
        status: r.get("status") ?? "",
        referredAt: convertFieldValue(r.get("referredAt"), referredAtType) as Date,
        completedAt: completedAt == null ? undefined : (convertFieldValue(completedAt, completedAtType) as Date),
        tokensAwarded: tokensAwarded == null ? undefined : int(tokensAwarded),
      };
    }) as ReferralAdminReferralEntity[];
  }

  /** One window of the summary, [from, to). */
  private async _summaryWindow(params: {
    window: ReferralAdminWindow;
    from: string | null;
    to: string;
    excludeUserIds: string[];
  }): Promise<ReferralAdminSummaryEntity> {
    const seed = this._adminQuery({ from: params.from, to: params.to, excludeUserIds: params.excludeUserIds });

    seed.query = `
      CALL {
        OPTIONAL MATCH (summary_visit:${VISIT})-[:VISITED]->(summary_visit_company:${COMPANY})
        WHERE ${this._inWindow("summary_visit.createdAt")}
          AND ${this._notAdministrators("summary_visit_company")}
        RETURN count(summary_visit) AS visits,
               collect(DISTINCT summary_visit_company.id) AS visitCompanyIds
      }
      CALL {
        OPTIONAL MATCH (summary_invite:${INVITE})-[:SENT_BY]->(summary_invite_company:${COMPANY})
        WHERE ${this._inWindow("summary_invite.createdAt")}
          AND ${this._notAdministrators("summary_invite_company")}
        RETURN count(summary_invite) AS invitesSent,
               collect(DISTINCT summary_invite_company.id) AS inviteCompanyIds
      }
      CALL {
        OPTIONAL MATCH (summary_signup_referrer:${COMPANY})<-[:REFERRED_BY]-(summary_signup:${REFERRAL})-[:REFERS_TO]->(summary_signup_referred:${COMPANY})
        WHERE ${this._inWindow("summary_signup.createdAt")}
          AND ${this._notAdministrators("summary_signup_referrer")}
          AND ${this._referredAllowed("summary_signup_referred")}
        RETURN count(summary_signup) AS signups
      }
      CALL {
        OPTIONAL MATCH (summary_paid_referrer:${COMPANY})<-[:REFERRED_BY]-(summary_paid:${REFERRAL})-[:REFERS_TO]->(summary_paid_referred:${COMPANY})
        WHERE summary_paid.status = 'completed'
          AND ${this._inWindow("summary_paid.completedAt")}
          AND ${this._notAdministrators("summary_paid_referrer")}
          AND ${this._referredAllowed("summary_paid_referred")}
        RETURN count(summary_paid) AS paying,
               2 * sum(coalesce(summary_paid.tokensAwarded, 0)) AS creditsGiven
      }
      CALL {
        OPTIONAL MATCH (summary_eligible:${COMPANY})
        WHERE summary_eligible.isActiveSubscription = true
          AND ${this._notAdministrators("summary_eligible")}
        RETURN count(summary_eligible) AS eligibleCompanies
      }
      RETURN visits, invitesSent, signups, paying, creditsGiven, eligibleCompanies,
             size(inviteCompanyIds) + size([visitCompanyId IN visitCompanyIds WHERE NOT visitCompanyId IN inviteCompanyIds]) AS sharingCompanies
    `;

    const result = await this.neo4j.read(seed.query, seed.queryParams);
    const r = (result.records as any[])[0];

    return {
      id: params.window,
      window: params.window,
      visits: int(r?.get("visits")),
      invitesSent: int(r?.get("invitesSent")),
      signups: int(r?.get("signups")),
      paying: int(r?.get("paying")),
      creditsGiven: int(r?.get("creditsGiven")),
      sharingCompanies: int(r?.get("sharingCompanies")),
      eligibleCompanies: int(r?.get("eligibleCompanies")),
    } as ReferralAdminSummaryEntity;
  }

  /** [from, to) on a datetime property; `$from = null` means no start. */
  private _inWindow(property: string): string {
    return `($from IS NULL OR ${property} >= datetime($from)) AND ${property} < datetime($to)`;
  }

  /** The company has no user among $excludeUserIds (platform administrators). */
  private _notAdministrators(company: string): string {
    return `NOT EXISTS {
          MATCH (${company}_admin:${USER})-[:BELONGS_TO]->(${company})
          WHERE ${company}_admin.id IN $excludeUserIds
        }`;
  }

  /** A referred company counts unless it is a demo account or an administrator's. */
  private _referredAllowed(company: string): string {
    return `coalesce(${company}.isDemo, false) = false
          AND ${this._notAdministrators(company)}`;
  }

  /**
   * The seed every query starts from, in place of initQuery(). It binds only the
   * report's parameters, never the caller's companyId; the source values come
   * from REFERRAL_SOURCE.
   */
  private _adminQuery(params: { from: string | null; to: string; excludeUserIds: string[] }): AdminQuery {
    return {
      query: "",
      queryParams: {
        from: params.from,
        to: params.to,
        excludeUserIds: params.excludeUserIds,
        linkSource: REFERRAL_SOURCE.link,
        directSource: REFERRAL_SOURCE.direct,
      },
    };
  }
}
