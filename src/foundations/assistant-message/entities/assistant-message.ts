import { Entity, defineEntity } from "../../../common";
import type { Company } from "../../company/entities/company";
import type { Assistant } from "../../assistant/entities/assistant";
import { assistantMeta } from "../../assistant/entities/assistant.meta";
import { PolymorphicDiscriminatorData } from "../../../common/interfaces/entity.schema.interface";
import { modelRegistry } from "../../../common/registries/registry";
import { assistantMessageMeta } from "./assistant-message.meta";

export type AssistantMessageRole = "user" | "assistant" | "system";

/**
 * AssistantMessage — one turn in an Assistant conversation.
 *
 * Child of Assistant via (Assistant)-[:HAS_MESSAGE]->(AssistantMessage).
 * References from a message to referenced domain entities are edges
 * (AssistantMessage)-[:REFERENCES]->(target), surfaced as a polymorphic
 * JSON:API relationship. The edge also carries reason/createdAt internally,
 * but these are NOT exposed in JSON:API.
 */
export type AssistantMessage = Entity & {
  role: AssistantMessageRole;
  content: string;
  position: number;
  suggestedQuestions?: string[];
  inputTokens?: number;
  outputTokens?: number;
  company: Company;
  assistant: Assistant;
  references?: unknown[];
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
    references: {
      // `model` is a placeholder — the polymorphic discriminator picks the real one at serialise time.
      // We pass the current entity's meta so the field's typing lines up; the factory ignores it.
      model: assistantMessageMeta,
      direction: "out",
      relationship: "REFERENCES",
      cardinality: "many",
      dtoKey: "references",
      polymorphic: {
        // candidates populated at module init; see Task 5.
        candidates: [],
        discriminator: (data: PolymorphicDiscriminatorData) => {
          for (const label of data.labels) {
            const model = modelRegistry.getByLabelName(label);
            if (model) return model;
          }
          throw new Error(
            `REFERENCES target has no registered model for labels: ${JSON.stringify(data.labels)}`,
          );
        },
      },
    },
  },
});

export type AssistantMessageDescriptorType = typeof AssistantMessageDescriptor;
