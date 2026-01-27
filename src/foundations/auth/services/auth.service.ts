import { forwardRef, HttpException, HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ModuleRef } from "@nestjs/core";
import { randomUUID } from "crypto";
import { RoleId } from "../../../common/constants/system.roles";
import { EmailService } from "../../../core/email/services/email.service";
import { checkPassword, hashPassword, SecurityService } from "../../../core/security/services/security.service";
import { AuthPostLoginDataDTO } from "../../auth/dtos/auth.post.login.dto";

import { ClsService } from "nestjs-cls";
import { BaseConfigInterface, ConfigAppInterface, ConfigAuthInterface } from "../../../config/interfaces";
import { JsonApiDataInterface } from "../../../core/jsonapi/interfaces/jsonapi.data.interface";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { AuthPostRegisterDataDTO } from "../../auth/dtos/auth.post.register.dto";
import { AuthCode } from "../../auth/entities/auth.code.entity";
import { Auth } from "../../auth/entities/auth.entity";
import { AuthModel } from "../../auth/entities/auth.model";
import { PendingAuthModel } from "../../auth/entities/pending-auth.model";
import { AuthRepository } from "../../auth/repositories/auth.repository";
import { CompanyRepository } from "../../company/repositories/company.repository";
import { DiscordUserService } from "../../discord-user/services/discord-user.service";
import { GoogleUserService } from "../../google-user/services/google-user.service";
import { Role } from "../../role/entities/role";
import { TwoFactorService } from "../../two-factor/services/two-factor.service";
import { User } from "../../user/entities/user";
import { UserRepository } from "../../user/repositories/user.repository";
import { UserService } from "../../user/services/user.service";
import { WaitlistService } from "../../waitlist/services/waitlist.service";
import { PendingRegistrationService } from "./pending-registration.service";
import { TrialQueueService } from "./trial-queue.service";

