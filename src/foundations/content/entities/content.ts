import { Entity } from "../../../common/abstracts/entity";
import { AiStatus } from "../../../common/enums/ai.status";
import { defineEntity } from "../../../common/helpers/define-entity";
import { DataModelInterface } from "../../../common/interfaces/datamodel.interface";
import {
  EntityDescriptor,
  EntitySchemaInput,
  RelationshipDef,
} from "../../../common/interfaces/entity.schema.interface";
import { modelRegistry } from "../../../common/registries/registry";
import type { User } from "../../user/entities/user";
import { authorMeta, ownerMeta } from "../../user/entities/user.meta";
import { ContentExtensionConfig } from "../interfaces/content.extension.interface";
import { contentMeta } from "./content.meta";

/**
 * Content entity type representing polymorphic content (Article, Document, etc.).
 *
 * The index signature allows extension relationships to be added dynamically
 * when ContentExtensionConfig is provided. APIs can narrow this type using
 * intersection types for better type safety.
 *
 * @example
 * ```typescript
 * // In API - narrow type for specific extensions
 * type ExtendedContent = Content & {
 *   topic: Topic[];
 *   expertise: Expertise[];
 * };
 * ```
 */
export type Content = Entity & {
  name: string;
  contentType: string;
  abstract?: string;
  tldr?: string;
  aiStatus?: string;

  relevance?: number;

  owner: User;
  author: User;

  /** Index signature for extension relationships added via ContentExtensionConfig */
  [relationshipName: string]: unknown;
};

/**
 * Builds the Content entity descriptor, optionally shaped by a
 * {@link ContentExtensionConfig}.
 *
 * With NO config the descriptor is the exact wire contract of the legacy
 * `ContentSerialiser`/`ContentModel` pair it replaces:
 * - attributes: `name`, `abstract`, `tldr`
 * - meta: `aiStatus`, `contentType`, `relevance`
 * - relationships: `owner`, `author`
 *
 * Config effects:
 * - `serialiseAuthor: false` removes the `author` relationship
 * - `metaFields` adds one computed meta entry per entry, read from the Cypher
 *   RETURN alias produced by {@link ContentCypherService}
 * - `additionalRelationships` adds one relationship per entry, keyed by the
 *   related model's `nodeName` (the key the Cypher RETURN alias
 *   `content_<nodeName>` maps onto)
 *
 * @param config - Optional Content extension configuration
 */
export function buildContentDescriptor(
  config?: ContentExtensionConfig,
): EntityDescriptor<Content, Record<string, RelationshipDef>> {
  const relationships: Record<string, RelationshipDef> = {
    owner: {
      model: ownerMeta,
      direction: "in",
      relationship: "PUBLISHED",
      cardinality: "one",
      dtoKey: "owner",
      description: "The user who published/owns the underlying record.",
    },
  };

  // Default true — the package wire has always carried `author`. Apps whose
  // content has no distinct author (a360ai) switch it off via config.
  if (config?.serialiseAuthor !== false) {
    relationships.author = {
      model: authorMeta,
      direction: "in",
      relationship: "PUBLISHED",
      cardinality: "one",
      dtoKey: "author",
      description: "The user who authored the underlying record.",
    };
  }

  for (const relationship of config?.additionalRelationships ?? []) {
    relationships[relationship.model.nodeName] = {
      model: relationship.model,
      direction: relationship.direction,
      relationship: relationship.relationship,
      cardinality: relationship.cardinality,
      ...(relationship.dtoKey ? { dtoKey: relationship.dtoKey } : {}),
    };
  }

  const computed: NonNullable<EntitySchemaInput<Content>["computed"]> = {
    // Content carries no "contentType" property of its own — it is derived from
    // the underlying node's Neo4j label at read time (old mapper: `params.data.labels[0]`).
    contentType: {
      compute: (params) => params.data?.labels?.[0],
      meta: true,
      description:
        'The underlying Neo4j label of the record (e.g. "Article", "Document") — identifies which platform entity this content view represents.',
    },
    relevance: {
      compute: (params) => (params.record.has("totalScore") ? Number(params.record.get("totalScore")) : 0),
      meta: true,
      description:
        "Relevance score computed against a reference entity by the relevancy engine. 0 outside a relevance query.",
    },
  };

  for (const metaField of config?.metaFields ?? []) {
    computed[metaField.key] = {
      compute: (params) =>
        params.record.has(metaField.key) ? (params.record.get(metaField.key) ?? undefined) : undefined,
      meta: true,
      description: metaField.description,
    };
  }

  return defineEntity<Content>()({
    ...contentMeta,
    isCompanyScoped: true,

    description:
      "A generic, read-only view over any AI-summarised platform record. Used for cross-type search, listing by owner, and relevance ranking against another entity — Content is never created or updated directly.",

    chat: {
      summary: (d) => d.name ?? d.id,
      textSearchFields: ["name", "abstract", "tldr"],
    },

    fields: {
      name: {
        type: "string",
        required: true,
        description: "The title of the underlying record (document name, article title, etc.).",
      },
      abstract: {
        type: "string",
        description: "A short AI-generated abstract of the underlying record's content.",
      },
      tldr: {
        type: "string",
        description: "The AI-generated too-long-didn't-read summary of the underlying record.",
      },
      aiStatus: {
        type: "string",
        default: AiStatus.Pending,
        meta: true,
        description:
          "The AI processing status of the underlying record (e.g. pending, in_progress, completed, failed).",
      },
    },

    computed,

    relationships,
  });
}

/**
 * Content Entity Descriptor (no extension config).
 *
 * This is the descriptor to register in a graph catalog and to import from
 * consuming apps. The descriptor actually used for serialisation at runtime is
 * built by `ContentModule.forRoot()` from the module's configuration and
 * published through `modelRegistry` — read it with {@link getContentModel}.
 */
export const ContentDescriptor = buildContentDescriptor();

// Type export for the descriptor
export type ContentDescriptorType = typeof ContentDescriptor;

/**
 * Get the Content model from the registry.
 *
 * `ContentModule.forRoot()` registers the CONFIGURED model (extension
 * relationships, config-driven meta fields, optional author), so every read
 * path must resolve the model through the registry rather than capturing
 * {@link ContentDescriptor}.model at import time.
 */
export function getContentModel(): DataModelInterface<Content> {
  const model = modelRegistry.get(contentMeta.nodeName);
  if (!model) {
    throw new Error(`ContentModel not found in registry for nodeName: ${contentMeta.nodeName}`);
  }
  return model as DataModelInterface<Content>;
}
