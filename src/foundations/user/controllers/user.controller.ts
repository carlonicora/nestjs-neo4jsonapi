import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Request,
  Res,
  UseGuards,
} from "@nestjs/common";
import { RoleId } from "../../../common/constants/system.roles";
import { CacheInvalidate } from "../../../common/decorators/cache-invalidate.decorator";
import { ValidateId } from "../../../common/decorators/validate-id.decorator";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { SecurityService } from "../../../core/security/services/security.service";

import { FastifyReply } from "fastify";
import { ClsService } from "nestjs-cls";
import { Roles } from "../../../common/decorators/roles.decorator";
import { AuthenticatedRequest } from "../../../common/interfaces/authenticated.request.interface";
import { CacheService } from "../../../core/cache/services/cache.service";
import { CompanyPostDataDTO } from "../../company/dtos/company.post.dto";
import { companyMeta } from "../../company/entities/company.meta";
import { CompanyService } from "../../company/services/company.service";
import { contentMeta } from "../../content/entities/content.meta";
import { RelevancyService } from "../../relevancy/services/relevancy.service";
import { roleMeta } from "../../role/entities/role.meta";
import { UserPatchAvatarDTO } from "../../user/dtos/user.patch.avatar.dto";
import { UserPatchLanguageDTO } from "../../user/dtos/user.patch.language.dto";
import { UserPatchRateDTO } from "../../user/dtos/user.patch.rate.dto";
import { UserPostDTO } from "../../user/dtos/user.post.dto";
import { UserPutDTO } from "../../user/dtos/user.put.dto";
import { userMeta } from "../../user/entities/user.meta";
import { User } from "../entities/user";
import { UserCypherService } from "../services/user.cypher.service";
import { UserService } from "../services/user.service";

@Controller()
@UseGuards(JwtAuthGuard)
export class UserController {
  constructor(
    private readonly users: UserService,
    private readonly security: SecurityService,
    private readonly companyService: CompanyService,
    private readonly cacheService: CacheService,
    private readonly clsService: ClsService,
    private readonly relevancyService: RelevancyService<User>,
    private readonly cypherService: UserCypherService,
  ) {}

  /** Platform administrator: the global Administrator role. */
  private isPlatformAdmin(user: any): boolean {
    return this.security.isUserInRoles({ user: user, roles: [RoleId.Administrator] });
  }

  /** Administrator OR CompanyAdministrator. */
  private isAnyAdmin(user: any): boolean {
    return this.security.isUserInRoles({
      user: user,
      roles: [RoleId.Administrator, RoleId.CompanyAdministrator],
    });
  }

  @Get(userMeta.endpoint)
  async findBySearch(
    @Req() request: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Query() query: any,
    @Query("search") search?: string,
    @Query("includeDeleted") includeDeleted?: boolean,
    @Query("contentIds") contentIds?: string,
  ) {
    const isAdmin = this.security.isUserInRoles({
      user: request.user,
      roles: [RoleId.Administrator, RoleId.CompanyAdministrator],
    });

    let response;
    if (contentIds) {
      response = await this.users.findByContentIds({ contentIds: contentIds.split(","), query: query });
    } else {
      response = await this.users.findMany({
        query: query,
        term: search,
        isAdmin: isAdmin,
        includeDeleted: includeDeleted ?? false,
      });
    }

    reply.send(response);
  }

  @Get(`${userMeta.endpoint}/:userId`)
  async findOneByUserId(@Request() req: any, @Param("userId") userId: string) {
    if (userId === "me") userId = req.user?.userId;

    if (this.security.isUserInRoles({ user: req.user, roles: [RoleId.Administrator] }))
      return await this.users.findOneForAdmin({ userId: userId });

    return await this.users.findByUserId({
      userId: userId,
    });
  }

  @Get(`${userMeta.endpoint}/me/full`)
  async findFullUser(@Req() request: AuthenticatedRequest, @Res() reply: FastifyReply) {
    const userId = request.user?.userId;

    const response = await this.users.findFullUser({
      userId: userId,
    });

    reply.send(response);
  }

  /**
   * Admin lookup (the user editor's duplicate-email check). Bound to the
   * caller's company: a user of another company answers 404, like a missing
   * one. Only a platform administrator looks up across companies.
   */
  @Get(`${userMeta.endpoint}/email/:email`)
  @Roles(RoleId.Administrator, RoleId.CompanyAdministrator)
  async findOneByEmail(@Req() request: AuthenticatedRequest, @Param("email") email: string) {
    if (this.isPlatformAdmin(request.user)) return this.users.findByEmailInCompany({ email: email });

    const companyId = request.user?.companyId;
    if (!companyId) throw new ForbiddenException("No company in context");

    return this.users.findByEmailInCompany({ email: email, companyId: companyId });
  }

