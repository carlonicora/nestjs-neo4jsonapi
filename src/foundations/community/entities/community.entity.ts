import { Entity } from "../../../common/abstracts/entity";
import { convertFieldValue, defineEntity } from "../../../common/helpers/define-entity";
import { Company } from "../../company/entities/company";
import { KeyConcept } from "../../keyconcept/entities/key.concept.entity";
import { keyConceptMeta } from "../../keyconcept/entities/key.concept.meta";
import { communityMeta } from "./community.meta";

export type Community = Entity & {
  name: string;
  summary: string;
  embedding?: number[];
  level: number;
  rating: number;
  memberCount: number;
  isStale: boolean;
  staleSince?: Date;
  lastProcessedAt?: Date;
  /** Deferred for lack of credits — the summariser cron skips these until approval clears the flag (spec §2). */
  pendingCredits?: boolean;

  /** Computed by `findCommunitiesByRelatedKeyConcepts`: related member concepts. */
  relationshipCount?: number;
  /** Computed by `findCommunitiesByRelatedKeyConcepts`: summed relationship weight. */
  totalWeight?: number;

  company: Company;
  keyconcept: KeyConcept[];
  /** Child groups (PARENT_OF). */
  community?: Community[];
};

/** Reads a computed numeric column from the record when the query returned it. */
const recordNumber = (column: string) => (params: { record: any }) => {
  if (!params.record?.has?.(column)) return undefined;
  const value = params.record.get(column);
  return typeof value?.toNumber === "function" ? value.toNumber() : convertFieldValue(value, "number");
};

/**
 * Topic group of key concepts. Company-scoped, with no `description` and no `chat` block:
 * groups stay out of the assistant catalog.
 */
export const CommunityDescriptor = defineEntity<Community>()({
  ...communityMeta,

  isCompanyScoped: true,

  fields: {
    name: { type: "string", excludeFromSearch: true },
    summary: { type: "string", excludeFromSearch: true },
    embedding: { type: "number[]", excludeFromJsonApi: true },
    level: { type: "number" },
    rating: { type: "number" },
    memberCount: { type: "number" },
    isStale: { type: "boolean" },
    pendingCredits: { type: "boolean" },
    staleSince: { type: "datetime" },
    lastProcessedAt: { type: "datetime" },
  },

  computed: {
    relationshipCount: { compute: recordNumber("relationshipCount") },
    totalWeight: { compute: recordNumber("totalWeight") },
  },

  relationships: {
    keyconcept: {
      model: keyConceptMeta,
      direction: "out",
      relationship: "HAS_MEMBER",
      cardinality: "many",
      required: false,
    },
    community: {
      model: communityMeta,
      direction: "out",
      relationship: "PARENT_OF",
      cardinality: "many",
      required: false,
    },
  },
});

export type CommunityDescriptorType = typeof CommunityDescriptor;
