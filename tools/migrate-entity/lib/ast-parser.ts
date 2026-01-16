/**
 * Entity Migration CLI - AST Parser Module
 *
 * Parses old-style entity files to extract configuration.
 * Uses regex-based parsing since files follow consistent patterns.
 */

import * as fs from "fs";
import {
  AliasModelInfo,
  CypherRelationship,
  CypherServiceWarning,
  OldEntityFiles,
  ParsedEntity,
  ParsedEntityType,
  ParsedField,
  ParsedMapper,
  ParsedMapperField,
  ParsedMeta,
  ParsedSerialiser,
  ParsedSerialiserAttribute,
  ParsedSerialiserRelationship,
  S3TransformInfo,
} from "./types";

/**
 * Parses all old entity files and returns structured data.
 */
export function parseOldFiles(files: OldEntityFiles): ParsedEntity {
  const meta = parseMetaFile(files.meta);
  const entityType = files.entity ? parseEntityFile(files.entity) : createEmptyEntityType(meta.labelName);
  const mapper = files.map ? parseMapFile(files.map) : null;
  const serialiser = files.serialiser ? parseSerialiserFile(files.serialiser) : null;
  const aliasModels = files.model ? parseAliasModels(files.model, meta.labelName) : [];

  return { meta, entityType, mapper, serialiser, aliasModels };
}

/**
 * Parses the meta.ts file to extract type, endpoint, nodeName, labelName.
 */
export function parseMetaFile(filePath: string): ParsedMeta {
  const content = fs.readFileSync(filePath, "utf-8");

  const type = extractStringProperty(content, "type") || "";
  const endpoint = extractStringProperty(content, "endpoint") || "";
  const nodeName = extractStringProperty(content, "nodeName") || "";
  const labelName = extractStringProperty(content, "labelName") || "";

  return { type, endpoint, nodeName, labelName };
}

/**
 * Parses the entity.ts file to extract type definition and fields.
 */
export function parseEntityFile(filePath: string): ParsedEntityType {
  const content = fs.readFileSync(filePath, "utf-8");

  // Extract entity name from "export type EntityName = Entity & {"
  const nameMatch = content.match(/export\s+type\s+(\w+)\s*=\s*Entity\s*&/);
  const name = nameMatch ? nameMatch[1] : "";

  // Extract fields from the type definition (both scalar and relationship)
  const { fields, relationshipFields } = extractTypeFields(content);

  // Extract imports
  const imports = extractImports(content);

  return { name, fields, relationshipFields, imports };
}

/**
 * Parses the map.ts file to extract field mappings.
 */
export function parseMapFile(filePath: string): ParsedMapper {
  const content = fs.readFileSync(filePath, "utf-8");

  const fields: ParsedMapperField[] = [];

  // Match field assignments like: name: params.data.name,
  const simpleFieldPattern = /(\w+):\s*params\.data\.(\w+),?/g;
  let match;
  while ((match = simpleFieldPattern.exec(content)) !== null) {
    fields.push({
      name: match[1],
      mapping: `params.data.${match[2]}`,
      isComputed: false,
    });
  }

  // Match computed fields like: relevance: params.record.has("totalScore") ? ...
  const computedPattern = /(\w+):\s*(params\.record\.has\([^)]+\)[^,]+),?/g;
  while ((match = computedPattern.exec(content)) !== null) {
    fields.push({
      name: match[1],
      mapping: match[2].trim(),
      isComputed: true,
    });
  }

  const imports = extractImports(content);

  return { fields, imports };
}

/**
 * Parses the serialiser.ts file to extract attributes, meta, relationships, services, and custom methods.
 */
export function parseSerialiserFile(filePath: string): ParsedSerialiser {
  const content = fs.readFileSync(filePath, "utf-8");

  const attributes = extractSerialiserAttributes(content);
  const meta = extractSerialiserMeta(content);
  const relationships = extractSerialiserRelationships(content);
  const imports = extractImports(content);
  const services = extractSerialiserServices(content);
  const customMethods = extractSerialiserCustomMethods(content);

  // Detect S3 transforms if S3Service is injected
  const s3Transforms = detectS3Transforms(content, attributes, services);

  return { attributes, meta, relationships, imports, services, customMethods, s3Transforms };
}

/**
 * Extracts type fields from entity type definition.
 * Returns both scalar fields and relationship fields separately.
 */
