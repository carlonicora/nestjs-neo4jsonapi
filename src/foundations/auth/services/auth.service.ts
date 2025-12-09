import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ModuleRef } from "@nestjs/core";
import { randomUUID } from "crypto";
import { RoleId } from "../../../common/constants/system.roles";
import { EmailService } from "../../../core/email/services/email.service";
import { checkPassword, hashPassword, SecurityService } from "../../../core/security/services/security.service";
import { AuthPostLoginDataDTO } from "../../auth/dtos/auth.post.login.dto";

import { ClsService } from "nestjs-cls";
import { BaseConfigInterface, ConfigAppInterface } from "../../../config/interfaces";
import { JsonApiDataInterface } from "../../../core/jsonapi/interfaces/jsonapi.data.interface";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { AuthPostRegisterDataDTO } from "../../auth/dtos/auth.post.register.dto";
import { AuthCode } from "../../auth/entities/auth.code.entity";
import { Auth } from "../../auth/entities/auth.entity";
import { AuthModel } from "../../auth/entities/auth.model";
import { AuthRepository } from "../../auth/repositories/auth.repository";
import { CompanyRepository } from "../../company/repositories/company.repository";
import { Role } from "../../role/entities/role.entity";
import { User } from "../../user/entities/user.entity";
import { UserRepository } from "../../user/repositories/user.repository";
import { UserService } from "../../user/services/user.service";

@Injectable()
export class AuthService {
  constructor(
    private readonly builder: JsonApiService,
    private readonly repository: AuthRepository,
    private readonly userService: UserService,
    private readonly users: UserRepository,
    private readonly companyRepository: CompanyRepository,
    private readonly emailService: EmailService,
    private readonly security: SecurityService,
    private readonly clsService: ClsService,
    private readonly neo4j: Neo4jService,
    private readonly moduleRef: ModuleRef,
    private readonly configService: ConfigService<BaseConfigInterface>,
  ) {}

  private get appConfig(): ConfigAppInterface {
    return this.configService.get<ConfigAppInterface>("app");
  }

  async findCurrentAuth(): Promise<JsonApiDataInterface> {
    const token = this.clsService.get("token");

    const auth: Auth = await this.repository.findByToken({
      token: token,
    });

    if (!auth) throw new HttpException("Auth not found", HttpStatus.NOT_FOUND);

    (auth as any).refreshToken = auth.id;

    return await this.builder.buildSingle(AuthModel, auth);
  }

  async createAuth(params: { user: User; refreshToken?: string }): Promise<Auth> {
    const userId = params.user.id;
    const roles = params.user.role?.map((role: Role) => role.id) ?? [];
    const companyId = params.user.company?.id;
    const features = params.user.company?.feature?.map((feature) => feature.id) ?? [];

    const token: string = this.security.signJwt({
      userId: userId,
      roles: roles,
      companyId: companyId,
      features: features,
      userName: params.user.name,
    });

    const auth = await this.repository.create({
      authId: randomUUID(),
      userId: params.user.id,
      token: token,
      expiration: this.security.refreshTokenExpiration,
    });

    (auth as any).refreshToken = auth.id;

    await this.repository.setLastLogin({ userId: auth.user.id });

    if (!!params.refreshToken) auth.user = undefined;

    return auth;
  }

  async createToken(params: { user: User; refreshToken?: string }): Promise<JsonApiDataInterface> {
    const auth = await this.createAuth({ user: params.user, refreshToken: params.refreshToken });

    if (auth.user.company?.id) {
      this.clsService.set("companyId", auth.user.company.id);
      this.clsService.set("userId", auth.user.id);
    }

    return await this.builder.buildSingle(AuthModel, auth);
  }

  async createCode(params: { authCodeId: string; authId: string }): Promise<AuthCode> {
    const now = new Date();
    const expiration = new Date(now.getTime() + 5 * 60 * 1000);

    await this.repository.createCode({
      authCodeId: params.authCodeId,
      authId: params.authId,
      expiration: expiration,
    });

    return await this.repository.findByCode({ code: params.authCodeId });
  }

  async refreshToken(params: { refreshToken: string }): Promise<any> {
    let auth: Auth = await this.repository.findByRefreshToken({
      authId: params.refreshToken,
    });

    if (!auth) throw new HttpException("Invalid refresh token", HttpStatus.UNAUTHORIZED);

    const user: User = await this.repository.findUserById({
      userId: auth.user.id,
    });

    if (!user) throw new Error("User not found");

    const userId = user.id;
    const roles = user.role?.map((role: Role) => role.id) ?? [];
    const features = user.company?.feature?.map((feature) => feature.id) ?? [];

    const token: string = this.security.signJwt({
      userId: userId,
      roles: roles,
      companyId: user.company?.id,
      features: features,
      userName: user.name,
    });

    auth = await this.repository.refreshToken({
      authId: params.refreshToken,
      token: token,
    });

    await this.repository.deleteExpiredAuths({ userId: user.id });

    const newAuth: any = {
      authId: auth.id,
      refreshToken: auth.id,
      token: auth.token,
      expiration: auth.expiration,
    };

    return this.builder.buildSingle(AuthModel, newAuth);
  }

