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
  Res,
  UseGuards,
} from "@nestjs/common";
import { FastifyReply } from "fastify";
import { Audit } from "../../../common/decorators/audit.decorator";
import { CacheInvalidate } from "../../../common/decorators/cache-invalidate.decorator";
import { ValidateId } from "../../../common/decorators/validate-id.decorator";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { createCrudHandlers } from "../../../common/handlers/crud.handlers";
import { createRelationshipHandlers } from "../../../common/handlers/relationship.handlers";
import { AuditService } from "../../audit/services/audit.service";
import { CacheService } from "../../../core/cache/services/cache.service";
import { authorMeta } from "../../user/entities/user.meta";
import { HowToPostDTO } from "../dtos/how-to.post.dto";
import { HowToPutDTO } from "../dtos/how-to.put.dto";
import { HowToDescriptor } from "../entities/how-to";
import { howToMeta } from "../entities/how-to.meta";
import { HowToService } from "../services/how-to.service";

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
  async findById(@Res() reply: FastifyReply, @Param("howToId") howToId: string) {
    return this.crud.findById(reply, howToId);
  }

  @Post(howToMeta.endpoint)
  @CacheInvalidate(howToMeta)
  async create(@Res() reply: FastifyReply, @Body() body: HowToPostDTO) {
    const response = await this.crud.create(reply, body);

    // Queue for AI processing after creation
    await this.howToService.queueHowToForProcessing({
      howToId: body.data.id,
      description: body.data.attributes.description,
    });

    return response;
  }

  @Put(`${howToMeta.endpoint}/:howToId`)
  @ValidateId("howToId")
  @CacheInvalidate(howToMeta, "howToId")
  async update(@Res() reply: FastifyReply, @Body() body: HowToPutDTO) {
    const response = await this.crud.update(reply, body);

    // Re-queue for AI processing after update
    await this.howToService.queueHowToForProcessing({
      howToId: body.data.id,
      description: body.data.attributes.description,
    });

    return response;
  }

  @Delete(`${howToMeta.endpoint}/:howToId`)
  @HttpCode(HttpStatus.NO_CONTENT)
  @CacheInvalidate(howToMeta, "howToId")
  async delete(@Res() reply: FastifyReply, @Param("howToId") howToId: string) {
    return this.crud.delete(reply, howToId);
  }

  @Get(`${authorMeta.endpoint}/:authorId/${howToMeta.endpoint}`)
  async findByAuthor(
    @Res() reply: FastifyReply,
    @Param("authorId") authorId: string,
    @Query() query: any,
    @Query("search") search?: string,
    @Query("fetchAll") fetchAll?: boolean,
    @Query("orderBy") orderBy?: string,
  ) {
    return this.relationships.findByRelated(reply, {
      relationship: HowToDescriptor.relationshipKeys.author,
      id: authorId,
      query,
      search,
      fetchAll,
      orderBy,
    });
  }
}
