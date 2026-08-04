import { defineEntity, Entity } from "../../../common";
import type { User } from "../../user/entities/user";
import { userMeta } from "../../user/entities/user.meta";
import { authMeta } from "./auth.meta";

/**
 * Auth Entity Type
 *
 * NOTE: `refreshToken` is intentionally NOT part of this type. It is a
 * virtual, output-only attribute (the record's own `id`) assigned by the
 * service layer via `(auth as any).refreshToken = auth.id` — mirrors the
 * pre-migration behaviour, where it was never a real entity property either.
 */
export type Auth = Entity & {
  token: string;
  expiration: Date;

  requiresCompanySelection?: boolean;
  selectionToken?: string;

  user?: User;
};

/**
 * Auth Entity Descriptor
 *
 * Single source of truth for the Auth entity configuration.
 * Generates mapper, childrenTokens, and DataModelInterface automatically.
 *
 * SECURITY: this descriptor is deliberately NOT registered with the
 * GraphDescriptorRegistry (see auth.module.ts) — the `token` attribute
 * carries a live, valid JWT session credential, and an LLM-queryable graph
 * catalog entry would let chatbot/agent tooling read out active session
 * tokens for any user. Do not add `graphRegistry.register()` for this
 * descriptor without explicit product/security sign-off.
 */
export const AuthDescriptor = defineEntity<Auth>()({
  ...authMeta,

  // Auth sessions are looked up by token/id directly and are not scoped to a
  // company relationship; pre-login flows (login, token refresh) also run
  // before any companyId exists in CLS. Mirrors the pre-migration Cypher,
  // which never joined Auth to Company.
  isCompanyScoped: false,

  description:
    "An authentication session (sessione di autenticazione): the signed JWT access token issued to a user on login, paired with an opaque refresh-token id used to exchange for a new access token.",

  // Field definitions
  fields: {
    token: {
      type: "string",
      required: true,
      description:
        "The signed JWT access token for this session. Returned to the client on login, code exchange, and token refresh; sent back as the Authorization bearer token on subsequent requests.",
    },
    expiration: {
      type: "datetime",
      required: true,
      description:
        "The instant this session's refresh token expires and can no longer be exchanged for a new access token.",
    },
    requiresCompanySelection: {
      type: "boolean",
      description:
        "True when the credentials were valid but the user belongs to more than one company, so no session was created: the client must let the user pick a company and call POST /auth/company-selection/:companyId.",
    },
    selectionToken: {
      type: "string",
      description:
        "Short-lived, company-selection scoped JWT returned alongside requiresCompanySelection. It authenticates only the company listing and the company-selection exchange.",
    },
  },

  // Virtual fields (output-only, not part of the entity type or stored on the node)
  virtualFields: {
    refreshToken: {
      description:
        "Opaque refresh-token identifier — this Auth record's own id. Exchanged via POST /auth/refreshtoken/:refreshToken for a new access token without re-entering credentials.",
      compute: (params) => params.data.id,
    },
  },

  // Relationship definitions
  relationships: {
    user: {
      model: userMeta,
      // User -[:HAS_AUTH]-> Auth, so from Auth's perspective: incoming
      direction: "in",
      relationship: "HAS_AUTH",
      cardinality: "one",
      description: "The user this authentication session belongs to.",
    },
  },
});

// Type export for the descriptor
export type AuthDescriptorType = typeof AuthDescriptor;
