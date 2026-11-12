import { Entity, defineEntity } from "../../../common";
import { PolymorphicDiscriminatorData } from "../../../common/interfaces/entity.schema.interface";
import { modelRegistry } from "../../../common/registries/registry";
import { S3Service } from "../../s3";
import { chunkMeta } from "./chunk.meta";

export interface ChunkDate {
  date: string;
  description: string;
}

export type Chunk = Entity & {
  content: string;
  position?: number;
  imagePath?: string;
  nodeId?: string;
  nodeType?: string;
  aiStatus?: string;
  embedding?: number[];
  source?: unknown;
  heading?: string;
  /** Stored on the node as a JSON string; exposed here parsed via a computed field. */
  dates?: ChunkDate[];
  propagatedDates?: ChunkDate[];
  /**
   * Similarity read from a `chunk_score` column a query projects next to the chunk
   * (`… AS chunk_score`); undefined on every other read and for a value that is not a finite number.
   */
  score?: number;
};

/** Parse a `dates` / `propagatedDates` value that is persisted as a JSON-string blob. */
const parseChunkDates = (raw: unknown): ChunkDate[] => {
  if (Array.isArray(raw)) return raw as ChunkDate[];
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as ChunkDate[]) : [];
    } catch {
      return [];
    }
  }
  return [];
};

/** A Neo4j driver Integer or a plain number as a finite JS number; undefined for anything else. */
const toFiniteNumber = (value: unknown): number | undefined => {
  const number =
    value !== null && typeof value === "object" && "toNumber" in value
      ? (value as { toNumber: () => number }).toNumber()
      : value;
  return typeof number === "number" && Number.isFinite(number) ? number : undefined;
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
    heading: { type: "string" },
    embedding: { type: "number[]", excludeFromJsonApi: true },
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

  computed: {
    dates: { compute: (params) => parseChunkDates(params.data?.dates) },
    propagatedDates: { compute: (params) => parseChunkDates(params.data?.propagatedDates) },
    score: {
      // Only the column a query names for the chunk: a bare `score` belongs to no node of the row.
      compute: (params) => {
        if (typeof params.record?.has !== "function" || !params.record.has("chunk_score")) return undefined;
        return toFiniteNumber(params.record.get("chunk_score"));
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
