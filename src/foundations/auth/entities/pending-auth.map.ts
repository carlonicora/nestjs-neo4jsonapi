import { PendingAuth } from "./pending-auth.entity";

/**
 * Map raw data to PendingAuth entity.
 */
export function mapPendingAuth(data: any): PendingAuth {
  const now = new Date();
  return {
    id: data.id ?? data.pendingId, // Use pendingId as id for JSON:API
    type: "two-factor-challenge",
    createdAt: data.createdAt ?? now,
    updatedAt: data.updatedAt ?? now,
    token: data.token,
    expiration: data.expiration instanceof Date ? data.expiration : new Date(data.expiration),
    availableMethods: data.availableMethods ?? [],
    preferredMethod: data.preferredMethod,
  };
}
