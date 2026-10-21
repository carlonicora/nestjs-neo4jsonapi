import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { RoleId } from "../../../common/constants/system.roles";
import { EmailService } from "../../../core/email/services/email.service";
import { ResponseLanguageService } from "./response-language.service";
import { hashPassword } from "../../../core/security/services/security.service";
import { UserPostDataDTO } from "../../user/dtos/user.post.dto";
import { UserPutDataDTO } from "../../user/dtos/user.put.dto";

import { randomUUID } from "crypto";
import { ClsService } from "nestjs-cls";
import { BaseConfigInterface, ConfigAppInterface, ConfigI18nInterface } from "../../../config/interfaces";
import { JsonApiPaginator } from "../../../core/jsonapi/serialisers/jsonapi.paginator";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AbstractService } from "../../../core/neo4j/abstracts/abstract.service";
import { UserPatchAvatarDataDTO } from "../../user/dtos/user.patch.avatar.dto";
import { UserPatchLanguageDataDTO } from "../../user/dtos/user.patch.language.dto";
import { UserPatchRateDataDTO } from "../../user/dtos/user.patch.rate.dto";
import { User, UserDescriptor } from "../../user/entities/user";
import { UserRepository } from "../repositories/user.repository";
import { S3ClientKeyService } from "../../s3/services/s3-client-key.service";
import {
  JsonApiListDocument,
  JsonApiSingleDocument,
} from "../../../core/jsonapi/interfaces/jsonapi.document.interface";

/**
 * User service.
 *
 * Extends `AbstractService` so an application can subclass it and have BOTH the
 * inherited generic methods AND every method declared here serialise with the
 * *extended* model. Model resolution is by subclass polymorphism — a subclass
 * re-declares `descriptor` and `model` as initialised class fields — never by a
 * registry lookup (Nest constructs providers before `onModuleInit`, where models
 * are registered).
 *
 * The three domain methods whose names collide with the abstract's generic CRUD
 * (`create` / `put` / `delete`) are named `createUser` / `putUser` /
 * `deleteUser` so the inherited descriptor-driven CRUD stays reachable.
 */
@Injectable()
export class UserService extends AbstractService<User, typeof UserDescriptor.relationships> {
  protected readonly descriptor = UserDescriptor;

  constructor(
    jsonApiService: JsonApiService,
    protected readonly userRepository: UserRepository,
    protected readonly emailService: EmailService,
    protected readonly configService: ConfigService<BaseConfigInterface>,
    clsService: ClsService,
    protected readonly responseLanguage: ResponseLanguageService,
    // APPENDED and optional: a subclass passes its dependencies to `super()`
    // positionally, so a required parameter would break it on upgrade. Absent,
    // the avatar key is stored unchecked, as before.
    @Optional()
    protected readonly s3ClientKeys?: S3ClientKeyService,
  ) {
    super(jsonApiService, userRepository, clsService, UserDescriptor.model);
  }

  private get appConfig(): ConfigAppInterface {
    return this.configService.get<ConfigAppInterface>("app");
  }

  /**
   * Defence in depth: the global Administrator role is platform-level and may
   * only be granted through the dedicated platform path (`addUserToRole`). A
   * company-scoped write (create / put) that carried it would create a
   * company Membership holding Administrator, which the JWT would then surface
   * as platform-admin for that company.
   */
  private companyRoleIds(roleIds: string[]): string[] {
    return roleIds.filter((roleId) => roleId !== RoleId.Administrator);
  }

  async expectNotExists(params: { email: string }): Promise<void> {
    const user = await this.userRepository.findByEmail({ email: params.email });

    if (user) throw new HttpException("A user with the given email already exists", HttpStatus.CONFLICT);
  }

  async findMany(params: {
    query: any;
    isAdmin: boolean;
    term?: string;
    userIds?: string[];
    includeDeleted?: boolean;
  }): Promise<JsonApiListDocument> {
    const paginator: JsonApiPaginator = new JsonApiPaginator(params.query);

    return this.jsonApiService.buildList(
      this.model,
      await this.userRepository.findMany({
        term: params.term,
        cursor: paginator.generateCursor(),
        includeDeleted: params.includeDeleted ?? false,
      }),
      paginator,
    );
  }

