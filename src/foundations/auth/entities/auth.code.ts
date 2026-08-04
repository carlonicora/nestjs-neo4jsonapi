import { defineEntity, Entity } from "../../../common";
import type { Auth } from "./auth";
import { authCodeMeta } from "./auth.code.meta";
import { authMeta } from "./auth.meta";

/**
 * AuthCode Entity Type
 *
 * A one-time code used for login-by-link, account activation, and
 * password-reset flows: exchanged for the Auth session it points to.
 */
export type AuthCode = Entity & {
  expiration: Date;
  auth?: Auth;
};

/**
 * AuthCode Entity Descriptor
 *
 * Single source of truth for the AuthCode entity configuration.
 * Generates mapper, childrenTokens, and DataModelInterface automatically.
 *
 * SECURITY: like Auth, this descriptor is deliberately NOT registered with
 * the GraphDescriptorRegistry (see auth.module.ts) — it is a one-time
 * login/activation code, never returned as its own JSON:API resource, and
 * has no business being LLM-queryable.
 */
export const AuthCodeDescriptor = defineEntity<AuthCode>()({
  ...authCodeMeta,

  isCompanyScoped: false,

  description:
    "A one-time authentication code (codice monouso) exchanged for an Auth session via login-by-link, activation, or password reset.",

  // Field definitions
  fields: {
    expiration: {
      type: "datetime",
      required: true,
      description: "The instant this one-time code expires and can no longer be exchanged for its Auth session.",
    },
  },

  // Relationship definitions
  //
  // CLI defect fix: the generated descriptor originally declared `auth` as a
  // `fields: { auth: { type: "string" } }` scalar. Because relationship
  // population (EntityFactory.createOrMerge, keyed off
  // model.singleChildrenTokens/singleChildrenRelationships) is driven
  // entirely by `relationships`, that left `AuthCodeDescriptor.model`
  // ignorant of the `authcode_auth` column the repository's Cypher already
  // returns (`findByCode`) — `authCode.auth` came back `undefined` and
  // `AuthService.findAuthByCode()`'s `authCode.auth.id` would throw at
  // runtime. Declaring it as a proper relationship (matching the
  // `(authcode)<-[:HAS_AUTH_CODE]-(auth)` Cypher pattern) fixes this.
  relationships: {
    auth: {
      model: authMeta,
      // Auth -[:HAS_AUTH_CODE]-> AuthCode, so from AuthCode's perspective: incoming
      direction: "in",
      relationship: "HAS_AUTH_CODE",
      cardinality: "one",
      description: "The Auth session this one-time code resolves to when exchanged.",
    },
  },
});

// Type export for the descriptor
export type AuthCodeDescriptorType = typeof AuthCodeDescriptor;
