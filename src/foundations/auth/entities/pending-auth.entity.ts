import { Entity } from "../../../common/abstracts/entity";

/**
 * PendingAuth entity represents the response when a user with 2FA enabled
 * successfully authenticates with password but still needs to complete 2FA.
 */
export interface PendingAuth extends Entity {
  // Entity provides: id, type, createdAt, updatedAt

  /** The pending JWT token (limited access until 2FA completed) */
  token: string;

  /** When the pending session expires */
  expiration: Date;

  /** Available 2FA methods for this user */
  availableMethods: string[];

  /** The user's preferred 2FA method */
  preferredMethod?: string;
}
