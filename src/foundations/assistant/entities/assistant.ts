import { Entity, defineEntity } from "../../../common";
import type { Company } from "../../company/entities/company";
import type { User } from "../../user/entities/user";
import { ownerMeta } from "../../user/entities/user.meta";
import { assistantMeta } from "./assistant.meta";

/**
 * AssistantMessage — an entry in the `messages` JSON array on an Assistant node.
 *
 * Stored as JSON (stringified) in Neo4j. Parsed back to an array by the service layer.
 */
export type AssistantMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  references?: Array<{ type: string; id: string; reason: string }>;
  suggestedQuestions?: string[];
  tokens?: { input: number; output: number };
};

/**
 * Assistant Entity Type
 *
 * Persistent ChatGPT-style assistant thread. Company-scoped and owner-scoped
 * (only the creator can read/modify). Messages are embedded as a JSON array.
 */
export type Assistant = Entity & {
  title: string;
  messages: AssistantMessage[];
  company: Company;
  owner?: User;
};

/**
 * Assistant Entity Descriptor
 *
 * - `isCompanyScoped: true` — framework auto-injects company filter on all queries.
 * - `owner` relationship uses `CREATED_BY` (out) and is populated automatically on create
 *   via `contextKey: "userId"` (from the CLS context).
 * - `messages` is a JSON field — the service JSON.stringify/parse's around the repo calls.
 */
export const AssistantDescriptor = defineEntity<Assistant>()({
  ...assistantMeta,

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

export type AssistantDescriptorType = typeof AssistantDescriptor;