  async findByContentIds(params: {
    contentIds: string[];
    query: any;
    term?: string;
    includeDeleted?: boolean;
  }): Promise<JsonApiListDocument> {
    const paginator: JsonApiPaginator = new JsonApiPaginator(params.query);

    return this.jsonApiService.buildList(
      this.model,
      await this.userRepository.findManyByContentIds({
        contentIds: params.contentIds,
        includeDeleted: params.includeDeleted ?? false,
        term: params.term,
      }),
      paginator,
    );
  }

  async findManyByCompany(params: {
    companyId: string;
    query: any;
    isDeleted?: boolean;
    term?: string;
    userIds?: string[];
    includeDeleted?: boolean;
  }): Promise<JsonApiListDocument> {
    const paginator: JsonApiPaginator = new JsonApiPaginator(params.query);

    return this.jsonApiService.buildList(
      this.model,
      await this.userRepository.findManyByCompany({
        companyId: params.companyId,
        term: params.term,
        cursor: paginator.generateCursor(),
        includeDeleted: params.includeDeleted ?? false,
        isDeleted: params.isDeleted ?? false,
      }),
      paginator,
    );
  }

  async findInRole(params: {
    roleId: string;
    term: string;
    query: any;
    isAdmin: boolean;
  }): Promise<JsonApiListDocument> {
    const paginator: JsonApiPaginator = new JsonApiPaginator(params.query);

    return this.jsonApiService.buildList(
      this.model,
      await this.userRepository.findInRole({
        roleId: params.roleId,
        term: params.term,
        cursor: paginator.generateCursor(),
      }),
      paginator,
    );
  }

  async findNotInRole(params: {
    roleId: string;
    term: string;
    query: any;
    isAdmin: boolean;
  }): Promise<JsonApiListDocument> {
    const paginator: JsonApiPaginator = new JsonApiPaginator(params.query);

    return this.jsonApiService.buildList(
      this.model,
      await this.userRepository.findNotInRole({
        roleId: params.roleId,
        term: params.term,
        cursor: paginator.generateCursor(),
      }),
      paginator,
    );
  }

  async findByUserId(params: { userId: string }): Promise<JsonApiSingleDocument> {
    return this.jsonApiService.buildSingle(
      this.model,
      await this.userRepository.findByUserId({ userId: params.userId }),
    );
  }

  async findOneForAdmin(params: { userId: string }): Promise<JsonApiSingleDocument> {
    return this.jsonApiService.buildSingle(
      this.model,
      await this.userRepository.findOneForAdmin({ userId: params.userId }),
    );
  }

  async findByUserIdCompanyId(params: { userId: string; companyId: string }): Promise<JsonApiSingleDocument> {
    return this.jsonApiService.buildSingle(
      this.model,
      await this.userRepository.findByUserId({ userId: params.userId, companyId: params.companyId }),
    );
  }

  async putUser(params: {
    data: UserPutDataDTO;
    isAdmin: boolean;
    isCurrentUser: boolean;
  }): Promise<JsonApiSingleDocument> {
    // The stored avatar key is signed for every reader of the user: refuse a key the caller may not read.
    await this.s3ClientKeys?.assertClientKey({ key: params.data.attributes?.avatar, folder: "users" });

    if (params.data.attributes?.password || params.data.attributes?.name) {
      if (params.data.attributes.password)
        params.data.attributes.password = await hashPassword(params.data.attributes.password);

      const roles = params.data.relationships?.roles
        ? params.isAdmin
          ? this.companyRoleIds(params.data.relationships?.roles?.data?.map((role) => role.id) ?? [])
          : undefined
        : undefined;

      await this.userRepository.putUser({
        isAdmin: params.isAdmin,
        isSelf: params.isCurrentUser,
        userId: params.data.id,
        email: params.data.attributes.email,
        name: params.data.attributes.name,
        title: params.data.attributes.title,
        bio: params.data.attributes.bio,
        phone: params.data.attributes.phone,
        password: params.data.attributes?.password,
        avatar: params.data.attributes.avatar,
        roles: roles,
      });
    }

    if (params.isCurrentUser)
      return this.jsonApiService.buildSingle(
        this.model,
        await this.userRepository.findFullUser({ userId: params.data.id }),
      );

    return this.findByUserId({
      userId: params.data.id,
    });
  }

