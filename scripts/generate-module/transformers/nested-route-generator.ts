import { DescriptorRelationship, NestedRoute } from "../types/template-data.interface";
import { toCamelCase, toPascalCase } from "./name-transformer";

/**
 * Generate nested route configurations for all relationships
 *
 * Nested routes allow querying entities by their relationships.
 * For example: GET /discussions/:discussionId/comments
 *
 * NOTE: Routes are NOT generated for relationships with contextKey (e.g., Author)
 * because these are system-set and not queryable by users.
 *
 * When a relationship has an alias (e.g., CreatedBy targeting User), the route uses
 * the alias-specific meta endpoint instead of the base entity meta, producing unique
 * paths like GET /created-by/:createdById/tasks instead of GET /users/:userId/tasks.
 *
 * @param relationships - Array of descriptor relationships
 * @param thisEntity - Current entity info (endpoint and nodeName)
 * @returns Array of nested route configurations
 */
export function generateNestedRoutes(
  relationships: DescriptorRelationship[],
  thisEntity: { endpoint: string; nodeName: string },
  conflictingAliases?: Set<string>
): NestedRoute[] {
  return relationships
    .filter((rel) => {
      // Skip relationships with contextKey (like Author)
      // These are set by the system and not queryable
      return !rel.contextKey;
    })
    .map((rel) => {
      // Only use alias routing when the alias conflicts with another alias targeting the same entity
      const hasAlias = !!rel.alias && (conflictingAliases?.has(rel.alias) ?? false);
      const aliasMetaName = hasAlias ? `${toCamelCase(rel.alias!)}Meta` : undefined;

      // For aliases: use alias camelCase (e.g., "createdBy") as the route param base
      // For non-aliases: use the related entity camelCase (e.g., "user")
      const relatedName = hasAlias ? toCamelCase(rel.alias!) : rel.relatedEntity.camelCase;
      const relatedMeta = rel.model;

      // Determine the endpoint accessor expression
      let endpointAccess: string;
      if (hasAlias) {
        // Alias: use the alias meta from the entity's own meta file
        endpointAccess = `${aliasMetaName}.endpoint`;
      } else if (rel.isNewStructure) {
        endpointAccess = `${rel.descriptorName}.model.endpoint`;
      } else {
        endpointAccess = `${relatedMeta}.endpoint`;
      }

      // The current entity's Descriptor name (PascalCase)
      const thisEntityDescriptor = `${toPascalCase(thisEntity.nodeName)}Descriptor`;

      return {
        // Path template using descriptor endpoint
        // Standard: ${discussionMeta.endpoint}/:discussionId/${CommentDescriptor.model.endpoint}
        // Alias:    ${createdByMeta.endpoint}/:createdById/${TaskDescriptor.model.endpoint}
        path: `\${${endpointAccess}}/:${relatedName}Id/\${${thisEntityDescriptor}.model.endpoint}`,

        // Method name: findByDiscussion, findByCreatedBy, etc.
        methodName: `findBy${toPascalCase(rel.key)}`,

        // Relationship key used in findByRelated call
        // Must match the key in the descriptor's relationships
        relationshipKey: rel.key,

        // Parameter name in route: discussionId, createdById, etc.
        paramName: `${relatedName}Id`,

        // Meta import name (for OLD structure) or endpoint access expression
        relatedMeta: relatedMeta,

        // NEW structure support
        isNewStructure: rel.isNewStructure,
        descriptorName: rel.descriptorName,
        importPath: rel.importPath,

        // Alias support - alias meta is imported from own meta file
        aliasMetaName,
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
