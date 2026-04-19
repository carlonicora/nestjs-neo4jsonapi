import { Entity, defineEntity } from "../../../common";
import type { Company } from "../../company/entities/company";
import type { Assistant } from "../../assistant/entities/assistant";
import { assistantMeta } from "../../assistant/entities/assistant.meta";
import { assistantMessageMeta } from "./assistant-message.meta";

export type AssistantMessageRole = "user" | "assistant" | "system";

/**
 * AssistantMessage — one turn in an Assistant conversation.
 *
 * Lives as a child of Assistant via (Assistant)-[:HAS_MESSAGE]->(AssistantMessage).
 * `references` is a denormalised JSON snapshot of [{type,id,reason}] also
 * materialised as (AssistantMessage)-[:REFERENCES { reason }]->(entity) edges
 * by AssistantMessageRepository.linkReferences().
 */
export type AssistantMessage = Entity & {
  role: AssistantMessageRole;
  content: string;
  position: number;
  suggestedQuestions?: string[];
  inputTokens?: number;
  outputTokens?: number;
  references?: string;
  company: Company;
  assistant: Assistant;
};

export const AssistantMessageDescriptor = defineEntity<AssistantMessage>()({
  ...assistantMessageMeta,

  isCompanyScoped: true,

  fields: {
    role: { type: "string", required: true },
    content: { type: "string", required: true },
    position: { type: "number", required: true },
    suggestedQuestions: { type: "string[]" },
    inputTokens: { type: "number" },
    outputTokens: { type: "number" },
    references: { type: "json" },
  },

  relationships: {
    assistant: {
      model: assistantMeta,
      direction: "in",
      relationship: "HAS_MESSAGE",
      cardinality: "one",
      dtoKey: "assistant",
      required: true,
      immutable: true,
    },
  },
});

export type AssistantMessageDescriptorType = typeof AssistantMessageDescriptor;
