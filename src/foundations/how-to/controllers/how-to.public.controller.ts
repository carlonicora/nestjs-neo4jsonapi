import { Controller, Get, Param, Query, Res } from "@nestjs/common";
import { FastifyReply } from "fastify";
import { howToMeta } from "../entities/how-to.meta";
import { HowToService } from "../services/how-to.service";

/**
 * Unauthenticated read surface for PUBLISHED help articles (draft = false).
 * Auth in this package is per-controller; omitting JwtAuthGuard makes these routes public.
 *
 * OPT-IN ONLY: this controller is registered exclusively by
 * `HowToModule.forRoot({ publicRoutes: true })`. Importing `HowToModule`
 * statically — or calling `forRoot()` with no arguments — mounts the
 * authenticated `HowToController` alone, so no consumer publishes its guides by
 * accident. The read filter is `draft IS NULL OR draft = false`, which means a
 * guide created without a `draft` property is served here.
 */
@Controller()
export class HowToPublicController {
  constructor(private readonly howToService: HowToService) {}

  @Get(`public/${howToMeta.endpoint}`)
  async findPublished(@Res() reply: FastifyReply, @Query() query: any, @Query("type") type?: string) {
    const response = await this.howToService.findPublishedList({ query, howToType: type });
    reply.send(response);
  }

  @Get(`public/${howToMeta.endpoint}/:howToType/:slug`)
  async findArticle(@Res() reply: FastifyReply, @Param("howToType") howToType: string, @Param("slug") slug: string) {
    const response = await this.howToService.findPublishedArticle({ howToType, slug });
    reply.send(response);
  }

  @Get(`public/${howToMeta.endpoint}/:howToType/:slug/related`)
  async findRelated(
    @Res() reply: FastifyReply,
    @Param("howToType") howToType: string,
    @Param("slug") slug: string,
    @Query() query: any,
  ) {
    const response = await this.howToService.findRelatedList({ howToType, slug, query });
    reply.send(response);
  }
}