function extractTypeFields(content: string): { fields: ParsedField[]; relationshipFields: ParsedField[] } {
  const fields: ParsedField[] = [];
  const relationshipFields: ParsedField[] = [];

  // Find the type block: type Entity = Entity & { ... }
  const typeMatch = content.match(/=\s*Entity\s*&\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/s);
  if (!typeMatch) return { fields, relationshipFields };

  const typeBlock = typeMatch[1];

  // Match field definitions like: name: string; or name?: string;
  const fieldPattern = /(\w+)(\?)?:\s*([^;\n]+);?/g;
  let match;
  while ((match = fieldPattern.exec(typeBlock)) !== null) {
    const name = match[1];
    const optional = !!match[2];
    const type = match[3].trim();

    const field = { name, type, optional };

    // Separate relationship fields from scalar fields
    if (isRelationshipType(type)) {
      relationshipFields.push(field);
    } else {
      fields.push(field);
    }
  }

  return { fields, relationshipFields };
}

/**
 * Checks if a type is a relationship type (another entity or entity array).
 */
function isRelationshipType(type: string): boolean {
  // Skip: Company, User, User[], Topic[], etc.
  const relationshipPatterns = [
    /^Company$/,
    /^User$/,
    /^User\[\]$/,
    /^Topic\[\]?$/,
    /^Expertise\[\]?$/,
    /^[A-Z]\w+\[\]?$/, // Any PascalCase type or array
  ];

  return relationshipPatterns.some((pattern) => pattern.test(type));
}

/**
 * Extracts string property value from object literal.
 */
function extractStringProperty(content: string, property: string): string | null {
  const pattern = new RegExp(`${property}:\\s*["']([^"']+)["']`);
  const match = content.match(pattern);
  return match ? match[1] : null;
}

/**
 * Extracts import statements from file content.
 */
function extractImports(content: string): string[] {
  const imports: string[] = [];
  const importPattern = /^import\s+.*?from\s+["']([^"']+)["'];?$/gm;
  let match;
  while ((match = importPattern.exec(content)) !== null) {
    imports.push(match[0]);
  }
  return imports;
}

/**
 * Extracts serialiser attributes from this.attributes = {...}.
 */
function extractSerialiserAttributes(content: string): ParsedSerialiserAttribute[] {
  const attributes: ParsedSerialiserAttribute[] = [];

  // Match: this.attributes = { name: "name", content: "content", ... }
  const attrMatch = content.match(/this\.attributes\s*=\s*\{([^}]+)\}/s);
  if (!attrMatch) return attributes;

  const attrBlock = attrMatch[1];
  const fieldPattern = /(\w+):\s*["'](\w+)["']/g;
  let match;
  while ((match = fieldPattern.exec(attrBlock)) !== null) {
    attributes.push({
      name: match[1],
      mapping: match[2],
      isMeta: false,
    });
  }

  return attributes;
}

/**
 * Extracts serialiser meta from this.meta = {...}.
 */
function extractSerialiserMeta(content: string): ParsedSerialiserAttribute[] {
  const meta: ParsedSerialiserAttribute[] = [];

  // Match: this.meta = { aiStatus: "aiStatus", ... }
  const metaMatch = content.match(/this\.meta\s*=\s*\{([^}]+)\}/s);
  if (!metaMatch) return meta;

  const metaBlock = metaMatch[1];
  const fieldPattern = /(\w+):\s*["'](\w+)["']/g;
  let match;
  while ((match = fieldPattern.exec(metaBlock)) !== null) {
    meta.push({
      name: match[1],
      mapping: match[2],
      isMeta: true,
    });
  }

  return meta;
}

/**
 * Extracts serialiser relationships from this.relationships = {...}.
 */
