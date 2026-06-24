import { Entity, defineEntity } from "../../../common";
import { PolymorphicDiscriminatorData } from "../../../common/interfaces/entity.schema.interface";
import { modelRegistry } from "../../../common/registries/registry";
import type { Company } from "../../company/entities/company";
import type { Assistant } from "../../assistant/entities/assistant";
import { assistantMeta } from "../../assistant/entities/assistant.meta";
import type { Chunk } from "../../chunk/entities/chunk.entity";
import { chunkMeta } from "../../chunk/entities/chunk.meta";
import type { AssistantAction } from "../../assistant-action/entities/assistant-action";
import { assistantActionMeta } from "../../assistant-action/entities/assistant-action.meta";
import { assistantMessageMeta } from "./assistant-message.meta";

export type AssistantMessageRole = "user" | "assistant" | "system";

export type AssistantMessage = Entity & {
  role: AssistantMessageRole;
  content: string;
  position: number;
  suggestedQuestions?: string[];
  inputTokens?: number;
  outputTokens?: number;
  trace?: string;
  messageType?: string;
  company: Company;
  assistant: Assistant;
  references?: unknown[];
  citations?: Chunk[];
  action?: AssistantAction;
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
    trace: { type: "string" },
    messageType: { type: "string" },
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
      model: assistantMessageMeta,
      direction: "out",
      relationship: "REFERENCES",
      cardinality: "many",
      dtoKey: "references",
      fields: [
        { name: "relevance", type: "number", required: false },
        { name: "reason", type: "string", required: false },
      ],
      polymorphic: {
        candidates: [],
        discriminator: (data: PolymorphicDiscriminatorData) => {
          for (const label of data.labels) {
            const model = modelRegistry.getByLabelName(label);
            if (model) return model;
          }
          throw new Error(`REFERENCES target has no registered model for labels: ${JSON.stringify(data.labels)}`);
        },
      },
    },
    citations: {
      model: chunkMeta,
      direction: "out",
      relationship: "CITES",
      cardinality: "many",
      required: false,
      dtoKey: "citations",
      fields: [
        { name: "relevance", type: "number", required: true },
        { name: "reason", type: "string", required: false },
      ],
    },
    action: {
      model: assistantActionMeta,
      direction: "out", // (AssistantMessage)-[:REQUESTED_IN]->(AssistantAction) — mirror of AssistantAction.message
      relationship: "REQUESTED_IN",
      cardinality: "one",
      required: false,
      dtoKey: "action",
      immutable: true,
    },
  },
});

export type AssistantMessageDescriptorType = typeof AssistantMessageDescriptor;
