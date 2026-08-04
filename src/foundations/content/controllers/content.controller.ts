import { Controller, Get, Param, Query, Req, Res, UseGuards } from "@nestjs/common";
import { FastifyReply } from "fastify";

import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { AuthenticatedRequest } from "../../../common/interfaces/authenticated.request.interface";
import { Content, getContentModel } from "../../content/entities/content";
import { contentMeta } from "../../content/entities/content.meta";
import { ContentCypherService } from "../../content/services/content.cypher.service";
import { ContentService } from "../../content/services/content.service";
import { RelevancyService } from "../../relevancy/services/relevancy.service";
import { authorMeta, ownerMeta } from "../../user/entities/user.meta";

@UseGuards(JwtAuthGuard)
@Controller()
export class ContentController {
  constructor(
    private readonly contentService: ContentService,
    private readonly relevancyService: RelevancyService<Content>,
    private readonly cypherService: ContentCypherService,
  ) {}

  @Get(contentMeta.endpoint)
  async findContents(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Query() query: any,
    @Query("search") search?: string,
    @Query("fetchAll") fetchAll?: boolean,
    @Query("orderBy") orderBy?: string,
    @Query("contentIds") contentIds?: string,
  ) {
    let response;
    if (contentIds) {
      response = await this.contentService.findByIds({ contentIds: contentIds.split(",") });
    } else {
      response = await this.contentService.find({
        term: search,
        query: query,
        fetchAll: fetchAll,
        orderBy: orderBy,
      });
    }

    reply.send(response);
  }

  @Get(`${ownerMeta.endpoint}/:ownerId/${contentMeta.endpoint}`)
  async findByOwner(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("ownerId") ownerId: string,
    @Query() query: any,
    @Query("search") search?: string,
    @Query("fetchAll") fetchAll?: boolean,
    @Query("orderBy") orderBy?: string,
  ) {
    const response = await this.contentService.findByOwner({
      ownerId: ownerId,
      term: search,
      query: query,
      fetchAll: fetchAll,
      orderBy: orderBy,
    });

    reply.send(response);
  }

  @Get(`${authorMeta.endpoint}/:authorId/${contentMeta.endpoint}`)
  async findByAuthor(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("authorId") authorId: string,
    @Query() query: any,
    @Query("search") search?: string,
    @Query("fetchAll") fetchAll?: boolean,
    @Query("orderBy") orderBy?: string,
  ) {
    const response = await this.contentService.findByOwner({
      ownerId: authorId,
      term: search,
      query: query,
      fetchAll: fetchAll,
      orderBy: orderBy,
    });

    reply.send(response);
  }

  @Get(`${contentMeta.endpoint}/:contentId/relevance`)
  async findContentsRelevantForContent(@Query() query: any, @Param("contentId") contentId: string) {
    return await this.relevancyService.findRelevant({
      model: getContentModel(),
      cypherService: this.cypherService,
      id: contentId,
      query: query,
    });
  }
}