function extractSerialiserRelationships(content: string): ParsedSerialiserRelationship[] {
  const relationships: ParsedSerialiserRelationship[] = [];

  // Match: this.relationships = { ... }
  const relMatch = content.match(/this\.relationships\s*=\s*\{([\s\S]*?)\};\s*$/m);
  if (!relMatch) return relationships;

  const relBlock = relMatch[1];

  // Match each relationship block:
  // author: { data: this.serialiserFactory.create(UserModel), }
  // or: user: { name: `editors`, data: this.serialiserFactory.create(UserModel), }
  const relPattern = /(\w+):\s*\{([^}]+)\}/g;
  let match;
  while ((match = relPattern.exec(relBlock)) !== null) {
    const name = match[1];
    const block = match[2];

    // Extract dtoKey from name: `editors` or name: "editors"
    const dtoKeyMatch = block.match(/name:\s*[`"'](\w+)[`"']/);
    const dtoKey = dtoKeyMatch ? dtoKeyMatch[1] : undefined;

    // Extract model from this.serialiserFactory.create(UserModel)
    // Also handles already-migrated entities: this.serialiserFactory.create(CompanyDescriptor.model)
    const modelMatch = block.match(/this\.serialiserFactory\.create\((\w+)(?:\.model)?\)/);
    const modelImport = modelMatch ? modelMatch[1] : "";

    relationships.push({ name, dtoKey, modelImport });
  }

  return relationships;
}

/**
 * Extracts injected services from the serialiser constructor.
 * Matches patterns like: private readonly s3Service: S3Service
 */
function extractSerialiserServices(content: string): string[] {
  const services: string[] = [];

  // Match: private readonly xxxService: XxxService (but not SerialiserFactory)
  const pattern = /private\s+readonly\s+\w+:\s+(\w+Service)/g;
  let match;
  while ((match = pattern.exec(content)) !== null) {
    const serviceName = match[1];
    // Skip SerialiserFactory - it's framework infrastructure, not app service
    if (serviceName !== "SerialiserFactory") {
      services.push(serviceName);
    }
  }

  return services;
}

/**
 * Extracts custom method names from the serialiser class.
 * These methods may contain transform logic that needs manual migration.
 */
function extractSerialiserCustomMethods(content: string): string[] {
  const customMethods: string[] = [];

  // Match method definitions: async methodName(...) or methodName(...)
  // Skip constructor, standard lifecycle methods, and standard serialiser methods
  const methodPattern = /(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{/g;
  const standardMethods = new Set([
    "constructor",
    "onModuleInit",
    "onModuleDestroy",
    // Standard serialiser methods from AbstractJsonApiSerialiser
    "type",
    "create",
    "endpoint",
    "endpointParameters",
    "id",
    "attributes",
    "meta",
    "links",
    "relationships",
  ]);

  let match;
  while ((match = methodPattern.exec(content)) !== null) {
    const methodName = match[1];
    if (!standardMethods.has(methodName)) {
      customMethods.push(methodName);
    }
  }

  return customMethods;
}

/**
 * Detects S3 transforms for URL fields when S3Service is injected.
 *
 * Uses naming conventions to identify fields that need S3 URL signing:
 * - Single URL fields: url, originalUrl, thumbnailUrl, imageUrl, photoUrl, fileUrl
 * - Array URL fields: samplePhotographs, photographs, urls, imageUrls, photoUrls
 */
function detectS3Transforms(
  content: string,
  attributes: ParsedSerialiserAttribute[],
  services: string[],
): S3TransformInfo[] {
  const transforms: S3TransformInfo[] = [];

  // Only detect transforms if S3Service is injected
  if (!services.includes("S3Service")) {
    return transforms;
  }

  // Check if there are S3-related custom methods (confirms S3 is actually used)
  const hasS3Methods =
    content.includes("s3Service") ||
    content.includes("S3Service") ||
    content.includes("generateSignedUrl") ||
    content.includes("getSignedUrl");

  if (!hasS3Methods) {
    return transforms;
  }

  // Single URL field patterns (case-insensitive matching)
  const singleUrlPatterns = [
    /^url$/i,
    /^originalUrl$/i,
    /^thumbnailUrl$/i,
    /^imageUrl$/i,
    /^photoUrl$/i,
    /^fileUrl$/i,
    /^coverUrl$/i,
    /^avatarUrl$/i,
    /^profileUrl$/i,
  ];

  // Array URL field patterns
  const arrayUrlPatterns = [
    /^samplePhotographs$/i,
    /^photographs$/i,
    /^urls$/i,
    /^imageUrls$/i,
    /^photoUrls$/i,
    /^fileUrls$/i,
    /^thumbnails$/i,
    /^images$/i,
    /^photos$/i,
  ];

  for (const attr of attributes) {
    const fieldName = attr.name;

    // Check for single URL patterns
    if (singleUrlPatterns.some((pattern) => pattern.test(fieldName))) {
      transforms.push({ fieldName, isArray: false });
      continue;
    }

    // Check for array URL patterns
    if (arrayUrlPatterns.some((pattern) => pattern.test(fieldName))) {
      transforms.push({ fieldName, isArray: true });
    }
  }

  return transforms;
}

/**
 * Creates an empty entity type when entity file doesn't exist.
 */
function createEmptyEntityType(labelName: string): ParsedEntityType {
  return {
    name: labelName,
    fields: [],
    relationshipFields: [],
    imports: [],
  };
}

/**
 * Parses alias models from the model file.
 *
 * Alias models are additional model exports that spread from the base model
 * but use a different meta. Example:
 *
 * ```typescript
 * export const UserModel: DataModelInterface<User> = {
 *   ...userMeta,
 *   // ...
 * };
 *
 * export const OwnerModel: DataModelInterface<User> = {
 *   ...UserModel,
 *   ...ownerMeta,
 * };
 * ```
 *
 * @param filePath Path to the model file
 * @param baseLabelName The label name of the base model (e.g., "User")
 * @returns Array of alias model info
 */
export function parseAliasModels(filePath: string, baseLabelName: string): AliasModelInfo[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const aliasModels: AliasModelInfo[] = [];

  // Pattern to match alias model definitions:
  // export const XxxModel: DataModelInterface<Entity> = {
  //   ...BaseModel,
  //   ...xxxMeta,
  // };
  // Note: Alias models spread from the base model AND override with their own meta
  const aliasPattern = /export\s+const\s+(\w+Model)\s*:\s*DataModelInterface<\w+>\s*=\s*\{[^}]*\.\.\.(\w+Model)[^}]*\.\.\.(\w+Meta)[^}]*\}/gs;

  let match;
  while ((match = aliasPattern.exec(content)) !== null) {
    const modelName = match[1];
    const baseModel = match[2];
    const metaName = match[3];

    // Skip the base model itself (it doesn't spread from another model)
    // Only include models that spread from the base model
    if (baseModel === `${baseLabelName}Model`) {
      // Derive descriptor name from model name: OwnerModel -> OwnerDescriptor
      const descriptorName = modelName.replace(/Model$/, "Descriptor");

      aliasModels.push({
        modelName,
        metaName,
        descriptorName,
      });
    }
  }

  return aliasModels;
}

