import { FastifyReply } from "fastify";
import { AbstractService, JsonApiDTOData } from "../../core/neo4j/abstracts/abstract.service";

/**
 * Standard query parameters for list operations
 */
export interface ListQueryParams {
  query: any;
  search?: string;
  fetchAll?: boolean;
  orderBy?: string;
}

/**
 * Creates handler functions for standard CRUD operations.
 * Controllers call these from their decorated methods, delegating
 * the actual logic while retaining their route and cross-cutting decorators.
 *
 * @param getService - Lambda returning the service instance (for DI compatibility)
 * @returns Object with findAll, findById, create, update, patch, delete handlers
 *
 * @example
 * ```typescript
 * @Controller()
 * export class CullController {
 *   private readonly crud = createCrudHandlers(() => this.cullService);
 *
 *   constructor(private readonly cullService: CullService) {}
 *
 *   @Get(endpoint)
 *   async findAll(@Res() reply, @Query() query, @Query("search") search?, ...) {
 *     return this.crud.findAll(reply, { query, search, fetchAll, orderBy });
 *   }
 *
 *   @Put(`${endpoint}/:id`)
 *   @ValidateId("id")
 *   @CacheInvalidate(meta, "id")
 *   async update(@Res() reply, @Body() body: PutDTO) {
 *     return this.crud.update(reply, body);
 *   }
 * }
 * ```
 */
export function createCrudHandlers<TService extends AbstractService<any, any>>(getService: () => TService) {
  return {
    /**
     * Handle findAll requests with standard pagination/search
     */
    async findAll(reply: FastifyReply, params: ListQueryParams): Promise<void> {
      const response = await getService().find({
        term: params.search,
        query: params.query,
        fetchAll: params.fetchAll,
        orderBy: params.orderBy,
      });
      reply.send(response);
    },

    /**
     * Handle findById requests
     */
    async findById(reply: FastifyReply, id: string): Promise<void> {
      const response = await getService().findById({ id });
      reply.send(response);
    },

    /**
     * Handle create requests from JSON:API DTO
     */
    async create(reply: FastifyReply, body: { data: any }): Promise<void> {
      const response = await getService().createFromDTO({
        data: body.data as unknown as JsonApiDTOData,
      });
      reply.send(response);
    },

    /**
     * Handle update (PUT) requests from JSON:API DTO
     */
    async update(reply: FastifyReply, body: { data: any }): Promise<void> {
      const response = await getService().putFromDTO({
        data: body.data as unknown as JsonApiDTOData,
      });
      reply.send(response);
    },

    /**
     * Handle partial update (PATCH) requests from JSON:API DTO
     */
    async patch(reply: FastifyReply, body: { data: any }): Promise<void> {
      const response = await getService().patchFromDTO({
        data: body.data as unknown as JsonApiDTOData,
      });
      reply.send(response);
    },

    /**
     * Handle delete requests
     */
    async delete(reply: FastifyReply, id: string): Promise<void> {
      await getService().delete({ id });
      reply.send();
    },
  };
}
