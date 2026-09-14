import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import { FastifyReply } from "fastify";
import { CacheInvalidate } from "../../../common/decorators/cache-invalidate.decorator";
import { AdminJwtAuthGuard } from "../../../common/guards/jwt.auth.admin.guard";
import { createCrudHandlers } from "../../../common/handlers/crud.handlers";
import { CacheService } from "../../../core/cache/services/cache.service";
import { HandbookThreadMessagePostDTO } from "../dtos/handbook-thread-message-post.dto";
import { HandbookThreadPatchDTO } from "../dtos/handbook-thread-patch.dto";
import { HandbookThreadPostDTO } from "../dtos/handbook-thread-post.dto";
import { handbookThreadMeta } from "../entities/handbook-thread.meta";
import { handbookThreadMessageMeta } from "../entities/handbook-thread-message.meta";
import { HandbookThreadService } from "../services/handbook-thread.service";

/**
 * Persisted handbook conversations.
 *
 * Developer documentation is administrator-only, enforced HERE and not merely
 * by whatever admin layout a consumer's frontend happens to have.
 * `AdminJwtAuthGuard` pushes the Administrator role into the required-roles set
 * for every handler (common/guards/jwt.auth.admin.guard.ts — `_validateRoles`),
 * so the read routes are gated too. No handler declares a guard of its own: a
 * handler-level `@UseGuards` is the usual way a route quietly loses the admin
 * check.
 *
 * Every mutation invalidates the whole `handbookthreads` type rather than one
 * element: a new message reorders the list (the thread list is sorted by
 * `updatedAt DESC`), so invalidating the single thread would leave a stale list
 * cached.
 */
@UseGuards(AdminJwtAuthGuard)
@Controller()
export class HandbookThreadController {
  private readonly crud = createCrudHandlers(() => this.handbookThreadService);

  constructor(
    private readonly handbookThreadService: HandbookThreadService,
    private readonly cacheService: CacheService,
  ) {}

  /**
   * GET /handbookthreads — the current user's threads, most recently updated
   * first. Owner scoping is enforced by the repository's `buildUserHasAccess`
   * override, and the ordering is the descriptor default (`updatedAt DESC`).
   */
  @Get(handbookThreadMeta.endpoint)
  async findAll(
    @Res() reply: FastifyReply,
    @Query() query: any,
    @Query("search") search?: string,
    @Query("fetchAll") fetchAll?: boolean,
    @Query("orderBy") orderBy?: string,
  ) {
    return this.crud.findAll(reply, { query, search, fetchAll, orderBy });
  }

  /**
   * POST /handbookthreads — start a thread from its first question. The
   * response is the thread with both messages of the opening turn included,
   * so the client renders the new conversation without a second call.
   */
  @Post(handbookThreadMeta.endpoint)
  @CacheInvalidate(handbookThreadMeta)
  async create(@Res() reply: FastifyReply, @Body() body: HandbookThreadPostDTO) {
    const { question, handbookPageId } = body.data.attributes;
    const response = await this.handbookThreadService.createWithFirstMessage({
      question,
      handbookPageId,
    });
    reply.send(response);
  }

  /**
   * GET /handbookthreads/:handbookThreadId — one thread with every message it
   * holds, in position order.
   */
  @Get(`${handbookThreadMeta.endpoint}/:handbookThreadId`)
  async findById(@Res() reply: FastifyReply, @Param("handbookThreadId") handbookThreadId: string) {
    const response = await this.handbookThreadService.findThreadWithMessages({ threadId: handbookThreadId });
    reply.send(response);
  }

  /**
   * PATCH /handbookthreads/:handbookThreadId — rename.
   */
  @Patch(`${handbookThreadMeta.endpoint}/:handbookThreadId`)
  @CacheInvalidate(handbookThreadMeta)
  async patch(@Res() reply: FastifyReply, @Body() body: HandbookThreadPatchDTO) {
    return this.crud.patch(reply, body);
  }

  /**
   * DELETE /handbookthreads/:handbookThreadId — remove the thread and its
   * messages.
   */
  @Delete(`${handbookThreadMeta.endpoint}/:handbookThreadId`)
  @HttpCode(HttpStatus.NO_CONTENT)
  @CacheInvalidate(handbookThreadMeta)
  async delete(@Res() reply: FastifyReply, @Param("handbookThreadId") handbookThreadId: string) {
    return this.crud.delete(reply, handbookThreadId);
  }

  /**
   * POST /handbookthreads/:handbookThreadId/handbookthreadmessages — ask a
   * follow-up. Answers with the two new messages as a JSON:API list, the shape
   * `AssistantController.append` returns.
   */
  @Post(`${handbookThreadMeta.endpoint}/:handbookThreadId/${handbookThreadMessageMeta.endpoint}`)
  @CacheInvalidate(handbookThreadMeta)
  async appendMessage(
    @Res() reply: FastifyReply,
    @Param("handbookThreadId") handbookThreadId: string,
    @Body() body: HandbookThreadMessagePostDTO,
  ) {
    const { question, handbookPageId } = body.data.attributes;
    const response = await this.handbookThreadService.appendMessage({
      threadId: handbookThreadId,
      question,
      handbookPageId,
    });
    reply.send(response);
  }
}
