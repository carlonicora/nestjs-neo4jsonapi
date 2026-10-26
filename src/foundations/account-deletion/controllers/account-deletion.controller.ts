import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { CoreModuleId } from "../../../common/constants/core-module.ids";
import { SystemRoles } from "../../../common/constants/system.roles";
import { Audit } from "../../../common/decorators/audit.decorator";
import { CacheInvalidate } from "../../../common/decorators/cache-invalidate.decorator";
import { ModuleACL } from "../../../common/decorators/module.decorator";
import { Roles } from "../../../common/decorators/roles.decorator";
import { ValidateId } from "../../../common/decorators/validate-id.decorator";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { AuthenticatedRequest } from "../../../common/interfaces/authenticated.request.interface";
import { CacheService } from "../../../core/cache/services/cache.service";
import { JsonApiSingleDocument } from "../../../core/jsonapi/interfaces/jsonapi.document.interface";
import { AuditService } from "../../audit/services/audit.service";
import { AccountDeletionKeepPostDTO } from "../dtos/account-deletion.keep.post.dto";
import { AccountDeletionPostDTO } from "../dtos/account-deletion.post.dto";
import { accountDeletionMeta } from "../entities/account-deletion.meta";
import { AccountDeletionService } from "../services/account-deletion.service";

/**
 * Account deletion request routes (opt-in `accountDeletion` feature).
 *
 * Guards are set per route, not on the class: the public keep link has no
 * session guard (so the permission gate never runs for it). Self-service
 * routes use the Auth section (OD-5); the admin routes are administrator-only
 * through `@Roles(SystemRoles.Administrator)` on `JwtAuthGuard` (OD-6).
 * `/me` and `/keep` are declared before `/:userId` so they are never read as a user id.
 */
@ModuleACL({ module: CoreModuleId.Auth })
@Controller()
export class AccountDeletionController {
  constructor(
    private readonly accountDeletionService: AccountDeletionService,
    private readonly cacheService: CacheService,
    private readonly auditService: AuditService,
  ) {}

  @Get(`${accountDeletionMeta.endpoint}/me`)
  @UseGuards(JwtAuthGuard)
  async findMine(@Req() req: AuthenticatedRequest): Promise<JsonApiSingleDocument> {
    return this.accountDeletionService.findPreview({ userId: req.user.userId });
  }

  @Post(`${accountDeletionMeta.endpoint}/keep`)
  @HttpCode(HttpStatus.NO_CONTENT)
  @CacheInvalidate(accountDeletionMeta)
  async keep(@Body() body: AccountDeletionKeepPostDTO): Promise<void> {
    await this.accountDeletionService.keep({ token: body.data.attributes.token });
  }

  @Get(`${accountDeletionMeta.endpoint}/:userId`)
  @UseGuards(JwtAuthGuard)
  @Roles(SystemRoles.Administrator)
  @Audit(accountDeletionMeta, "userId")
  async findByUser(@Req() req: AuthenticatedRequest, @Param("userId") userId: string): Promise<JsonApiSingleDocument> {
    return this.accountDeletionService.findPreview({ userId });
  }

  @Post(accountDeletionMeta.endpoint)
  @UseGuards(JwtAuthGuard)
  @CacheInvalidate(accountDeletionMeta)
  async request(
    @Req() req: AuthenticatedRequest,
    @Body() body: AccountDeletionPostDTO,
  ): Promise<JsonApiSingleDocument> {
    // Self only on this route: an administrator acting on another user uses POST /:userId.
    if (body.data.id !== req.user.userId) throw new ForbiddenException("You can only delete your own account");

    return this.accountDeletionService.request({
      targetUserId: req.user.userId,
      actingUserId: req.user.userId,
      confirmation: body.data.attributes.confirmation,
    });
  }

  @Post(`${accountDeletionMeta.endpoint}/:userId`)
  @UseGuards(JwtAuthGuard)
  @Roles(SystemRoles.Administrator)
  @ValidateId("userId")
  @CacheInvalidate(accountDeletionMeta)
  async requestForUser(
    @Req() req: AuthenticatedRequest,
    @Param("userId") userId: string,
    @Body() body: AccountDeletionPostDTO,
  ): Promise<JsonApiSingleDocument> {
    return this.accountDeletionService.request({
      targetUserId: userId,
      actingUserId: req.user.userId,
      confirmation: body.data.attributes.confirmation,
    });
  }
}