/**
 * Parses Cypher MATCH patterns from a repository or cypher.service file
 * to extract actual relationship types and directions.
 *
 * Patterns parsed:
 * - MATCH (node)<-[:RELATIONSHIP]-(alias:Label)  → direction: "in"
 * - MATCH (node)-[:RELATIONSHIP]->(alias:Label)  → direction: "out"
 * - OPTIONAL MATCH variants
 *
 * @param filePath Path to repository.ts or cypher.service.ts file
 * @param entityNodeName The node name of the entity (e.g., "article", "glossary")
 * @returns Array of extracted relationships with correct types and directions
 */
export function parseCypherRelationships(filePath: string, entityNodeName: string): CypherRelationship[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const relationships: CypherRelationship[] = [];
  const seen = new Set<string>();

  // Pattern for incoming relationships: (entity)<-[:REL]-(alias:Label)
  // Handles complex template literals like ${documentMeta.nodeName}_${authorMeta.nodeName}:${userMeta.labelName}
  // Captures: [1]=relationship, [2]=full alias (may include templates), [3]=full label (may include templates)
  const incomingPattern =
    /\((?:\$\{[^}]+\}|\w+)\)\s*<-\[:(\w+)\]-\s*\(([^:)]+)(?::([^)]+))?\)/g;

  // Pattern for outgoing relationships: (entity)-[:REL]->(alias:Label)
  const outgoingPattern =
    /\((?:\$\{[^}]+\}|\w+)\)\s*-\[:(\w+)\]->\s*\(([^:)]+)(?::([^)]+))?\)/g;

  let match;

  // Extract incoming relationships
  while ((match = incomingPattern.exec(content)) !== null) {
    const relationshipType = match[1];
    const alias = match[2] || "";
    const label = match[3] || "";

    // Skip BELONGS_TO (company relationship, not a domain relationship)
    if (relationshipType === "BELONGS_TO") continue;

    // Derive relationship name from alias or label
    const name = deriveRelationshipName(alias, label, relationshipType);
    const key = `${name}-${relationshipType}-in`;

    if (!seen.has(key) && name) {
      seen.add(key);
      relationships.push({
        name,
        relationshipType,
        direction: "in",
        relatedLabel: label || inferLabelFromAlias(alias),
      });
    }
  }

  // Extract outgoing relationships
  while ((match = outgoingPattern.exec(content)) !== null) {
    const relationshipType = match[1];
    const alias = match[2] || "";
    const label = match[3] || "";

    // Skip BELONGS_TO (company relationship, not a domain relationship)
    if (relationshipType === "BELONGS_TO") continue;

    // Derive relationship name from alias or label
    const name = deriveRelationshipName(alias, label, relationshipType);
    const key = `${name}-${relationshipType}-out`;

    if (!seen.has(key) && name) {
      seen.add(key);
      relationships.push({
        name,
        relationshipType,
        direction: "out",
        relatedLabel: label || inferLabelFromAlias(alias),
      });
    }
  }

  return relationships;
}

