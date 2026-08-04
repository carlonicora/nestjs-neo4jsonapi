import { Entity } from "../../../common/abstracts/entity";
import { defineEntity } from "../../../common/helpers/define-entity";
import { userActivityMeta } from "./user-activity.meta";

/**
 * UserActivity Entity Type
 *
 * `category` and `action` are open strings at the library level: consuming
 * apps keep their own enums (e.g. UserActivityCategory / UserActivityAction)
 * and pass their members straight through — a string union member is always
 * assignable to `string`.
 */
export type UserActivity = Entity & {
  category: string;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
};

/**
 * UserActivity Entity Descriptor
 *
 * Single source of truth for the UserActivity entity configuration.
 * Generates mapper, childrenTokens, and DataModelInterface automatically.
 *
 * Records are written by `UserActivityRepository.createActivity()` (a fully custom
 * Cypher write, run from the `UserActivityProcessor` BullMQ worker outside
 * HTTP/CLS context — see the repository) rather than through the inherited
 * descriptor-driven `create()`. The descriptor still owns field typing,
 * JSON:API serialisation, and the semantic layer for the chatbot catalog.
 *
 * NOTE: this descriptor is deliberately NOT registered with the
 * GraphDescriptorRegistry here — graph-catalog registration is an
 * application-level policy decision (see the consuming app's
 * GraphCatalogModule), not a library one.
 */
export const UserActivityDescriptor = defineEntity<UserActivity>()({
  ...userActivityMeta,

  description:
    "A user activity (attività utente) log entry: an audit-trail record of an action a user performed on the platform (e.g. login, create/update/delete an entity, an AI query, a document share), captured for compliance and security review.",

  chat: {
    summary: (d) => `${d.category ?? ""} ${d.action ?? ""}${d.entityType ? ` on ${d.entityType}` : ""}`.trim() || d.id,
    textSearchFields: ["category", "action", "entityType", "entityId"],
  },

  // Field definitions
  fields: {
    category: {
      type: "string",
      required: true,
      description:
        'The broad domain of the activity: "AUTH" (login/logout), "ENTITY" (CRUD on a resource), "AI" (an AI/LLM interaction), "COLLABORATION" (sharing, comments), or "DOCUMENT" (document-specific actions).',
    },
    action: {
      type: "string",
      required: true,
      description:
        'The specific action performed: "LOGIN", "CREATE", "UPDATE", "DELETE", "QUERY", "COMPLETE", "SHARE", or "IMPORT".',
    },
    entityType: {
      type: "string",
      description:
        'The JSON:API resource type the action targeted (e.g. "proceedings", "documents"), when the activity relates to a specific entity.',
    },
    entityId: {
      type: "string",
      description: "The id of the specific entity the action targeted, when applicable.",
    },
    metadata: {
      type: "json",
      description:
        "Additional structured context captured at record time (e.g. HTTP method and path for coarse-grained interceptor-captured events). Shape varies by category and action.",
    },
  },

  // Computed properties (derived from Neo4j query results)
  computed: {
    // `metadata` is stored on the node as a JSON string (see
    // UserActivityRepository.createActivity()); this reproduces the old
    // mapUserActivity()/safeParseJson() behaviour of parsing it back into an
    // object for JSON:API output.
    metadata: {
      compute: (params) => {
        const raw = params.data?.metadata;
        if (raw === null || raw === undefined) return undefined;
        if (typeof raw === "string") {
          try {
            return JSON.parse(raw);
          } catch {
            return undefined;
          }
        }
        return raw;
      },
    },
  },

  // No relationships are exposed via JSON:API — matches the old
  // UserActivitySerialiser (relationships: {}) and old
  // UserActivityModel.singleChildrenTokens: []. The real Cypher graph has
  // (User)-[:PERFORMED]->(UserActivity)-[:BELONGS_TO]->(Company), but both
  // edges are only ever traversed internally (UserActivityRepository.createActivity()
  // / findByUser()), never surfaced on the wire.
  relationships: {},
});

// Type export for the descriptor
export type UserActivityDescriptorType = typeof UserActivityDescriptor;
