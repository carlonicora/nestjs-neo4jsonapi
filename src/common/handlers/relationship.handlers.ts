import { FastifyReply } from "fastify";
import { AbstractService } from "../../core/neo4j/abstracts/abstract.service";

/**
 * Parameters for findByRelated queries
 */
export interface RelatedQueryParams {
  relationship: string;
  id: string | string[];
  query: any;
  search?: string;
  fetchAll?: boolean;
  orderBy?: string;
}

/**
 * Creates handlers for relationship-based queries and operations.
 * Used for controllers that need to query entities by related entity ID
 * or manage to-many relationships.
 *
 * @param getService - Lambda returning the service instance
 * @returns Object with findByRelated, addToRelationship, removeFromRelationship handlers
 *
 * @example
 * ```typescript
 * @Controller()
 * export class GalleryController {
 *   private readonly relationships = createRelationshipHandlers(() => this.galleryService);
 *
 *   constructor(private readonly galleryService: GalleryService) {}
 *
 *   @Get(`${ownerMeta.endpoint}/:userId/${GalleryDescriptor.model.endpoint}`)
 *   async findByOwner(@Res() reply, @Param("userId") userId, @Query() query, ...) {
 *     return this.relationships.findByRelated(reply, {
 *       relationship: GalleryDescriptor.relationshipKeys.owner,
 *       id: userId, query, search, fetchAll, orderBy,
 *     });
 *   }
 *
 *   @Post(`${galleryMeta.endpoint}/:galleryId/${photographMeta.endpoint}`)
 *   async addPhotographs(@Res() reply, @Param("galleryId") galleryId, @Body() body) {
 *     return this.relationships.addToRelationship(
 *       reply, galleryId, GalleryDescriptor.relationshipKeys.photograph, body.data
 *     );
 *   }
 * }
 * ```
 */
export function createRelationshipHandlers<TService extends AbstractService<any, any>>(getService: () => TService) {
  return {
    /**
     * Find entities by a related entity ID
     */
    async findByRelated(reply: FastifyReply, params: RelatedQueryParams): Promise<void> {
      const response = await getService().findByRelated({
        relationship: params.relationship as any,
        id: params.id,
        term: params.search,
        query: params.query,
        fetchAll: params.fetchAll,
        orderBy: params.orderBy,
      });
      reply.send(response);
    },

    /**
     * Add items to a to-many relationship
     */
    async addToRelationship(reply: FastifyReply, entityId: string, relationship: string, data: any): Promise<void> {
      const response = await getService().addToRelationshipFromDTO({
        id: entityId,
        relationship: relationship as any,
        data,
      });
      reply.send(response);
    },

    /**
     * Remove items from a to-many relationship
     */
    async removeFromRelationship(
      reply: FastifyReply,
      entityId: string,
      relationship: string,
      data: any[],
    ): Promise<void> {
      const response = await getService().removeFromRelationshipFromDTO({
        id: entityId,
        relationship: relationship as any,
        data,
      });
      reply.send(response);
    },
  };
}