/**
 * Extracts a name from a template literal or plain string.
 * E.g., "${authorMeta.nodeName}" -> "author", "${topicMeta.labelName}" -> "topic"
 */
function extractNameFromTemplate(value: string): string {
  if (!value) return "";

  // Trim whitespace
  value = value.trim();

  // Check for template literal pattern like ${xxxMeta.nodeName} or ${xxxMeta.labelName}
  const templateMatch = value.match(/\$\{(\w+)Meta\.\w+\}/);
  if (templateMatch) {
    return templateMatch[1].toLowerCase();
  }

  // Check for plain word
  if (/^\w+$/.test(value)) {
    return value.toLowerCase();
  }

  return "";
}

/**
 * Derives a camelCase relationship property name from alias, label, or relationship type.
 */
function deriveRelationshipName(alias: string, label: string, relationshipType: string): string {
  // First try to extract from the label (most reliable)
  const labelName = extractNameFromTemplate(label);
  if (labelName && labelName !== "user") {
    // Don't use "user" from label since it could be author/editor
    return labelName;
  }

  // Try to extract from the alias - look for the last template or word after underscore
  if (alias && alias.includes("_")) {
    // Pattern like ${documentMeta.nodeName}_${authorMeta.nodeName}
    const parts = alias.split("_");
    const lastPart = parts[parts.length - 1];
    const extracted = extractNameFromTemplate(lastPart);
    if (extracted) return extracted;
    // Fallback to plain text extraction
    if (/^\w+$/.test(lastPart)) return lastPart.toLowerCase();
  }

  // If label exists and is simple word, use lowercase version
  if (label && /^\w+$/.test(label)) {
    return label.toLowerCase();
  }

  // If alias exists and is simple, use it
  if (alias && !alias.includes("$")) {
    return alias.toLowerCase();
  }

  // Fallback: derive from relationship type (e.g., PUBLISHED -> published)
  return relationshipType.toLowerCase();
}

/**
 * Infers a label from an alias or label string.
 * Handles both plain strings and template literals.
 * E.g., "author" -> "User", "${topicMeta.labelName}" -> "Topic"
 */
