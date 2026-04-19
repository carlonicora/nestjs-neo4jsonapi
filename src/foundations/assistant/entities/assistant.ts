import { Entity, defineEntity } from "../../../common";
import type { Company } from "../../company/entities/company";
import type { User } from "../../user/entities/user";
import { ownerMeta } from "../../user/entities/user.meta";
import type { AssistantMessage } from "../../assistant-message/entities/assistant-message";
import { assistantMessageMeta } from "../../assistant-message/entities/assistant-message.meta";
import { assistantMeta } from "./assistant.meta";

/**
 * Assistant Entity Type
 *
 * Persistent ChatGPT-style assistant thread. Company-scoped and owner-scoped
 * (only the creator can read/modify). Messages live as child AssistantMessage
 * nodes joined via (Assistant)-[:HAS_MESSAGE]->(AssistantMessage).
 */
export type Assistant = Entity & {
  title: string;
  messages?: AssistantMessage[];
  company: Company;
  owner?: User;
};

/**
 * Assistant Entity Descriptor
 *
 * - `isCompanyScoped: true` — framework auto-injects company filter on all queries.
 * - `owner` relationship uses `CREATED_BY` (out) and is populated automatically on create
 *   via `contextKey: "userId"` (from the CLS context).
 * - `messages` relationship points to the first-class `AssistantMessage` node; messages
 *   are created via `AssistantMessageService` in the two agent-turn flows on this service.
 */
export const AssistantDescriptor = defineEntity<Assistant>()({
  ...assistantMeta,

  isCompanyScoped: true,

  fields: {
    title: { type: "string", required: true },
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
    messages: {
      model: assistantMessageMeta,
      direction: "out",
      relationship: "HAS_MESSAGE",
      cardinality: "many",
      required: false,
      dtoKey: "messages",
    },
  },
});

export type AssistantDescriptorType = typeof AssistantDescriptor;