  @Get(`${companyMeta.endpoint}/:companyId/${userMeta.endpoint}`)
  async findByCompany(
    @Req() request: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("companyId") companyId: string,
    @Query() query: any,
    @Query("search") search?: string,
    @Query("includeDeleted") includeDeleted?: boolean,
    @Query("isDeleted") isDeleted?: boolean,
  ) {
    // The URL company replaces the CLS company below, so only the caller's own
    // company (or a platform administrator) may be listed.
    if (request.user?.companyId !== companyId && !this.isPlatformAdmin(request.user))
      throw new ForbiddenException("You cannot list the users of another company");

    this.clsService.set("companyId", companyId);

    const response = await this.users.findManyByCompany({
      query: query,
      term: search,
      isDeleted: isDeleted ?? false,
      includeDeleted: includeDeleted ?? false,
      companyId: companyId,
    });

    reply.send(response);
  }

  @Post(userMeta.endpoint)
  @Roles(RoleId.Administrator, RoleId.CompanyAdministrator)
  @CacheInvalidate(userMeta)
  async createUser(
    @Req() request: any,
    @Body() body: UserPostDTO,
    @Res() reply: FastifyReply,
    @Query("lng") lng?: string,
  ) {
    // 409 when the email is taken. It used to answer with that user's full
    // record, whatever company they belonged to.
    await this.users.expectNotExists({ email: body.data.attributes.email });

    let forceCompanyAdmin = false;
    if (!body.included?.length) {
      if (!body.data.relationships?.company?.data?.id)
        throw new HttpException(
          "A new user needs a company relationship or an included company",
          HttpStatus.BAD_REQUEST,
        );
      // A CompanyAdministrator creates users in their own company only: any
      // other id would let them mint an account (with roles) in another tenant.
      if (body.data.relationships.company.data.id !== request.user?.companyId && !this.isPlatformAdmin(request.user))
        throw new ForbiddenException("You cannot create users in another company");
      await this.companyService.validate({
        companyId: body.data.relationships.company.data.id,
      });
    } else {
      await this.companyService.createCompanyFromDTO({
        data: body.included[0] as CompanyPostDataDTO,
      });
      forceCompanyAdmin = true;
    }

    const response = await this.users.createUser({
      data: body.data,
      forceCompanyAdmin: forceCompanyAdmin,
      language: lng ?? "en",
    });

    reply.send(response);
  }

  @Put(`${userMeta.endpoint}/:userId`)
  // The service writes body.data.id: it must be the URL id (412 otherwise).
  @ValidateId("userId")
  @CacheInvalidate(userMeta, "userId")
  async put(
    @Request() request: any,
    @Param("userId") userId: string,
    @Body() body: UserPutDTO,
    @Res() reply: FastifyReply,
  ) {
    const isCurrentUser = request.user.userId === userId;
    const isAdmin = this.isAnyAdmin(request.user);

    if (!isCurrentUser && !isAdmin) throw new ForbiddenException("You are not allowed to edit this user");

    // Not self: the repository only reaches a user BELONGING_TO the CLS company.
    const response = await this.users.putUser({
      data: body.data,
      isAdmin: isAdmin,
      isCurrentUser: isCurrentUser,
    });
    reply.send(response);
  }

  @Patch(`${userMeta.endpoint}/:userId`)
  @CacheInvalidate(userMeta, "userId")
  async reactivateUser(@Request() request: any, @Param("userId") userId: string, @Res() reply: FastifyReply) {
    this.security.validateAdmin({ user: request.user });

    const response = await this.users.reactivate({
      userId: userId,
      isPlatformAdmin: this.isPlatformAdmin(request.user),
    });
    reply.send(response);
  }

  @Patch(`${userMeta.endpoint}/:userId/avatar`)
  @ValidateId("userId")
  @CacheInvalidate(userMeta, "userId")
  async updateUserAvatar(
    @Request() request: any,
    @Param("userId") userId: string,
    @Body() body: UserPatchAvatarDTO,
    @Res() reply: FastifyReply,
  ) {
    const isSelf = request.user?.userId === userId;
    if (!isSelf && !this.isAnyAdmin(request.user))
      throw new ForbiddenException("You are not allowed to edit this user");

    const response = await this.users.patchAvatar({ data: body.data, isSelf: isSelf });
    reply.send(response);
  }

  /**
   * Saves the caller's own language. Self only: an administrator cannot set
   * another user's language through this endpoint.
   */
  @Patch(`${userMeta.endpoint}/:userId/language`)
  @ValidateId("userId")
  @CacheInvalidate(userMeta, "userId")
  async updateUserLanguage(
    @Request() request: any,
    @Param("userId") userId: string,
    @Body() body: UserPatchLanguageDTO,
    @Res() reply: FastifyReply,
  ) {
    if (request.user?.userId !== userId) throw new ForbiddenException("You can only change your own language");

    const response = await this.users.patchLanguage({
      data: body.data,
      isAdmin: this.security.isUserInRoles({ user: request.user, roles: [RoleId.Administrator] }),
    });
    reply.send(response);
  }

