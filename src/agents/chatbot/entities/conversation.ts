import { Entity, defineEntity } from "../../../common";
import type { Company } from "../../../foundations/company/entities/company";
import type { User } from "../../../foundations/user/entities/user";
import { ownerMeta } from "../../../foundations/user/entities/user.meta";
import { conversationMeta } from "./conversation.meta";

/**
 * ConversationMessage — an entry in the `messages` JSON array on a Conversation node.
 *
 * Stored as JSON (stringified) in Neo4j. Parsed back to an array by the service layer.
 */
export type ConversationMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  references?: Array<{ type: string; id: string; reason: string }>;
  suggestedQuestions?: string[];
  tokens?: { input: number; output: number };
};

/**
 * Conversation Entity Type
 *
 * Persistent ChatGPT-style conversation. Company-scoped and owner-scoped
 * (only the creator can read/modify). Messages are embedded as a JSON array.
 */
export type Conversation = Entity & {
  title: string;
  messages: ConversationMessage[];
  company: Company;
  owner?: User;
};

/**
 * Conversation Entity Descriptor
 *
 * - `isCompanyScoped: true` — framework auto-injects company filter on all queries.
 * - `owner` relationship uses `CREATED_BY` (out) and is populated automatically on create
 *   via `contextKey: "userId"` (from the CLS context).
 * - `messages` is a JSON field — the service JSON.stringify/parse's around the repo calls.
 */
export const ConversationDescriptor = defineEntity<Conversation>()({
  ...conversationMeta,

  isCompanyScoped: true,

  fields: {
    title: { type: "string", required: true },
    messages: { type: "json" },
  },

  relationships: {
    owner: {
      model: ownerMeta,
      direction: "out",
      relationship: "CREATED_BY",
      cardinality: "one",
      required: false,
      dtoKey: "created-by",
      contextKey: "userId",
      immutable: true,
    },
  },
});

export type ConversationDescriptorType = typeof ConversationDescriptor;