  async findFullUser(params: { userId: string }): Promise<JsonApiSingleDocument> {
    return this.jsonApiService.buildSingle(
      this.model,
      await this.userRepository.findFullUser({ userId: params.userId }),
    );
  }

  /** `isPlatformAdmin` lifts the company scope (see UserRepository.reactivate). */
  async reactivate(params: { userId: string; isPlatformAdmin?: boolean }): Promise<JsonApiSingleDocument> {
    await this.userRepository.reactivate({
      userId: params.userId,
      isPlatformAdmin: params.isPlatformAdmin,
    });

    return this.findByUserId({
      userId: params.userId,
    });
  }

  /** `isSelf` lifts the company scope (see UserRepository.patchAvatar). */
  async patchAvatar(params: { data: UserPatchAvatarDataDTO; isSelf?: boolean }): Promise<JsonApiSingleDocument> {
    // The stored avatar key is signed for every reader of the user: refuse a key the caller may not read.
    await this.s3ClientKeys?.assertClientKey({ key: params.data.attributes?.avatar, folder: "users" });

    await this.userRepository.patchAvatar({
      userId: params.data.id,
      avatar: params.data.attributes.avatar,
      isSelf: params.isSelf,
    });

    return this.findByUserId({
      userId: params.data.id,
    });
  }

  /**
   * Saves the user's language and returns the user. A platform administrator
   * belongs to no company, so `isAdmin` reloads them the way GET users/:id does.
   */
  async patchLanguage(params: { data: UserPatchLanguageDataDTO; isAdmin?: boolean }): Promise<JsonApiSingleDocument> {
    const supportedLanguages = this.configService.get<ConfigI18nInterface>("i18n")?.supportedLanguages ?? ["en"];
    const language = params.data.attributes?.language;

    if (!language || !supportedLanguages.includes(language))
      throw new BadRequestException(`Unsupported language: ${language}`);

    await this.userRepository.patchLanguage({
      userId: params.data.id,
      language: language,
    });

    if (params.isAdmin) return this.findOneForAdmin({ userId: params.data.id });

    return this.findByUserId({
      userId: params.data.id,
    });
  }

  /** `isPlatformAdmin` lifts the company scope (see UserRepository.patchRate). */
  async patchRate(params: { data: UserPatchRateDataDTO; isPlatformAdmin?: boolean }): Promise<JsonApiSingleDocument> {
    await this.userRepository.patchRate({
      userId: params.data.id,
      rate: params.data.attributes.rate,
      isPlatformAdmin: params.isPlatformAdmin,
    });

    return this.findByUserId({
      userId: params.data.id,
    });
  }

  async sendInvitationEmail(params: { userId: string }): Promise<void> {
    const user = await this.userRepository.resetCode({ userId: params.userId });
    const language = await this.responseLanguage.resolveForEmail({ email: user.email });

    const link: string = `${this.appConfig.url}${language ?? "en"}/invitation/${user.code}`;

    await this.emailService.sendEmail(
      "invitationEmail",
      {
        to: user.email,
        activationLink: link,
        expirationDate: user.codeExpiration.toDateString(),
        expirationTime: user.codeExpiration.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        expiresAt: user.codeExpiration.toISOString(),
        companyName: user.company.name,
      },
      language ?? "en",
    );
  }

  async findByEmail(params: { email: string }): Promise<JsonApiSingleDocument> {
    return this.jsonApiService.buildSingle(this.model, await this.userRepository.findByEmail({ email: params.email }));
  }

  /**
   * The user with this email, only when they belong to `companyId`. Without
   * the company bound, any caller could read any user on the platform (company
   * and roles included). A user of another company answers 404, exactly as a
   * missing one. `companyId` undefined is the platform administrator's lookup.
   */
  async findByEmailInCompany(params: { email: string; companyId?: string }): Promise<JsonApiSingleDocument> {
    const user = await this.userRepository.findByEmail({ email: params.email });
    if (!user || (params.companyId !== undefined && user.company?.id !== params.companyId))
      throw new NotFoundException("User not found");

    return this.jsonApiService.buildSingle(this.model, user);
  }