  @Patch(`${userMeta.endpoint}/:userId/rates`)
  @Roles(RoleId.CompanyAdministrator)
  @ValidateId("userId")
  @CacheInvalidate(userMeta, "userId")
  async updateUserRates(
    @Request() request: any,
    @Param("userId") userId: string,
    @Body() body: UserPatchRateDTO,
    @Res() reply: FastifyReply,
  ) {
    const response = await this.users.patchRate({
      data: body.data,
      isPlatformAdmin: this.isPlatformAdmin(request.user),
    });
    reply.send(response);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Post(`${userMeta.endpoint}/:userId/send-invitation-email`)
  @CacheInvalidate(userMeta, "userId")
  async sendInvitationEmail(@Request() request: any, @Param("userId") userId: string) {
    this.security.validateAdmin({ user: request.user });
    await this.users.sendInvitationEmail({ userId: userId });
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(`${userMeta.endpoint}/:userId`)
  @CacheInvalidate(userMeta, "userId")
  async delete(@Req() request: any, @Param("userId") userId: string) {
    if (!this.isAnyAdmin(request.user)) throw new ForbiddenException("You are not allowed to delete this user");

    // Non-platform callers only reach users BELONGING_TO their CLS company.
    await this.users.deleteUser({
      userId: userId,
      isPlatformAdmin: this.isPlatformAdmin(request.user),
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get(`${roleMeta.endpoint}/:roleId/${userMeta.endpoint}`)
  async findUserByRole(
    @Request() req: any,
    @Query() query: any,
    @Param("roleId") roleId: string,
    @Query("notInRole") notInRole?: boolean,
    @Query("search") search?: string,
  ) {
    const isAdmin = this.security.isUserInRoles({
      user: req.user,
      roles: [RoleId.Administrator, RoleId.CompanyAdministrator],
    });
    if (notInRole)
      return await this.users.findNotInRole({
        roleId: roleId,
        term: search,
        query: query,
        isAdmin: isAdmin,
      });

    return await this.users.findInRole({
      roleId: roleId,
      term: search,
      query: query,
      isAdmin: isAdmin,
    });
  }

  /**
   * Role grants are never self-service.
   * - Administrator is a PLATFORM grant: only a platform administrator may
   *   give or take it.
   * - Any other role: Administrator or CompanyAdministrator. A
   *   CompanyAdministrator acts inside their CLS company only; the repository
   *   matches the target user through BELONGS_TO that company.
   */
  private assertCanManageRole(req: any, roleId: string): void {
    if (roleId === RoleId.Administrator) {
      if (!this.isPlatformAdmin(req.user))
        throw new ForbiddenException("Only a platform administrator can manage the Administrator role");
      return;
    }

    if (!this.isAnyAdmin(req.user)) throw new ForbiddenException("You are not allowed to manage roles");

    if (!this.isPlatformAdmin(req.user) && !this.clsService.get("companyId"))
      throw new ForbiddenException("You are not allowed to manage roles");
  }

  @UseGuards(JwtAuthGuard)
  @Post(`${roleMeta.endpoint}/:roleId/${userMeta.endpoint}/:userId`)
  async addUserToRole(
    @Request() req: any,
    @Param("roleId") roleId: string,
    @Param("userId") userId: string,
    @Res() reply: FastifyReply,
  ) {
    this.assertCanManageRole(req, roleId);

    const response = await this.users.addUserToRole({
      userId: userId,
      roleId: roleId,
      returnsFull: true,
    });

    reply.send(response);
    await this.cacheService.invalidateByElement(userMeta.endpoint, userId);
    await this.cacheService.invalidateByElement(roleMeta.endpoint, roleId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(`${roleMeta.endpoint}/:roleId/${userMeta.endpoint}/:userId`)
  async removeUserToRole(@Request() req: any, @Param("roleId") roleId: string, @Param("userId") userId: string) {
    this.assertCanManageRole(req, roleId);

    await this.users.removeUserFromRole({
      roleId: roleId,
      userId: userId,
      returnsFull: true,
    });

    await this.cacheService.invalidateByElement(userMeta.endpoint, userId);
    await this.cacheService.invalidateByElement(roleMeta.endpoint, roleId);
  }

  @Get(`${contentMeta.endpoint}/:contentId/user-relevance`)
  async findContentsRelevantForContent(@Query() query: any, @Param("contentId") contentId: string) {
    return await this.relevancyService.findRelevantUsers({
      cypherService: this.cypherService,
      id: contentId,
      query: query,
    });
  }
}
