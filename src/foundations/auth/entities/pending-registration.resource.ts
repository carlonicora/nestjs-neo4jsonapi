import { defineEntity, Entity } from "../../../common";
import { pendingRegistrationMeta } from "./pending-registration.meta";

/**
 * PendingRegistrationResource Entity Type
 *
 * The read-only view of an OAuth sign-up waiting for the user to accept the
 * terms (the Redis `PendingRegistration` record, which keeps that name).
 *
 * NEVER persisted: no `:PendingRegistration` node exists in Neo4j.
 * `AuthService.findPendingRegistration` hands a plain object straight to
 * `JsonApiService.buildSingle`, so the descriptor only describes the JSON:API
 * shape. `hasPass` and `emailInUse` are derived by the service yet declared as
 * fields, because `computed` needs a Neo4j record (owner decision D-C).
 */
export type PendingRegistrationResource = Entity & {
  name: string;
  email: string;
  avatar?: string;
  provider: string;
  hasPass: boolean;
  emailInUse: boolean;
};

/**
 * PendingRegistration Entity Descriptor
 *
 * SECURITY: not registered with the GraphDescriptorRegistry — it carries the
 * name and email of someone who has no account yet.
 */
export const PendingRegistrationDescriptor = defineEntity<PendingRegistrationResource>()({
  ...pendingRegistrationMeta,

  // Not persisted, never joined to a Company: no account exists yet.
  isCompanyScoped: false,
  tenancy: "internal",

  description:
    "An OAuth sign-up (registrazione in sospeso) waiting for the user to accept the terms before the account is created.",

  fields: {
    name: {
      type: "string",
      required: true,
      description: "The display name returned by the OAuth provider.",
    },
    email: {
      type: "string",
      required: true,
      description: "The email returned by the OAuth provider; the account will use it.",
    },
    avatar: {
      type: "string",
      description: "The avatar URL returned by the OAuth provider.",
    },
    provider: {
      type: "string",
      required: true,
      description: "The OAuth provider the user signed in with (discord, google).",
    },
    hasPass: {
      type: "boolean",
      required: true,
      description: "True when the sign-up carries a registration pass supplied by the application.",
    },
    emailInUse: {
      type: "boolean",
      required: true,
      description: "True when a user (including a deleted one) already has this email, so the sign-up cannot complete.",
    },
  },

  // No relationships: the pending sign-up carries no resource linkage.
  relationships: {},
});

export type PendingRegistrationDescriptorType = typeof PendingRegistrationDescriptor;
