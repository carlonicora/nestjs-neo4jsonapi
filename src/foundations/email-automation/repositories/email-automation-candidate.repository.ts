import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { JsonApiCursorInterface } from "../../../core/jsonapi/interfaces/jsonapi.cursor.interface";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { userMeta } from "../../user/entities/user.meta";
import { waitlistMeta } from "../../waitlist/entities/waitlist.meta";
import { WaitlistStatus } from "../../waitlist/enums/waitlist-status.enum";
import { EmailAutomationCandidate, EmailAutomationCandidateDescriptor } from "../entities/email-automation-candidate";
import { emailAutomationCandidateMeta } from "../entities/email-automation-candidate.meta";
import { emailAutomationEnrollmentMeta } from "../entities/email-automation-enrollment.meta";
import { emailAutomationMeta } from "../entities/email-automation.meta";
import { emailOptOutMeta } from "../entities/email-opt-out.meta";
import { recipientMarketingConsentCall } from "../utils/recipient-marketing-consent.cypher";

/** Waitlist entries the manual add lists: pending never confirmed, registered shows as the user. */
const CANDIDATE_WAITLIST_STATUSES: string[] = [WaitlistStatus.Confirmed, WaitlistStatus.Invited];

type RecipientType = EmailAutomationCandidate["recipientType"];

/** The alias every candidate query returns the User or Waitlist node under (the serialiser's nodeName). */
const CANDIDATE = emailAutomationCandidateMeta.nodeName;

/** A registered user the manual add can list: active, not deleted, not scheduled for deletion, with an email. */
const userBranch = (filter: string): string => `
    MATCH (user:${userMeta.labelName})
    WHERE user.isActive = true
      AND coalesce(user.isDeleted, false) = false
      AND user.deletionScheduledAt IS NULL
      AND user.email IS NOT NULL AND trim(user.email) <> ""
      AND ${filter}
    RETURN user AS ${CANDIDATE},
      "user" AS recipientType,
      user.id AS recipientId
`;

/** A confirmed or invited waitlist entry (its consent comes from MARKETING_CONSENT). */
const waitlistBranch = (filter: string): string => `
    MATCH (waitlist:${waitlistMeta.labelName})
    WHERE waitlist.status IN $waitlistStatuses
      AND waitlist.email IS NOT NULL AND trim(waitlist.email) <> ""
      AND ${filter}
    RETURN waitlist AS ${CANDIDATE},
      "waitlist" AS recipientType,
      waitlist.id AS recipientId
`;

/**
 * The shared consent rule on the candidate row (needs the candidate, recipientType and recipientId
 * in scope): once a waitlist entry has a userId the linked user's consent counts.
 */
const MARKETING_CONSENT = recipientMarketingConsentCall({
  carry: `${CANDIDATE}, recipientType, recipientId`,
  recipientType: "recipientType",
  recipientId: "recipientId",
  prefix: CANDIDATE,
});

/** The record a consent lookup reads, by kind: picked from this table, never from the request string. */
const RECIPIENT_LABEL: Record<RecipientType, string> = {
  user: userMeta.labelName,
  waitlist: waitlistMeta.labelName,
};

/** Search filters (constant text; the search value is the $search parameter). */
const USER_SEARCH_FILTER = `($search = "" OR toLower(coalesce(user.name, "")) CONTAINS toLower($search) OR toLower(user.email) CONTAINS toLower($search))`;
const WAITLIST_SEARCH_FILTER = `($search = "" OR toLower(waitlist.email) CONTAINS toLower($search))`;

/** One record by kind: the branch is picked from this table, never from the request string. */
const SINGLE_BRANCH: Record<RecipientType, string> = {
  user: userBranch("user.id = $recipientId"),
  waitlist: waitlistBranch("waitlist.id = $recipientId"),
};

/** Returns the candidate node with its columns, its consent, and the opt-out and already-enrolled flags. */
const RETURN_WITH_FLAGS = `
    ${MARKETING_CONSENT}
    RETURN ${CANDIDATE},
      recipientType,
      recipientId,
      recipientMarketingConsent AS marketingConsent,
      EXISTS {
        MATCH (optOut:${emailOptOutMeta.labelName})
        WHERE toLower(optOut.email) = toLower(${CANDIDATE}.email)
      } AS optedOut,
      EXISTS {
        MATCH (:${emailAutomationMeta.labelName} {id: $automationId})-[:HAS_ENROLLMENT]->(enrollment:${emailAutomationEnrollmentMeta.labelName})
        WHERE toLower(enrollment.email) = toLower(${CANDIDATE}.email)
      } AS alreadyEnrolled
`;

