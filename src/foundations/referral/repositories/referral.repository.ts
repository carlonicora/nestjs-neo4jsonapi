import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import type { Company } from "../../company/entities/company";
import { companyMeta } from "../../company/entities/company.meta";
import { userMeta } from "../../user/entities/user.meta";
import { Referral, ReferralDescriptor } from "../entities/referral";
import { ReferralInviteDescriptor } from "../entities/referral-invite";
import { referralInviteMeta } from "../entities/referral-invite.meta";
import type { ReferralSource } from "../entities/referral-source";
import { ReferralVisitDescriptor } from "../entities/referral-visit";
import { referralVisitMeta } from "../entities/referral-visit.meta";
import { referralMeta } from "../entities/referral.meta";

@Injectable()
export class ReferralRepository extends AbstractRepository<Referral, typeof ReferralDescriptor.relationships> {
  protected readonly descriptor = ReferralDescriptor;

  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  /**
   * Override return statement to include referrer and referred company relationships
   */
  protected buildReturnStatement(): string {
    return `
      MATCH (${referralMeta.nodeName})-[:REFERRED_BY]->(${referralMeta.nodeName}_referrer:${companyMeta.labelName})
      MATCH (${referralMeta.nodeName})-[:REFERS_TO]->(${referralMeta.nodeName}_referred:${companyMeta.labelName})
      RETURN ${referralMeta.nodeName},
        ${referralMeta.nodeName}_referrer,
        ${referralMeta.nodeName}_referred
    `;
  }

  /**
   * Create a new referral with REFERRED_BY and REFERS_TO relationships.
   *
   * Company check: the referred company (the caller's own) goes through
   * validateRelatedNodes. The REFERRED_BY link to the referrer company skips that
   * check, because a link to another company is the point of the record.
   * Owner-approved exception (Carlo, 2026-10-30, D18), the same scope as the
   * 2026-10-26 exception on createReferralIfAbsent.
   * @param params.id - The referral ID
   * @param params.referrerCompanyId - The company that made the referral
   * @param params.referredCompanyId - The company that was referred
   * @param params.source - How the referral came about (link or direct)
   * @returns true if the referral was created, false if one or both companies don't exist
   */
  async createReferral(params: {
    id: string;
    referrerCompanyId: string;
    referredCompanyId: string;
    source: ReferralSource;
  }): Promise<boolean> {
    await this.neo4j.validateRelatedNodes({
      nodes: [{ id: params.referredCompanyId, label: companyMeta.labelName }],
    });

    const results = await this.neo4j.executeInTransaction([
      {
        query: `
          MATCH (referrer:${companyMeta.labelName} {id: $referrerCompanyId})
          MATCH (referred:${companyMeta.labelName} {id: $referredCompanyId})
          CREATE (${referralMeta.nodeName}:${referralMeta.labelName} {
            id: $id,
            status: $status,
            source: $source,
            createdAt: datetime(),
            updatedAt: datetime()
          })
          CREATE (${referralMeta.nodeName})-[:REFERRED_BY]->(referrer)
          CREATE (${referralMeta.nodeName})-[:REFERS_TO]->(referred)
          RETURN ${referralMeta.nodeName}.id AS referralId
        `,
        params: {
          id: params.id,
          referrerCompanyId: params.referrerCompanyId,
          referredCompanyId: params.referredCompanyId,
          status: "pending",
          source: params.source,
        },
      },
    ]);

    // If MATCH failed (companies don't exist), no records are returned
    return results[0]?.records?.length > 0;
  }

