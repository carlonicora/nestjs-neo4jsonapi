import { DescriptorRelationship, NestedRoute } from "../types/template-data.interface";
import { toPascalCase } from "./name-transformer";

/**
 * Generate nested route configurations for all relationships
 *
 * Nested routes allow querying entities by their relationships.
 * For example: GET /discussions/:discussionId/comments
 *
 * NOTE: Routes are NOT generated for relationships with contextKey (e.g., Author)
 * because these are system-set and not queryable by users.
 *
 * @param relationships - Array of descriptor relationships
 * @param thisEntity - Current entity info (endpoint and nodeName)
 * @returns Array of nested route configurations
 */
export function generateNestedRoutes(
  relationships: DescriptorRelationship[],
  thisEntity: { endpoint: string; nodeName: string }
): NestedRoute[] {
  return relationships
    .filter((rel) => {
      // Skip relationships with contextKey (like Author)
      // These are set by the system and not queryable
      return !rel.contextKey;
    })
    .map((rel) => {
      const relatedName = rel.relatedEntity.camelCase;
      const relatedMeta = rel.model;

      return {
        // Path template using descriptor endpoint
        // Example: ${discussionMeta.endpoint}/:discussionId/${CommentDescriptor.model.endpoint}
        path: `\${${relatedMeta}.endpoint}/:${relatedName}Id/\${${thisEntity.nodeName}Descriptor.model.endpoint}`,

        // Method name: findByDiscussion, findByTopic, etc.
        methodName: `findBy${toPascalCase(rel.key)}`,

        // Relationship key used in findByRelated call
        // Must match the key in the descriptor's relationships
        relationshipKey: rel.key,

        // Parameter name in route: discussionId, topicId, etc.
        paramName: `${relatedName}Id`,

        // Meta import name: discussionMeta, topicMeta, etc.
        relatedMeta: relatedMeta,
      };
    });
}

/**
 * Check if a relationship should have a nested route
 *
 * @param rel - Descriptor relationship
 * @returns true if nested route should be generated
 */
export function shouldGenerateNestedRoute(rel: DescriptorRelationship): boolean {
  // Don't generate for contextKey relationships (Author)
  return !rel.contextKey;
}