/**
 * The manual-add candidate search: users of every company and confirmed or invited waitlist
 * entries, for an administrator adding a person to an email automation by hand.
 *
 * Cross-company by owner decision (Carlo, 2026-11-02), so no query calls buildDefaultMatch(): the
 * descriptor is tenancy "internal" and has no label of its own. Queries still start from
 * initQuery() and map through readOne()/readMany(). The context MATCHes initQuery prepends (the
 * caller's company, and the caller BELONGS_TO it) yield one row for an administrator acting in a
 * company they belong to, or none are prepended without a company; no query here references
 * company, currentUser or $companyId, so that row does not filter the candidates.
 *
 * Only the EmailAutomationAdminController routes reach it over HTTP (candidates search and manual
 * add), gated by a class-level UseGuards(JwtAuthGuard) and Roles(SystemRoles.Administrator) on each
 * route. The one other caller is EmailAutomationTriggerService (event listener, no route), which
 * reads one recipient's consent through findRecipientMarketingConsent. Read-only: the add is a
 * separate write through EmailAutomationTriggerService.enrol.
 */
@Injectable()
export class EmailAutomationCandidateRepository extends AbstractRepository<
  EmailAutomationCandidate,
  typeof EmailAutomationCandidateDescriptor.relationships
> {
  // Gives the base class its descriptor; no query here goes through the inherited CRUD.
  protected readonly descriptor = EmailAutomationCandidateDescriptor;

  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  /**
   * One page of users (matched on name or email) and confirmed or invited waitlist entries
   * (matched on email) of every company, ordered by email, with consent, opt-out and "already in
   * this automation" flags. `addable` and `reason` are left for the service, which knows the
   * automation's purpose.
   */
  async findCandidates(params: {
    automationId: string;
    search?: string;
    cursor: JsonApiCursorInterface;
  }): Promise<EmailAutomationCandidate[]> {
    const query = this.neo4j.initQuery({ serialiser: EmailAutomationCandidateDescriptor.model, cursor: params.cursor });

    query.queryParams = {
      ...query.queryParams,
      automationId: params.automationId,
      search: params.search?.trim() ?? "",
      waitlistStatuses: CANDIDATE_WAITLIST_STATUSES,
    };

    query.query += `
      CALL {
        ${userBranch(USER_SEARCH_FILTER)}
        UNION
        ${waitlistBranch(WAITLIST_SEARCH_FILTER)}
      }
      WITH ${CANDIDATE}, recipientType, recipientId
      ORDER BY toLower(${CANDIDATE}.email), ${CANDIDATE}.id
      {CURSOR}
      ${RETURN_WITH_FLAGS}
    `;

    return this.neo4j.readMany(query);
  }

  /**
   * The same candidate for one user or waitlist entry, or null when that record is not listable.
   */
  async findCandidate(params: {
    automationId: string;
    recipientType: RecipientType;
    recipientId: string;
  }): Promise<EmailAutomationCandidate | null> {
    if (!Object.prototype.hasOwnProperty.call(SINGLE_BRANCH, params.recipientType)) return null;
    const branch = SINGLE_BRANCH[params.recipientType];

    const query = this.neo4j.initQuery({ serialiser: EmailAutomationCandidateDescriptor.model });

    query.queryParams = {
      ...query.queryParams,
      automationId: params.automationId,
      recipientId: params.recipientId,
      waitlistStatuses: CANDIDATE_WAITLIST_STATUSES,
    };

    query.query += `
      CALL {
        ${branch}
      }
      ${RETURN_WITH_FLAGS}
    `;

    return this.neo4j.readOne(query);
  }

  /**
   * The marketing consent that counts for one user or waitlist entry, whatever its status (the
   * trigger enrols people the manual add would not list): the shared rule, so a registered
   * waitlist entry answers with the linked User's consent. False when the record does not exist.
   */
  async findRecipientMarketingConsent(params: { recipientType: RecipientType; recipientId: string }): Promise<boolean> {
    if (!Object.prototype.hasOwnProperty.call(RECIPIENT_LABEL, params.recipientType)) return false;
    const label = RECIPIENT_LABEL[params.recipientType];

    const query = this.neo4j.initQuery({ serialiser: EmailAutomationCandidateDescriptor.model });

    query.queryParams = {
      ...query.queryParams,
      recipientType: params.recipientType,
      recipientId: params.recipientId,
    };

    query.query += `
      MATCH (${CANDIDATE}:${label} {id: $recipientId})
      WITH ${CANDIDATE}, $recipientType AS recipientType, ${CANDIDATE}.id AS recipientId
      ${MARKETING_CONSENT}
      RETURN ${CANDIDATE}, recipientType, recipientId, recipientMarketingConsent AS marketingConsent
    `;

    const recipient = await this.neo4j.readOne(query);
    return recipient?.marketingConsent === true;
  }
}