  async createUser(params: {
    data: UserPostDataDTO;
    forceCompanyAdmin?: boolean;
    language: string;
  }): Promise<JsonApiSingleDocument | void> {
    // The stored avatar key is signed for every reader of the user: refuse a key the caller may not read.
    await this.s3ClientKeys?.assertClientKey({ key: params.data.attributes.avatar, folder: "users" });

    const password = params.data.attributes.password
      ? await hashPassword(params.data.attributes.password)
      : randomUUID();

    const user: User = await this.userRepository.createUser({
      userId: params.data.id,
      name: params.data.attributes.name,
      email: params.data.attributes.email,
      title: params.data.attributes.title,
      bio: params.data.attributes.bio,
      password: password,
      avatar: params.data.attributes.avatar,
      companyId: params.data.relationships.company.data.id,
      roleIds: this.companyRoleIds(params.data.relationships?.roles?.data?.map((role) => role.id) ?? []),
    });

    // Company-scoped: the CompanyAdministrator role is granted on the membership for the
    // company this user was just created in, never as a global user→role edge.
    if (params.forceCompanyAdmin)
      await this.userRepository.makeCompanyAdmin({
        userId: params.data.id,
        companyId: params.data.relationships.company.data.id,
      });

    if (params.data.attributes.sendInvitationEmail) {
      const language = await this.responseLanguage.resolveForEmail({ email: user.email });
      const link: string = `${this.appConfig.url}${language ?? "en"}/invitation/${user.code}`;
      await this.emailService.sendEmail(
        params.data.attributes.sendInvitationEmail ? "invitationEmail" : "activationEmail",
        {
          to: user.email,
          activationLink: link,
          expirationDate: user.codeExpiration.toDateString(),
          expirationTime: user.codeExpiration.toTimeString(),
          expiresAt: user.codeExpiration.toISOString(),
          companyName: user.company.name,
        },
        language ?? params.language,
      );
    }

    if (params.data.attributes.adminCreated) return await this.findByUserId({ userId: user.id });
  }

  async createForCompany(params: {
    companyId: string;
    data: UserPostDataDTO;
    language: string;
  }): Promise<JsonApiSingleDocument | void> {
    // The stored avatar key is signed for every reader of the user: refuse a key the caller may not read.
    await this.s3ClientKeys?.assertClientKey({ key: params.data.attributes.avatar, folder: "users" });

    const password = params.data.attributes.password
      ? await hashPassword(params.data.attributes.password)
      : randomUUID();

    const user: User = await this.userRepository.createUser({
      userId: params.data.id,
      name: params.data.attributes.name,
      email: params.data.attributes.email,
      password: password,
      avatar: params.data.attributes.avatar,
      companyId: params.companyId,
      roleIds: this.companyRoleIds(params.data.relationships?.roles?.data?.map((role) => role.id) ?? []),
    });

    if (params.data.attributes.sendInvitationEmail) {
      const language = await this.responseLanguage.resolveForEmail({ email: user.email });
      const link: string = `${this.appConfig.url}${language ?? "en"}/invitation/${user.code}`;
      await this.emailService.sendEmail(
        params.data.attributes.sendInvitationEmail ? "invitationEmail" : "activationEmail",
        {
          to: user.email,
          activationLink: link,
          expirationDate: user.codeExpiration.toDateString(),
          expirationTime: user.codeExpiration.toTimeString(),
          expiresAt: user.codeExpiration.toISOString(),
          companyName: user.company.name,
        },
        language ?? params.language,
      );
    }

    return await this.findByUserIdCompanyId({
      userId: params.data.id,
      companyId: params.companyId,
    });
  }

  /** `isPlatformAdmin` lifts the company scope (see UserRepository.deleteUser). */
  async deleteUser(params: { userId: string; isPlatformAdmin?: boolean }): Promise<void> {
    await this.userRepository.deleteUser({ userId: params.userId, isPlatformAdmin: params.isPlatformAdmin });
  }

  async addUserToRole(params: {
    userId: string;
    roleId: string;
    returnsFull: boolean;
  }): Promise<JsonApiSingleDocument> {
    await this.userRepository.addUserToRole({ userId: params.userId, roleId: params.roleId });

    return this.findByUserId({ userId: params.userId });
  }

  async removeUserFromRole(params: {
    roleId: string;
    userId: string;
    returnsFull: boolean;
  }): Promise<JsonApiSingleDocument> {
    await this.userRepository.removeUserFromRole({
      roleId: params.roleId,
      userId: params.userId,
    });

    return this.findByUserId({ userId: params.userId });
  }
}
