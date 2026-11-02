import { userMeta } from "../../user/entities/user.meta";
import { waitlistMeta } from "../../waitlist/entities/waitlist.meta";

/**
 * The one Cypher rule for "may this person get Marketing emails", as a CALL subquery that yields
 * one `recipientMarketingConsent` boolean per input row (rows never multiply):
 * - a user reads `User.marketingConsent`;
 * - a waitlist entry with a `userId` (registered) reads the linked User's;
 * - any other waitlist entry reads its own;
 * - a record that no longer exists counts as no consent.
 *
 * Used by the enrolment read (the sender's re-check), the candidate search and manual add, and the
 * trigger's consent lookup, so the rule is written once.
 *
 * @param carry the variables the subquery imports (comma separated), e.g. the enrolment node
 * @param recipientType Cypher expression for the recipient kind ("user" | "waitlist")
 * @param recipientId Cypher expression for the recipient record's id
 * @param prefix prefix of the subquery's internal MATCH aliases, so they never clash with outer ones
 */
export const recipientMarketingConsentCall = (params: {
  carry: string;
  recipientType: string;
  recipientId: string;
  prefix: string;
}): string => {
  const { carry, recipientType, recipientId, prefix } = params;
  const recipientUserAlias = `${prefix}_recipientUser`;
  const recipientWaitlistAlias = `${prefix}_recipientWaitlist`;
  const linkedUserAlias = `${prefix}_linkedUser`;

  return `
      CALL {
        WITH ${carry}
        OPTIONAL MATCH (${recipientUserAlias}:${userMeta.labelName} {id: ${recipientId}})
        WHERE ${recipientType} = "user"
        WITH ${carry}, head(collect(${recipientUserAlias})) AS recipientUser
        OPTIONAL MATCH (${recipientWaitlistAlias}:${waitlistMeta.labelName} {id: ${recipientId}})
        WHERE ${recipientType} = "waitlist"
        WITH recipientUser, head(collect(${recipientWaitlistAlias})) AS recipientWaitlist
        OPTIONAL MATCH (${linkedUserAlias}:${userMeta.labelName} {id: recipientWaitlist.userId})
        WITH recipientUser, recipientWaitlist, head(collect(${linkedUserAlias})) AS linkedUser
        RETURN CASE
          WHEN recipientUser IS NOT NULL THEN coalesce(recipientUser.marketingConsent, false)
          WHEN recipientWaitlist IS NOT NULL AND recipientWaitlist.userId IS NOT NULL
            THEN coalesce(linkedUser.marketingConsent, false)
          WHEN recipientWaitlist IS NOT NULL THEN coalesce(recipientWaitlist.marketingConsent, false)
          ELSE false
        END AS recipientMarketingConsent
      }`;
};
