/**
 * Template Data Interfaces
 *
 * Type definitions for data passed to code generation templates.
 */

/**
 * Name transformations for different casing conventions
 */
export interface NameTransforms {
  pascalCase: string; // "Comment"
  camelCase: string; // "comment"
  kebabCase: string; // "comment"
  pluralKebab: string; // "comments"
}

/**
 * Import statement for templates
 */
export interface ImportStatement {
  path: string;
  items: string[];
}

/**
 * Processed field for templates
 */
export interface TemplateField {
  name: string;
  type: string;
  required: boolean;
  tsType: string; // TypeScript type
}

/**
 * Processed relationship for entity descriptor
 */
export interface DescriptorRelationship {
  key: string; // Relationship key in descriptor (e.g., "author", "discussion")
  model: string; // Model import name (e.g., "authorMeta" or "CharacterDescriptor.model")
  direction: "in" | "out";
  relationship: string; // Neo4j relationship name (e.g., "PUBLISHED")
  cardinality: "one" | "many";
  contextKey?: string; // e.g., "userId" for Author
  dtoKey?: string; // e.g., "editors", "topics"
  required: boolean;
  relatedEntity: {
    name: string; // e.g., "User"
    directory: string; // e.g., "foundations"
    pascalCase: string;
    camelCase: string;
    kebabCase: string;
  };
  // NEW structure support
  isNewStructure: boolean; // True if related entity uses Descriptor pattern (no .meta.ts file)
  descriptorName?: string; // e.g., "CharacterDescriptor" (only for NEW structure)
  importPath?: string; // Import path for NEW structure entities
  // Relationship property fields (stored on the edge)
  fields?: TemplateField[]; // Only supported when cardinality: "one"
  // If true, relationship is set only on creation and skipped during PUT
  immutable?: boolean;
}

/**
 * Nested route configuration
 */
export interface NestedRoute {
  path: string; // e.g., "${discussionMeta.endpoint}/:discussionId/${CommentDescriptor.model.endpoint}"
  methodName: string; // e.g., "findByDiscussion"
  relationshipKey: string; // e.g., "discussion"
  paramName: string; // e.g., "discussionId"
  relatedMeta: string; // e.g., "discussionMeta" or "CharacterDescriptor.model"
  // NEW structure support
  isNewStructure: boolean; // True if related entity uses Descriptor pattern
  descriptorName?: string; // e.g., "CharacterDescriptor" (only for NEW structure)
  importPath?: string; // Import path for NEW structure entities
}

/**
 * DTO field configuration
 */
export interface DTOField {
  name: string;
  type: string; // TypeScript type
  isOptional: boolean;
  decorators: string[]; // e.g., ["@IsDefined()", "@IsString()"]
}

/**
 * DTO relationship configuration
 */
export interface DTORelationship {
  key: string; // e.g., "discussion", "replies"
  dtoClass: string; // e.g., "DiscussionDataDTO", "CommentDataListDTO"
  isList: boolean;
  isOptional: boolean;
  importPath: string;
  // NEW structure support
  isNewStructure: boolean; // True if related entity uses Descriptor pattern
}

/**
 * Complete template data passed to all templates
 */
export interface TemplateData {
  // Entity metadata
  names: NameTransforms;
  endpoint: string;
  labelName: string;
  nodeName: string;

  // Configuration
  isCompanyScoped: boolean;
  targetDir: string;

  // Fields
  fields: TemplateField[];

  // Relationships
  relationships: DescriptorRelationship[];

  // Imports (deduplicated)
  libraryImports: ImportStatement[];
  entityImports: ImportStatement[];
  metaImports: ImportStatement[];
  dtoImports: ImportStatement[];

  // Nested routes
  nestedRoutes: NestedRoute[];

  // DTO-specific data
  dtoFields: DTOField[];
  postDtoRelationships: DTORelationship[];
  putDtoRelationships: DTORelationship[];
}