  /**
   * Create a pending referral unless the referred company already has one.
   *
   * A referral is written once per referred company and never changed. Both ids
   * must be server-derived, never taken from a request.
   *
   * Company check: the referred company (the caller's own) goes through
   * validateRelatedNodes. The REFERRED_BY link to the referrer company skips that
   * check, because a link to another company is the point of the record.
   * Owner-approved exception (Carlo, 2026-10-26, plan audit round 3 B1), scoped to
   * this one link in this one method.
   * @param params.id - The referral ID
   * @param params.referrerCompanyId - The company that made the referral
   * @param params.referredCompanyId - The company that was referred
   * @param params.source - How the referral came about (link or direct)
   */
  async createReferralIfAbsent(params: {
    id: string;
    referrerCompanyId: string;
    referredCompanyId: string;
    source: ReferralSource;
  }): Promise<void> {
    await this.neo4j.validateRelatedNodes({
      nodes: [{ id: params.referredCompanyId, label: companyMeta.labelName }],
    });

    const query = this.neo4j.initQuery({ serialiser: ReferralDescriptor.model });

    query.queryParams = {
      ...query.queryParams,
      id: params.id,
      referrerCompanyId: params.referrerCompanyId,
      referredCompanyId: params.referredCompanyId,
      status: "pending",
      source: params.source,
    };

    query.query += `
      MATCH (referrer:${companyMeta.labelName} {id: $referrerCompanyId})
      MATCH (referred:${companyMeta.labelName} {id: $referredCompanyId})
      WHERE NOT EXISTS { MATCH (:${referralMeta.labelName})-[:REFERS_TO]->(referred) }
      CREATE (${referralMeta.nodeName}:${referralMeta.labelName} {
        id: $id,
        status: $status,
        source: $source,
        createdAt: datetime(),
        updatedAt: datetime()
      })
      CREATE (${referralMeta.nodeName})-[:REFERRED_BY]->(referrer)
      CREATE (${referralMeta.nodeName})-[:REFERS_TO]->(referred)
    `;

    await this.neo4j.writeOne(query);
  }

  /**
   * Record one referral invite email sent by a user of a company. The invitee
   * address is never stored. Both ids must be server-derived (CLS).
   * @param params.id - The invite ID
   * @param params.companyId - The sender's company
   * @param params.userId - The sender
   */
  async createInvite(params: { id: string; companyId: string; userId: string }): Promise<void> {
    await this.neo4j.validateRelatedNodes({
      nodes: [
        { id: params.companyId, label: companyMeta.labelName },
        { id: params.userId, label: userMeta.labelName },
      ],
    });

    const query = this.neo4j.initQuery({ serialiser: ReferralInviteDescriptor.model });

    query.queryParams = {
      ...query.queryParams,
      id: params.id,
      companyId: params.companyId,
      userId: params.userId,
    };

    query.query += `
      MATCH (company:${companyMeta.labelName} {id: $companyId})
      MATCH (sender:${userMeta.labelName} {id: $userId})
      CREATE (${referralInviteMeta.nodeName}:${referralInviteMeta.labelName} {
        id: $id,
        createdAt: datetime(),
        updatedAt: datetime()
      })
      CREATE (${referralInviteMeta.nodeName})-[:SENT_BY]->(company)
      CREATE (${referralInviteMeta.nodeName})-[:SENT_BY_USER]->(sender)
    `;

    await this.neo4j.writeOne(query);
  }

  /**
   * Record one visit to a company's referral link. Runs on a public route with no
   * company in CLS, so the company check is existence only. The company id comes
   * from the referral code lookup, never from the request.
   * @param params.id - The visit ID
   * @param params.referrerCompanyId - The company owning the referral code
   */
  async createVisit(params: { id: string; referrerCompanyId: string }): Promise<void> {
    await this.neo4j.validateRelatedNodes({
      nodes: [{ id: params.referrerCompanyId, label: companyMeta.labelName }],
    });

    const query = this.neo4j.initQuery({ serialiser: ReferralVisitDescriptor.model });

    query.queryParams = {
      ...query.queryParams,
      id: params.id,
      referrerCompanyId: params.referrerCompanyId,
    };

    query.query += `
      MATCH (referrer:${companyMeta.labelName} {id: $referrerCompanyId})
      CREATE (${referralVisitMeta.nodeName}:${referralVisitMeta.labelName} {
        id: $id,
        createdAt: datetime(),
        updatedAt: datetime()
      })
      CREATE (${referralVisitMeta.nodeName})-[:VISITED]->(referrer)
    `;

    await this.neo4j.writeOne(query);
  }

