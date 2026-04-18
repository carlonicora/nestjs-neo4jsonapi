import { Entity, defineEntity } from "../../../common";
import { assistantMeta } from "./assistant.meta";

/**
 * Assistant Entity Type
 *
 * Transient response type for the chatbot assistant endpoint.
 * Not stored in database - used only for JSON:API serialisation.
 */
export type Assistant = Entity & {
  answer: string;
  needsClarification: boolean;
  suggestedQuestions: string[];
  references: Array<{ type: string; id: string; reason: string }>;
  tokens: { input: number; output: number };
  toolCalls: Array<{ tool: string; input: Record<string, unknown>; durationMs: number; error?: string }>;
};

/**
 * Assistant Entity Descriptor
 *
 * Used for serialising chatbot assistant responses to JSON:API format.
 */
export const AssistantDescriptor = defineEntity<Assistant>()({
  ...assistantMeta,

  isCompanyScoped: false,

  fields: {
    answer: { type: "string", required: true },
    needsClarification: { type: "boolean", required: true },
    suggestedQuestions: { type: "string[]" },
    references: { type: "json" },
    tokens: { type: "json", required: true },
    toolCalls: { type: "json" },
  },

  relationships: {},
});

export type AssistantDescriptorType = typeof AssistantDescriptor;
