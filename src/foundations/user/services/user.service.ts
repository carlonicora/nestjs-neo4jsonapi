import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EmailService } from "../../../core/email/services/email.service";
import { hashPassword } from "../../../core/security/services/security.service";
import { UserPostDataDTO } from "../../user/dtos/user.post.dto";
import { UserPutDataDTO } from "../../user/dtos/user.put.dto";

import { randomUUID } from "crypto";
import { BaseConfigInterface, ConfigAppInterface } from "../../../config/interfaces";
import { JsonApiDataInterface } from "../../../core/jsonapi/interfaces/jsonapi.data.interface";
import { JsonApiPaginator } from "../../../core/jsonapi/serialisers/jsonapi.paginator";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { UserPatchRateDataDTO } from "../../user/dtos/user.patch.rate.dto";
import { User } from "../../user/entities/user.entity";
import { UserModel } from "../../user/entities/user.model";
import { UserRepository } from "../repositories/user.repository";

@Injectable()
export class UserService {
  constructor(
    private readonly builder: JsonApiService,
    private readonly db: UserRepository,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService<BaseConfigInterface>,
  ) {}

  private get appConfig(): ConfigAppInterface {
    return this.configService.get<ConfigAppInterface>("app");
  }

  async expectNotExists(params: { email: string }): Promise<void> {
    const user = await this.db.findByEmail({ email: params.email });

    if (user) throw new HttpException("A user with the given email already exists", HttpStatus.CONFLICT);
  }

