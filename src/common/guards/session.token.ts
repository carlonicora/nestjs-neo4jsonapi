import { HttpException } from "@nestjs/common";
import { SystemRoles } from "../constants/system.roles";

/**
 * Every token the library issues is signed with the same `jwt.secret`, so a valid
 * signature alone does not make a session. `JwtStrategy` accepts all of them:
 *
 * - full session (`SecurityService.signJwt`): `{ userId, roles, companyId?, features, userName, expiration }`
 * - pending 2FA (`signPendingJwt`): `{ userId, pendingId, pending: true, type: "pending_2fa", expiration }`
 * - company selection (`signCompanySelectionJwt`): `{ userId, scope: "company-selection", expiration }`
 * - invitation selection (`signInvitationSelectionJwt`): `{ userId, scope: "invitation-selection", expiration }`
 *
 * Apps may also sign portal tokens (`personEmail`) with the same secret. The helpers
 * below tell these classes apart, so each guard admits only the class it is meant for.
 */
export interface SessionPayload {
  userId: string;
  roles: string[];
  companyId?: string | null;
  features?: string[];
  userName?: string;
  expiration?: string | Date;
}

/** The selection scopes the library signs. */
export type TokenScope = "company-selection" | "invitation-selection";

/** Keys that only non-session tokens carry. */
const NON_SESSION_KEYS = ["personEmail", "pending", "pendingId", "scope", "type"] as const;

/** Keys a selection token must never carry (it carries `scope`, nothing else of these). */
const NON_SELECTION_KEYS = ["personEmail", "pending", "pendingId", "type"] as const;

/**
 * True only for a full session payload: a non-empty string `userId`, a `roles` array
 * of strings, a string-or-absent `companyId`, and none of the non-session markers.
 */
export function isSessionPayload(payload: unknown): payload is SessionPayload {
  if (!payload || typeof payload !== "object") return false;

  const candidate = payload as Record<string, unknown>;
  if (typeof candidate.userId !== "string" || candidate.userId.length === 0) return false;
  if (!Array.isArray(candidate.roles) || !candidate.roles.every((role) => typeof role === "string")) return false;
  if (NON_SESSION_KEYS.some((key) => candidate[key] !== undefined)) return false;
  if (candidate.companyId !== undefined && candidate.companyId !== null && typeof candidate.companyId !== "string")
    return false;

  return true;
}

/** Throws 401 unless `payload` is a full session payload. */
export function assertSessionPayload(payload: unknown): asserts payload is SessionPayload {
  if (!isSessionPayload(payload)) throw new HttpException("Unauthorised", 401);
}

/**
 * True for a full session, or for a selection token whose `scope` is in
 * `allowedScopes`. A pending-2FA token, a portal token and a selection token of
 * another scope are refused: a pending-2FA token must never reach a route that can
 * mint a full session.
 */
export function isAcceptedScopedPayload(payload: unknown, allowedScopes: readonly string[]): boolean {
  if (isSessionPayload(payload)) return true;
  if (!payload || typeof payload !== "object") return false;

  const candidate = payload as Record<string, unknown>;
  if (typeof candidate.userId !== "string" || candidate.userId.length === 0) return false;
  if (NON_SELECTION_KEYS.some((key) => candidate[key] !== undefined)) return false;

  return typeof candidate.scope === "string" && allowedScopes.includes(candidate.scope);
}

/**
 * The company a session acts in.
 *
 * - The token carries a company: that company, whatever the `x-companyid` header says.
 * - The token carries no company: only a system Administrator may pick one through the
 *   header (or act without one). Any other user is refused with 401, because a request
 *   without a company runs with no tenant filter.
 */
export function resolveSessionCompanyId(params: {
  payload: SessionPayload;
  headerCompanyId: unknown;
  administratorRole?: string;
}): string | undefined {
  const { payload, headerCompanyId } = params;

  if (typeof payload.companyId === "string" && payload.companyId.length > 0) return payload.companyId;

  const administratorRole = params.administratorRole ?? SystemRoles.Administrator;
  if (!payload.roles.includes(administratorRole)) throw new HttpException("Unauthorised", 401);

  return typeof headerCompanyId === "string" && headerCompanyId.length > 0 ? headerCompanyId : undefined;
}