  /**
   * Find a pending referral by the referred company ID.
   * Uses custom result processing to properly load both referrer and referred relationships
   * (the entity factory can't handle multiple relationships to the same entity type).
   * @param params.referredCompanyId - The ID of the referred company
   * @returns The pending referral with relationships, or null if not found
   */
  async findPendingByReferredCompanyId(params: { referredCompanyId: string }): Promise<Referral | null> {
    const result = await this.neo4j.read(
      `
      MATCH (${referralMeta.nodeName}:${referralMeta.labelName})-[:REFERS_TO]->(referred:${companyMeta.labelName} {id: $referredCompanyId})
      WHERE ${referralMeta.nodeName}.status = $status
      MATCH (${referralMeta.nodeName})-[:REFERRED_BY]->(referrer:${companyMeta.labelName})
      RETURN ${referralMeta.nodeName}, referrer, referred
      `,
      {
        referredCompanyId: params.referredCompanyId,
        status: "pending",
      },
    );

    if (result.records.length === 0) return null;

    const record = result.records[0];
    const referralNode = record.get(referralMeta.nodeName);
    const referrerNode = record.get("referrer");
    const referredNode = record.get("referred");

    // Manually construct the referral with relationships
    // This is necessary because the entity factory doesn't support
    // multiple relationships to the same entity type (both referrer and referred are Company)
    const referral: Referral = {
      id: referralNode.properties.id,
      type: referralMeta.type,
      status: referralNode.properties.status,
      createdAt: referralNode.properties.createdAt,
      updatedAt: referralNode.properties.updatedAt,
      completedAt: referralNode.properties.completedAt,
      tokensAwarded: referralNode.properties.tokensAwarded,
      referrer: referrerNode ? ({ id: referrerNode.properties.id } as Company) : undefined,
      referred: referredNode ? ({ id: referredNode.properties.id } as Company) : undefined,
    };

    return referral;
  }

  /**
   * Mark a referral as completed and set the tokens awarded.
   * @param params.referralId - The ID of the referral to complete
   * @param params.tokensAwarded - The number of tokens awarded for the referral
   */
  async completeReferral(params: { referralId: string; tokensAwarded: number }): Promise<void> {
    await this.neo4j.writeOne({
      queryParams: {
        referralId: params.referralId,
        tokensAwarded: params.tokensAwarded,
        status: "completed",
      },
      query: `
        MATCH (${referralMeta.nodeName}:${referralMeta.labelName} {id: $referralId})
        SET ${referralMeta.nodeName}.status = $status,
            ${referralMeta.nodeName}.completedAt = datetime(),
            ${referralMeta.nodeName}.tokensAwarded = $tokensAwarded,
            ${referralMeta.nodeName}.updatedAt = datetime()
      `,
    });
  }

  /**
   * Count the number of completed referrals made by a specific company.
   * @param params.referrerCompanyId - The ID of the referrer company
   * @returns The count of completed referrals
   */
  async countCompletedByReferrerCompanyId(params: { referrerCompanyId: string }): Promise<number> {
    const result = await this.neo4j.read(
      `
      MATCH (${referralMeta.nodeName}:${referralMeta.labelName})-[:REFERRED_BY]->(referrer:${companyMeta.labelName} {id: $referrerCompanyId})
      WHERE ${referralMeta.nodeName}.status = $status
      RETURN count(${referralMeta.nodeName}) AS count
      `,
      {
        referrerCompanyId: params.referrerCompanyId,
        status: "completed",
      },
    );

    const count = result.records[0]?.get("count");
    return count ? Number(count) : 0;
  }
}