  async findMany(params: {
    query: any;
    isAdmin: boolean;
    term?: string;
    userIds?: string[];
    includeDeleted?: boolean;
  }): Promise<JsonApiDataInterface> {
    const paginator: JsonApiPaginator = new JsonApiPaginator(params.query);

    return this.builder.buildList(
      UserModel,
      await this.db.findMany({
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
  }): Promise<JsonApiDataInterface> {
    const paginator: JsonApiPaginator = new JsonApiPaginator(params.query);

    return this.builder.buildList(
      UserModel,
      await this.db.findManyByContentIds({
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
  }): Promise<JsonApiDataInterface> {
    const paginator: JsonApiPaginator = new JsonApiPaginator(params.query);

    return this.builder.buildList(
      UserModel,
      await this.db.findManyByCompany({
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
  }): Promise<JsonApiDataInterface> {
    const paginator: JsonApiPaginator = new JsonApiPaginator(params.query);

    return this.builder.buildList(
      UserModel,
      await this.db.findInRole({
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
  }): Promise<JsonApiDataInterface> {
    const paginator: JsonApiPaginator = new JsonApiPaginator(params.query);

    return this.builder.buildList(
      UserModel,
      await this.db.findNotInRole({
        roleId: params.roleId,
        term: params.term,
        cursor: paginator.generateCursor(),
      }),
      paginator,
    );
  }

  async findByUserId(params: { userId: string }): Promise<JsonApiDataInterface> {
    return this.builder.buildSingle(UserModel, await this.db.findByUserId({ userId: params.userId }));
  }

  async findOneForAdmin(params: { userId: string }): Promise<JsonApiDataInterface> {
    return this.builder.buildSingle(UserModel, await this.db.findOneForAdmin({ userId: params.userId }));
  }

  async findByUserIdCompanyId(params: { userId: string; companyId: string }): Promise<JsonApiDataInterface> {
    return this.builder.buildSingle(
      UserModel,
      await this.db.findByUserId({ userId: params.userId, companyId: params.companyId }),
    );
  }

  async put(params: { data: UserPutDataDTO; isAdmin: boolean; isCurrentUser: boolean }): Promise<JsonApiDataInterface> {
    if (params.data.attributes.password || params.data.attributes.name) {
      if (params.data.attributes.password)
        params.data.attributes.password = await hashPassword(params.data.attributes.password);

      const roles = params.data.relationships?.roles
        ? params.isAdmin
          ? (params.data.relationships?.roles?.data?.map((role) => role.id) ?? [])
          : undefined
        : undefined;

      await this.db.put({
        isAdmin: params.isAdmin,
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
      return this.builder.buildSingle(UserModel, await this.db.findFullUser({ userId: params.data.id }));

    return this.findByUserId({
      userId: params.data.id,
    });
  }

  async findFullUser(params: { userId: string }): Promise<JsonApiDataInterface> {
    return this.builder.buildSingle(UserModel, await this.db.findFullUser({ userId: params.userId }));
  }

  async reactivate(params: { userId: string }): Promise<JsonApiDataInterface> {
    await this.db.reactivate({
      userId: params.userId,
    });

    return this.findByUserId({
      userId: params.userId,
    });
  }

  async patchRate(params: { data: UserPatchRateDataDTO }): Promise<JsonApiDataInterface> {
    await this.db.patchRate({
      userId: params.data.id,
      rate: params.data.attributes.rate,
    });

    return this.findByUserId({
      userId: params.data.id,
    });
  }

  async sendInvitationEmail(params: { userId: string }): Promise<void> {
    const user = await this.db.resetCode({ userId: params.userId });

    const link: string = `${this.appConfig.url}en/invitation/${user.code}`;

    await this.emailService.sendEmail(
      "invitationEmail",
      {
        to: user.email,
        activationLink: link,
        expirationDate: user.codeExpiration.toDateString(),
        expirationTime: user.codeExpiration.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        companyName: user.company.name,
      },
      "en",
    );
  }

  async findByEmail(params: { email: string }): Promise<JsonApiDataInterface> {
    return this.builder.buildSingle(UserModel, await this.db.findByEmail({ email: params.email }));
  }

  async create(params: {
    data: UserPostDataDTO;
    forceCompanyAdmin?: boolean;
    language: string;
  }): Promise<JsonApiDataInterface | void> {
    const password = params.data.attributes.password
      ? await hashPassword(params.data.attributes.password)
      : randomUUID();

    const user: User = await this.db.create({
      userId: params.data.id,
      name: params.data.attributes.name,
      email: params.data.attributes.email,
      title: params.data.attributes.title,
      bio: params.data.attributes.bio,
      password: password,
      avatar: params.data.attributes.avatar,
      companyId: params.data.relationships.company.data.id,
      roleIds: params.data.relationships?.roles?.data?.map((role) => role.id) ?? [],
    });

    if (params.forceCompanyAdmin) await this.db.makeCompanyAdmin({ userId: params.data.id });

    if (params.data.attributes.sendInvitationEmail) {
      const link: string = `${this.appConfig.url}en/invitation/${user.code}`;
      await this.emailService.sendEmail(
        params.data.attributes.sendInvitationEmail ? "invitationEmail" : "activationEmail",
        {
          to: user.email,
          activationLink: link,
          expirationDate: user.codeExpiration.toDateString(),
          expirationTime: user.codeExpiration.toTimeString(),
          companyName: user.company.name,
        },
        params.language,
      );
    }

    if (params.data.attributes.adminCreated) return await this.findByUserId({ userId: user.id });
  }

  async createForCompany(params: {
    companyId: string;
    data: UserPostDataDTO;
    language: string;
  }): Promise<JsonApiDataInterface | void> {
    const password = params.data.attributes.password
      ? await hashPassword(params.data.attributes.password)
      : randomUUID();

    const user: User = await this.db.create({
      userId: params.data.id,
      name: params.data.attributes.name,
      email: params.data.attributes.email,
      password: password,
      avatar: params.data.attributes.avatar,
      companyId: params.companyId,
      roleIds: params.data.relationships?.roles?.data?.map((role) => role.id) ?? [],
    });

    if (params.data.attributes.sendInvitationEmail) {
      const link: string = `${this.appConfig.url}en/invitation/${user.code}`;
      await this.emailService.sendEmail(
        params.data.attributes.sendInvitationEmail ? "invitationEmail" : "activationEmail",
        {
          to: user.email,
          activationLink: link,
          expirationDate: user.codeExpiration.toDateString(),
          expirationTime: user.codeExpiration.toTimeString(),
          companyName: user.company.name,
        },
        params.language,
      );
    }

    return await this.findByUserIdCompanyId({
      userId: params.data.id,
      companyId: params.companyId,
    });
  }

  async delete(params: { userId: string }): Promise<void> {
    await this.db.delete({ userId: params.userId });
  }

  async addUserToRole(params: { userId: string; roleId: string; returnsFull: boolean }): Promise<JsonApiDataInterface> {
    await this.db.addUserToRole({ userId: params.userId, roleId: params.roleId });

    return this.findByUserId({ userId: params.userId });
  }

  async removeUserFromRole(params: {
    roleId: string;
    userId: string;
    returnsFull: boolean;
  }): Promise<JsonApiDataInterface> {
    await this.db.removeUserFromRole({
      roleId: params.roleId,
      userId: params.userId,
    });

    return this.findByUserId({ userId: params.userId });
  }
}