  async login(params: { data: AuthPostLoginDataDTO }): Promise<any> {
    const user: User = await this.users.findByEmail({
      email: params.data.attributes.email,
    });

    if (!user) throw new HttpException("The email or password you entered is incorrect.", HttpStatus.UNAUTHORIZED);
    if (user.isDeleted) throw new HttpException("The account has been deleted", HttpStatus.FORBIDDEN);
    if (!user.isActive) throw new HttpException("The account has not been activated yet", HttpStatus.FORBIDDEN);

    const isValidPassword = await checkPassword(params.data.attributes.password, user.password);

    if (!isValidPassword)
      throw new HttpException("The email or password you entered is incorrect.", HttpStatus.UNAUTHORIZED);

    if (!user.isActive) throw new HttpException("The account has not been activated yet", HttpStatus.FORBIDDEN);

    await this.repository.setLastLogin({ userId: user.id });

    return await this.createToken({ user: user });
  }

  async register(params: { data: AuthPostRegisterDataDTO }): Promise<void> {
    await this.userService.expectNotExists({ email: params.data.attributes.email });

    const company = await this.companyRepository.createByName({
      name: params.data.attributes.name,
    });

    const password = await hashPassword(params.data.attributes.password);

    const user = await this.users.create({
      userId: params.data.id,
      email: params.data.attributes.email,
      name: params.data.attributes.name,
      password: password,
      companyId: company.id,
      roleIds: [RoleId.CompanyAdministrator],
    });

    const link: string = `${this.appConfig.url}en/activation/${user.code}`;

    await this.emailService.sendEmail(
      "activationEmail",
      {
        to: user.email,
        activationLink: link,
        expirationDate: user.codeExpiration.toDateString(),
        expirationTime: user.codeExpiration.toTimeString(),
        companyName: user.company.name,
      },
      "en",
    );
  }

  async findAuthByCode(params: { code: string }): Promise<JsonApiDataInterface> {
    const authCode: AuthCode = await this.repository.findByCode({
      code: params.code,
    });

    if (!authCode) throw new HttpException("Invalid code", HttpStatus.NOT_FOUND);

    if (authCode.expiration < new Date()) throw new HttpException("Code has expired", HttpStatus.NOT_FOUND);

    const auth: Auth = await this.repository.findById({
      authId: authCode.auth.id,
    });

    if (!auth) throw new HttpException("Auth not found", HttpStatus.NOT_FOUND);

    (auth as any).refreshToken = auth.id;

    return await this.builder.buildSingle(AuthModel, auth);
  }

  async deleteByToken(params: { token: string }): Promise<void> {
    await this.repository.deleteByToken(params);
  }

  async startResetPassword(email: string, lng?: string) {
    let user: User = await this.users.findByEmail({ email: email });

    if (!user) return;

    this.clsService.set("companyId", user.company.id);

    user = await this.repository.startResetPassword({ userId: user.id });

    const link: string = `${this.appConfig.url}en/reset/${user.code}`;

    await this.emailService.sendEmail(
      "resetEmail",
      {
        to: user.email,
        resetLink: link,
        expirationDate: user.codeExpiration.toDateString(),
        expirationTime: user.codeExpiration.toTimeString(),
      },
      lng ?? "en",
    );
  }

  async validateCode(code: string) {
    const user: User = await this.users.findByCode({ code: code });

    if (!user) throw new HttpException("The code provided is invalid", HttpStatus.NOT_FOUND);

    if (user.codeExpiration < new Date()) throw new HttpException("The code is expired", HttpStatus.BAD_REQUEST);
  }

  async resetPassword(code: string, password: string) {
    const user: User = await this.users.findByCode({ code: code });

    if (!user) throw new HttpException("The code provided is invalid", HttpStatus.NOT_FOUND);

    if (user.codeExpiration < new Date()) throw new HttpException("The code is expired", HttpStatus.BAD_REQUEST);

    const newPassword = await hashPassword(password);

    await this.repository.resetPassword({
      userId: user.id,
      password: newPassword,
    });
  }

  async acceptInvitation(code: string, password: string) {
    const user: User = await this.users.findByCode({ code: code });

    if (!user) throw new HttpException("The code provided is invalid", HttpStatus.NOT_FOUND);

    if (user.codeExpiration < new Date()) throw new HttpException("The code is expired", HttpStatus.BAD_REQUEST);

    const newPassword = await hashPassword(password);

    await this.repository.acceptInvitation({
      userId: user.id,
      password: newPassword,
    });
  }

  async activateAccount(code: string): Promise<any> {
    const user: User = await this.users.findByCode({ code: code });

    if (!user) throw new HttpException("The code provided is invalid", HttpStatus.NOT_FOUND);

    if (user.codeExpiration < new Date()) throw new HttpException("The code provided is expired", HttpStatus.NOT_FOUND);

    await this.repository.activateAccount({ userId: user.id });
  }
}
