import { Entity, defineEntity } from "../../../common";
import { PolymorphicDiscriminatorData } from "../../../common/interfaces/entity.schema.interface";
import { modelRegistry } from "../../../common/registries/registry";
import { S3Service } from "../../s3";
import { chunkMeta } from "./chunk.meta";

export type Chunk = Entity & {
  content: string;
  position?: number;
  imagePath?: string;
  nodeId?: string;
  nodeType?: string;
  aiStatus?: string;
  source?: unknown;
};

export const ChunkDescriptor = defineEntity<Chunk>()({
  ...chunkMeta,

  injectServices: [S3Service],

  fields: {
    content: { type: "string", required: true },
    position: { type: "number" },
    nodeId: { type: "string", meta: true },
    nodeType: { type: "string", meta: true },
    aiStatus: { type: "string" },
    imagePath: {
      type: "string",
      transform: async (data, services) => {
        if (!data.imagePath) return undefined;
        return await services.S3Service.generateSignedUrl({
          key: data.imagePath,
          ttl: 60 * 60 * 24 * 7,
        });
      },
    },
  },

  relationships: {
    source: {
      model: chunkMeta, // overridden per-row by polymorphic discriminator
      direction: "in",
      relationship: "HAS_CHUNK",
      cardinality: "one",
      dtoKey: "source",
      required: false,
      polymorphic: {
        candidates: [],
        discriminator: (data: PolymorphicDiscriminatorData) => {
          for (const label of data.labels) {
            const model = modelRegistry.getByLabelName(label);
            if (model) return model;
          }
          throw new Error(`HAS_CHUNK source has no registered model for labels: ${JSON.stringify(data.labels)}`);
        },
      },
    },
  },
});

export type ChunkDescriptorType = typeof ChunkDescriptor;
