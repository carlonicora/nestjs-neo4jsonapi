import { userMeta } from "../../user/entities/user.meta";

/**
 * Cypher expression evaluating to 'users' or 'visitors' for the session bound
 * to `session`. Rows are checked in order, the first match wins:
 * 1. byDeletedUser true: a returning user's visit whose account is gone.
 * 2. a BY_USER user created before the session started: a returning user.
 * 3. anything else (no user, or a user created during the visit: a signup).
 * The argument is always a node alias constant from the calling file, never request text.
 */
export const audienceOf = (session: string): string => `CASE
    WHEN coalesce(${session}.byDeletedUser, false) THEN 'users'
    WHEN EXISTS {
      MATCH (${session})-[:BY_USER]->(audienceUser:${userMeta.labelName})
      WHERE audienceUser.createdAt < ${session}.startedAt
    } THEN 'users'
    ELSE 'visitors'
  END`;