@Injectable()
export class AuthService {
  private readonly logger: Logger = new Logger(AuthService.name);

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
    private readonly pendingRegistrationService: PendingRegistrationService,
    private readonly discordUserService: DiscordUserService,
    private readonly googleUserService: GoogleUserService,
    private readonly trialQueueService: TrialQueueService,
    private readonly waitlistService: WaitlistService,
    @Inject(forwardRef(() => TwoFactorService))
    private readonly twoFactorService: TwoFactorService,
  ) {}

  private get appConfig(): ConfigAppInterface {
    return this.configService.get<ConfigAppInterface>("app");
  }

  private get authConfig(): ConfigAuthInterface {
    return this.configService.get<ConfigAuthInterface>("auth");
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

    // Check if user has 2FA enabled
    const twoFactorConfig = await this.twoFactorService.getConfig(user.id);

    if (twoFactorConfig?.isEnabled) {
      // User has 2FA enabled - return pending auth response
      const pendingSession = await this.twoFactorService.createPendingSession(user.id);

      const availableMethods = await this.twoFactorService.getAvailableMethods(user.id);

      // Generate a pending JWT with limited access
      const pendingToken = this.security.signPendingJwt({
        userId: user.id,
        pendingId: pendingSession.pendingId,
      });

      const now = new Date();

      // Return pending auth response requiring 2FA verification
      const response = await this.builder.buildSingle(PendingAuthModel, {
        id: pendingSession.pendingId, // ADD: id field required by JSON:API
        createdAt: now, // ADD: for meta
        updatedAt: now, // ADD: for meta
        token: pendingToken,
        expiration: pendingSession.expiration,
        availableMethods: availableMethods,
        preferredMethod: twoFactorConfig.preferredMethod,
      });
      return response;
    }

    // No 2FA - proceed with normal login
    await this.repository.setLastLogin({ userId: user.id });

    return await this.createToken({ user: user });
  }

  /**
   * Complete the 2FA login after successful verification.
   * Called by the 2FA controller after verifying TOTP, passkey, or backup code.
   *
   * @param userId - The user's ID (extracted from pending session)
   * @returns Full auth token response
   */
  async completeTwoFactorLogin(userId: string): Promise<JsonApiDataInterface> {
    // Use findForTwoFactorLogin - doesn't require companyId in CLS, retrieves user with roles/company/features
    const user: User = await this.users.findForTwoFactorLogin({ userId });

    if (!user) throw new HttpException("User not found", HttpStatus.NOT_FOUND);
    if (user.isDeleted) throw new HttpException("The account has been deleted", HttpStatus.FORBIDDEN);
    if (!user.isActive) throw new HttpException("The account has not been activated yet", HttpStatus.FORBIDDEN);

    await this.repository.setLastLogin({ userId: user.id });

    return await this.createToken({ user: user });
  }

  async register(params: { data: AuthPostRegisterDataDTO }): Promise<void> {
    if (!this.authConfig.allowRegistration) {
      throw new HttpException("Registration is currently disabled", HttpStatus.FORBIDDEN);
    }

    // Check registration mode
    const registrationMode = this.authConfig.registrationMode ?? "open";

    if (registrationMode === "closed") {
      throw new HttpException("Registration is currently closed", HttpStatus.FORBIDDEN);
    }

    if (registrationMode === "waitlist") {
      // Require invite code for waitlist mode
      if (!params.data.attributes.inviteCode) {
        throw new HttpException("Registration requires an invitation. Please join the waitlist.", HttpStatus.FORBIDDEN);
      }

      // Validate invite code
      const inviteValidation = await this.waitlistService.validateInviteCode(params.data.attributes.inviteCode);
      if (!inviteValidation || !inviteValidation.valid) {
        throw new HttpException("Invalid or expired invitation code", HttpStatus.FORBIDDEN);
      }
    }

    await this.userService.expectNotExists({ email: params.data.attributes.email });

    const company = await this.companyRepository.createByName({
      name: params.data.attributes.companyName ?? params.data.attributes.name,
    });

    const password = await hashPassword(params.data.attributes.password);

    const user = await this.users.create({
      userId: params.data.id,
      email: params.data.attributes.email,
      name: params.data.attributes.name,
      password: password,
      companyId: company.id,
      roleIds: [RoleId.CompanyAdministrator],
      termsAcceptedAt: params.data.attributes.termsAcceptedAt,
      marketingConsent: params.data.attributes.marketingConsent,
      marketingConsentAt: params.data.attributes.marketingConsentAt,
    });

    // After successful registration, mark waitlist entry as registered
    if (registrationMode === "waitlist" && params.data.attributes.inviteCode) {
      await this.waitlistService.markAsRegistered({
        inviteCode: params.data.attributes.inviteCode,
        userId: user.id,
      });
    }

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

    // Queue trial creation now that account is activated
    if (user.company?.id) {
      await this.trialQueueService.queueTrialCreation({
        companyId: user.company.id,
        userId: user.id,
      });
    }

    // Notify platform administrators (non-blocking)
    await this.notifyAdminsOfRegistration(user);
  }

  async completeOAuthRegistration(params: {
    pendingId: string;
    termsAcceptedAt: string;
    marketingConsent: boolean;
    marketingConsentAt: string | null;
  }): Promise<{ code: string }> {
    // Get pending registration from Redis
    const pending = await this.pendingRegistrationService.get(params.pendingId);
    if (!pending) {
      throw new HttpException("Pending registration not found or expired", HttpStatus.NOT_FOUND);
    }

    // Check if registration is allowed
    if (!this.authConfig.allowRegistration) {
      throw new HttpException("Registration is currently disabled", HttpStatus.FORBIDDEN);
    }

    // Check registration mode
    const registrationMode = this.authConfig.registrationMode ?? "open";

    if (registrationMode === "closed") {
      throw new HttpException("Registration is currently closed", HttpStatus.FORBIDDEN);
    }

    if (registrationMode === "waitlist") {
      // Require invite code for waitlist mode
      if (!pending.inviteCode) {
        throw new HttpException("Registration requires an invitation. Please join the waitlist.", HttpStatus.FORBIDDEN);
      }

      // Validate invite code
      const inviteValidation = await this.waitlistService.validateInviteCode(pending.inviteCode);
      if (!inviteValidation || !inviteValidation.valid) {
        throw new HttpException("Invalid or expired invitation code", HttpStatus.FORBIDDEN);
      }
    }

    // Generate IDs for new user and company
    const userId = randomUUID();
    const companyId = randomUUID();

    // Create user based on provider
    if (pending.provider === "discord") {
      await this.discordUserService.create({
        userId,
        companyId,
        userDetails: {
          id: pending.providerUserId,
          email: pending.email,
          username: pending.name,
          avatar: pending.avatar,
        },
        termsAcceptedAt: params.termsAcceptedAt,
        marketingConsent: params.marketingConsent,
        marketingConsentAt: params.marketingConsentAt,
      });
    } else if (pending.provider === "google") {
      await this.googleUserService.create({
        userId,
        companyId,
        userDetails: {
          id: pending.providerUserId,
          email: pending.email,
          name: pending.name,
          picture: pending.avatar,
        },
        termsAcceptedAt: params.termsAcceptedAt,
        marketingConsent: params.marketingConsent,
        marketingConsentAt: params.marketingConsentAt,
      });
    } else {
      throw new HttpException(`Unsupported provider: ${pending.provider}`, HttpStatus.BAD_REQUEST);
    }

    // Set CLS context
    this.clsService.set("companyId", companyId);
    this.clsService.set("userId", userId);

    // Queue trial creation (async, non-blocking)
    await this.trialQueueService.queueTrialCreation({
      companyId: companyId,
      userId: userId,
    });

    // After successful OAuth registration, mark waitlist entry as registered
    if (registrationMode === "waitlist" && pending.inviteCode) {
      await this.waitlistService.markAsRegistered({
        inviteCode: pending.inviteCode,
        userId: userId,
      });
    }

    // Delete pending registration
    await this.pendingRegistrationService.delete(params.pendingId);

    // Get created user
    const user = await this.users.findByUserId({ userId });

    // Notify platform administrators (non-blocking)
    await this.notifyAdminsOfRegistration(user);

    // Create auth token
    const token: any = await this.createToken({ user });
    const authCodeId = randomUUID();

    await this.createCode({
      authCodeId,
      authId: token.data.attributes.refreshToken,
    });

    return { code: authCodeId };
  }

  /**
   * Send notification to all platform administrators about a new user registration.
   * Errors are logged but not thrown to avoid blocking the activation flow.
   */
  private async notifyAdminsOfRegistration(user: User): Promise<void> {
    try {
      const platformAdmins = await this.users.findPlatformAdministrators();

      if (platformAdmins.length === 0) {
        return;
      }

      const dashboardLink = `${this.appConfig.url}en/administration`;

      for (const admin of platformAdmins) {
        try {
          await this.emailService.sendEmail(
            "registrationAdminNotification",
            {
              to: admin.email,
              adminName: admin.name || "Administrator",
              userName: user.name,
              userEmail: user.email,
              companyName: user.company?.name || "N/A",
              activatedAt: new Date().toISOString(),
              dashboardLink,
            },
            "en",
          );
        } catch (emailError) {
          this.logger.error(`Failed to send registration notification to admin ${admin.email}:`, emailError);
        }
      }
    } catch (error) {
      this.logger.error("Failed to send registration admin notifications:", error);
    }
  }
}
