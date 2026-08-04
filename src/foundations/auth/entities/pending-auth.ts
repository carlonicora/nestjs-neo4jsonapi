import { defineEntity, Entity } from "../../../common";
import { pendingAuthMeta } from "./pending-auth.meta";

/**
 * PendingAuth Entity Type
 *
 * The response returned when a user with 2FA enabled successfully
 * authenticates with a password but still has to complete 2FA verification.
 *
 * PendingAuth is NEVER persisted: no `:PendingAuth` node exists in Neo4j. The
 * login flow hands a plain object straight to `JsonApiService.buildSingle`,
 * so the descriptor exists only to describe the JSON:API shape.
 *
 * NAMING: the property names below are the ON-THE-WIRE attribute names of the
 * deleted `PendingAuthSerialiser` (`pendingToken`, `expiresAt`,
 * `availableMethods`, `preferredMethod`). The descriptor-based serialiser maps
 * every attribute 1:1 from the field name (see DescriptorBasedSerialiser.create),
 * so it has no way to rename `token` -> `pendingToken` the way the hand-written
 * serialiser did. Keeping the entity properties on the wire names is what
 * preserves the response byte-for-byte — do not "tidy" them back to
 * `token` / `expiration`.
 */
export type PendingAuth = Entity & {
  /** The pending JWT token (limited access until 2FA is completed) */
  pendingToken: string;

  /** When the pending session expires */
  expiresAt: Date;

  /** Available 2FA methods for this user */
  availableMethods: string[];

  /** The user's preferred 2FA method */
  preferredMethod?: string;
};

/**
 * PendingAuth Entity Descriptor
 *
 * SECURITY: like Auth, deliberately NOT registered with the
 * GraphDescriptorRegistry — `pendingToken` is a live (if limited) credential.
 */
export const PendingAuthDescriptor = defineEntity<PendingAuth>()({
  ...pendingAuthMeta,

  // Not persisted, never joined to a Company; the 2FA challenge is issued
  // before any company scope exists in CLS.
  isCompanyScoped: false,

  description:
    "A pending two-factor authentication challenge (sfida a due fattori): issued when the password check succeeds but 2FA verification is still required.",

  fields: {
    pendingToken: {
      type: "string",
      required: true,
      description:
        "Short-lived JWT with limited access, valid only for completing the 2FA verification of this challenge.",
    },
    expiresAt: {
      type: "datetime",
      required: true,
      description: "The instant this pending 2FA challenge expires and can no longer be completed.",
    },
    availableMethods: {
      type: "string[]",
      description: "The 2FA methods this user can verify with (e.g. totp, passkey, backup code).",
    },
    preferredMethod: {
      type: "string",
      description: "The 2FA method the user selected as preferred, so the client can pre-select it.",
    },
  },

  // No relationships: the challenge carries no resource linkage.
  relationships: {},
});

// Type export for the descriptor
export type PendingAuthDescriptorType = typeof PendingAuthDescriptor;
