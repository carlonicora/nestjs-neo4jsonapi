import { Entity, defineEntity } from "../../../common";
import { PolymorphicDiscriminatorData } from "../../../common/interfaces/entity.schema.interface";
import { modelRegistry } from "../../../common/registries/registry";
import type { Company } from "../../company/entities/company";
import type { User } from "../../user/entities/user";
import { ownerMeta } from "../../user/entities/user.meta";
import type { AssistantMessage } from "../../assistant-message/entities/assistant-message";
import { assistantMessageMeta } from "../../assistant-message/entities/assistant-message.meta";
import { assistantMeta } from "./assistant.meta";

export type Assistant = Entity & {
  title: string;
  messages?: AssistantMessage[];
  company: Company;
  owner?: User;
  content?: unknown;
};

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
    content: {
      model: assistantMeta,
      direction: "out",
      relationship: "BOUND_TO",
      cardinality: "one",
      required: false,
      immutable: true,
      dtoKey: "content",
      polymorphic: {
        candidates: [],
        discriminator: (data: PolymorphicDiscriminatorData) => {
          for (const label of data.labels) {
            const model = modelRegistry.getByLabelName(label);
            if (model) return model;
          }
          throw new Error(`BOUND_TO target has no registered model for labels: ${JSON.stringify(data.labels)}`);
        },
      },
    },
  },
});

export type AssistantDescriptorType = typeof AssistantDescriptor;
