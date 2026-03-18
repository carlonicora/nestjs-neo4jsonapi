import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { FastifyReply } from "fastify";
import {
  Audit,
  AuditService,
  AuthenticatedRequest,
  CacheInvalidate,
  CacheService,
  createCrudHandlers,
  createRelationshipHandlers,
  JwtAuthGuard,
  ValidateId,
} from "@carlonicora/nestjs-neo4jsonapi";
import { userMeta } from "@carlonicora/nestjs-neo4jsonapi";

import { HowToPostDTO } from "src/features/essentials/how-to/dtos/how-to.post.dto";
import { HowToPutDTO } from "src/features/essentials/how-to/dtos/how-to.put.dto";
import { HowToDescriptor } from "src/features/essentials/how-to/entities/how-to";
import { howToMeta } from "src/features/essentials/how-to/entities/how-to.meta";
import { HowToService } from "src/features/essentials/how-to/services/how-to.service";

@UseGuards(JwtAuthGuard)
@Controller()
export class HowToController {
  private readonly crud = createCrudHandlers(() => this.howToService);
  private readonly relationships = createRelationshipHandlers(() => this.howToService);

  constructor(
    private readonly howToService: HowToService,
    private readonly cacheService: CacheService,
    private readonly auditService: AuditService,
  ) {}

  @Get(howToMeta.endpoint)
  async findAll(
    @Res() reply: FastifyReply,
    @Query() query: any,
    @Query("search") search?: string,
    @Query("fetchAll") fetchAll?: boolean,
    @Query("orderBy") orderBy?: string,
  ) {
    return this.crud.findAll(reply, { query, search, fetchAll, orderBy });
  }

  @Get(`${howToMeta.endpoint}/:howToId`)
  @Audit(howToMeta, "howToId")
  async findById(@Req() request: AuthenticatedRequest, @Res() reply: FastifyReply, @Param("howToId") howToId: string) {
    return this.crud.findById(reply, howToId);
  }

  @Post(howToMeta.endpoint)
  @CacheInvalidate(howToMeta)
  async create(@Res() reply: FastifyReply, @Body() body: HowToPostDTO) {
    return this.crud.create(reply, body);
  }

  @Put(`${howToMeta.endpoint}/:howToId`)
  @ValidateId("howToId")
  @CacheInvalidate(howToMeta, "howToId")
  async update(@Req() request: AuthenticatedRequest, @Res() reply: FastifyReply, @Body() body: HowToPutDTO) {
    return this.crud.update(reply, body);
  }

  @Delete(`${howToMeta.endpoint}/:howToId`)
  @HttpCode(HttpStatus.NO_CONTENT)
  @CacheInvalidate(howToMeta, "howToId")
  async delete(@Req() request: AuthenticatedRequest, @Res() reply: FastifyReply, @Param("howToId") howToId: string) {
    return this.crud.delete(reply, howToId);
  }

  @Get(`${userMeta.endpoint}/:userId/${HowToDescriptor.model.endpoint}`)
  async findByAuthor(
    @Res() reply: FastifyReply,
    @Param("userId") userId: string,
    @Query() query: any,
    @Query("search") search?: string,
    @Query("fetchAll") fetchAll?: boolean,
    @Query("orderBy") orderBy?: string,
  ) {
    return this.relationships.findByRelated(reply, {
      relationship: HowToDescriptor.relationshipKeys.author,
      id: userId,
      query,
      search,
      fetchAll,
      orderBy,
    });
  }
}