function inferLabelFromAlias(value: string): string {
  // First try to extract from template literal
  const extracted = extractNameFromTemplate(value);
  const aliasLower = extracted || value.toLowerCase();

  // Common mappings
  const mappings: Record<string, string> = {
    author: "User",
    user: "User",
    editor: "User",
    topic: "Topic",
    expertise: "Expertise",
    company: "Company",
  };

  if (mappings[aliasLower]) {
    return mappings[aliasLower];
  }

  // Capitalize first letter
  if (extracted) {
    return extracted.charAt(0).toUpperCase() + extracted.slice(1);
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Finds and parses Cypher relationships from repository and cypher.service files.
 * Searches in the module's repositories/ and services/ directories.
 *
 * @param modulePath Path to the module directory (e.g., src/features/article)
 * @param entityNodeName The node name of the entity
 * @returns Combined relationships from all Cypher files found
 */
export function findAndParseCypherRelationships(modulePath: string, entityNodeName: string): CypherRelationship[] {
  const relationships: CypherRelationship[] = [];
  const seen = new Set<string>();

  // Look for cypher.service.ts files in services/
  const servicesDir = `${modulePath}/services`;
  if (fs.existsSync(servicesDir)) {
    const serviceFiles = fs.readdirSync(servicesDir);
    for (const file of serviceFiles) {
      if (file.includes("cypher.service.ts")) {
        const rels = parseCypherRelationships(`${servicesDir}/${file}`, entityNodeName);
        for (const rel of rels) {
          const key = `${rel.name}-${rel.relationshipType}-${rel.direction}`;
          if (!seen.has(key)) {
            seen.add(key);
            relationships.push(rel);
          }
        }
      }
    }
  }

  // Look for repository.ts files in repositories/
  const reposDir = `${modulePath}/repositories`;
  if (fs.existsSync(reposDir)) {
    const repoFiles = fs.readdirSync(reposDir);
    for (const file of repoFiles) {
      if (file.endsWith(".repository.ts")) {
        const rels = parseCypherRelationships(`${reposDir}/${file}`, entityNodeName);
        for (const rel of rels) {
          const key = `${rel.name}-${rel.relationshipType}-${rel.direction}`;
          if (!seen.has(key)) {
            seen.add(key);
            relationships.push(rel);
          }
        }
      }
    }
  }

  return relationships;
}

/**
 * Detects custom logic in cypher.service.ts that needs manual migration.
 * Looks for:
 * - returnStatement with custom parameters (useTotalScore, etc.)
 * - userHasAccess with custom parameters
 * - Other custom methods beyond the standard ones
 *
 * @param modulePath Path to the module directory
 * @returns Array of warnings about custom logic that needs migration
 */
export function detectCypherServiceWarnings(modulePath: string): CypherServiceWarning[] {
  const warnings: CypherServiceWarning[] = [];

  const servicesDir = `${modulePath}/services`;
  if (!fs.existsSync(servicesDir)) {
    return warnings;
  }

  const serviceFiles = fs.readdirSync(servicesDir);
  for (const file of serviceFiles) {
    if (!file.includes("cypher.service.ts")) continue;

    const filePath = `${servicesDir}/${file}`;
    const content = fs.readFileSync(filePath, "utf-8");

    // Check for returnStatement with custom parameters
    const returnStatementMatch = content.match(/returnStatement\s*=?\s*\(\s*params\s*\?\s*:\s*\{([^}]+)\}/);
    if (returnStatementMatch) {
      const params = returnStatementMatch[1];
      // Extract parameter names
      const paramNames = params.match(/(\w+)\s*\??\s*:/g)?.map((p) => p.replace(/[?:]/g, "").trim()) || [];

      if (paramNames.length > 0) {
        warnings.push({
          filePath,
          type: "returnStatementParams",
          description: `returnStatement() has custom parameters: ${paramNames.join(", ")}`,
          action: `Override buildReturnStatement() in repository to handle: ${paramNames.join(", ")}. See MIGRATION-GUIDE.md "CRITICAL: Handling cypher.service.ts Files" section.`,
        });
      }
    }

    // Check for userHasAccess with custom parameters (beyond standard ones)
    const userHasAccessMatch = content.match(/userHasAccess\s*=?\s*\(\s*params\s*\?\s*:\s*\{([^}]+)\}/);
    if (userHasAccessMatch) {
      const params = userHasAccessMatch[1];
      const paramNames = params.match(/(\w+)\s*\??\s*:/g)?.map((p) => p.replace(/[?:]/g, "").trim()) || [];

      if (paramNames.length > 0) {
        warnings.push({
          filePath,
          type: "userHasAccessParams",
          description: `userHasAccess() has custom parameters: ${paramNames.join(", ")}`,
          action: `Review if these parameters affect query building. May need custom repository logic.`,
        });
      }
    }

    // Check for computed aggregations in return statement (totalScore, COUNT, SUM, etc.)
    if (content.includes("totalScore") || /\b(COUNT|SUM|AVG|COLLECT)\s*\(/.test(content)) {
      const hasRelevanceComputed = content.includes("totalScore");
      const hasAggregations = /\b(COUNT|SUM|AVG|COLLECT)\s*\(/.test(content);

      if (hasRelevanceComputed || hasAggregations) {
        const details: string[] = [];
        if (hasRelevanceComputed) details.push("totalScore (relevance scoring)");
        if (hasAggregations) details.push("aggregation functions");

        // Only warn if not already covered by returnStatementParams
        if (!warnings.some((w) => w.filePath === filePath && w.type === "returnStatementParams")) {
          warnings.push({
            filePath,
            type: "customMethod",
            description: `Contains computed values: ${details.join(", ")}`,
            action: `Ensure descriptor has computed field for relevance. If aggregations are used beyond relevancy module, override buildReturnStatement().`,
          });
        }
      }
    }
  }

  return warnings;
}
