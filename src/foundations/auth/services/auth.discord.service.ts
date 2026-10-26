import { Inject, Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ModuleRef } from "@nestjs/core";
import axios from "axios";
import { randomUUID } from "crypto";
import { ClsService } from "nestjs-cls";
// Direct file import, NOT the `..` barrel — same DI-metadata cycle as
// auth.google.service.ts: through the barrel, `AuthService` is undefined when
// `design:paramtypes` is emitted and Nest cannot resolve the dependency.
import { AuthService } from "./auth.service";
import { BaseConfigInterface, ConfigApiInterface, ConfigAppInterface, ConfigAuthInterface } from "../../../config";
import { ConfigDiscordInterface } from "../../../config/interfaces/config.discord.interface";
import { DiscordUserService } from "../../discord-user";
import { DiscordUser } from "../../discord-user/entities/discord-user";
import { DiscordUserRepository } from "../../discord-user/repositories/discord-user.repository";
import { discordUser } from "../../discord-user/types/discord.user.type";
import { UserRepository } from "../../user";
import { WaitlistService } from "../../waitlist/services/waitlist.service";
import { parseSignupSourceParam } from "../../waitlist/utils/signup-source";
import { resolveRegistrationPass } from "../utils/resolve-registration-pass";
import { PendingRegistrationService } from "./pending-registration.service";

@Injectable()
export class AuthDiscordService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly discordUserRepository: DiscordUserRepository,
    private readonly discordUserService: DiscordUserService,
    private readonly authService: AuthService,
    private readonly config: ConfigService<BaseConfigInterface>,
    private readonly clsService: ClsService,
    private readonly pendingRegistrationService: PendingRegistrationService,
    private readonly moduleRef: ModuleRef,
    // Optional for the same reason as in AuthService: an app may compose auth
    // without WaitlistModule. The union type needs the explicit token.
    @Optional()
    @Inject(WaitlistService)
    private readonly waitlistService: WaitlistService | undefined,
  ) {}

  private readonly _discordApiUrl = "https://discord.com/api/";

  private get authConfig(): ConfigAuthInterface {
    return this.config.get<ConfigAuthInterface>("auth");
  }

  generateLoginUrl(inviteCode?: string, referralCode?: string, source?: string, pass?: string): string {
    // Encode invite code, referral code, sign-up source (raw JSON string) AND registration pass in state parameter
    const stateData = {
      nonce: randomUUID(),
      ...(inviteCode && { invite: inviteCode }),
      ...(referralCode && { referral: referralCode }),
      ...(source && { source }),
      ...(pass && { pass }),
    };
    const state = Buffer.from(JSON.stringify(stateData)).toString("base64url");

    const params = new URLSearchParams({
      client_id: this.config.get<ConfigDiscordInterface>("discord").clientId,
      redirect_uri: `${this.config.get<ConfigApiInterface>("api").url}auth/callback/discord`,
      response_type: "code",
      scope: "identify email",
      state,
    });

    return `${this._discordApiUrl}oauth2/authorize?${params.toString()}`;
  }

  parseStateData(state: string): { invite?: string; referral?: string; source?: string; pass?: string } | undefined {
    try {
      const stateData = JSON.parse(Buffer.from(state, "base64url").toString());
      return {
        invite: stateData.invite,
        referral: stateData.referral,
        source: typeof stateData.source === "string" ? stateData.source : undefined,
        ...(typeof stateData.pass === "string" && { pass: stateData.pass }),
      };
    } catch {
      return undefined;
    }
  }

  async handleDiscordLogin(params: {
    userDetails: discordUser;
    inviteCode?: string;
    referralCode?: string;
    source?: string;
    pass?: string;
  }): Promise<string> {
    const discordUser: DiscordUser = await this.discordUserRepository.findByDiscordId({
      discordId: params.userDetails.id,
    });

    // Existing user - normal login flow
    if (discordUser) {
      if (discordUser.user.avatar !== params.userDetails.avatar) {
        await this.userRepository.updateAvatar({
          userId: discordUser.user.id,
          avatar: params.userDetails.avatar,
        });
      }

      const token = (await this.authService.createToken({ user: discordUser.user })) as unknown as {
        data: { attributes: { refreshToken: string } };
      };
      const authCodeId = randomUUID();

      await this.authService.createCode({
        authCodeId: authCodeId,
        authId: token.data.attributes.refreshToken,
      });

      return `${this.config.get<ConfigAppInterface>("app").url}auth?code=${authCodeId}`;
    }

    // New user - check registration permissions
    if (!this.authConfig.allowRegistration) {
      return `${this.config.get<ConfigAppInterface>("app").url}oauth/error?error=registration_disabled`;
    }

    // Check registration mode before proceeding to consent
    const registrationMode = this.authConfig.registrationMode ?? "open";
    if (registrationMode === "closed") {
      return `${this.config.get<ConfigAppInterface>("app").url}oauth/error?error=registration_closed`;
    }

    // A new account needs an email; Discord accounts may have none.
    if (!params.userDetails.email?.trim()) {
      return `${this.config.get<ConfigAppInterface>("app").url}oauth/error?error=email_required`;
    }

    // A registration pass (app-provided hook) can let this Discord user register
    // past the waitlist. Without a hook, or with an invalid pass, it is ignored.
    let passAccepted = false;
    if (params.pass) {
      const registrationPass = resolveRegistrationPass(this.moduleRef);
      if (registrationPass) {
        const verdict = await registrationPass.validate({
          pass: params.pass,
          provider: "discord",
          providerUserId: params.userDetails.id,
        });
        if (verdict === "mismatch") {
          return `${this.config.get<ConfigAppInterface>("app").url}oauth/error?error=join_link_mismatch`;
        }
        passAccepted = verdict === "valid";
      }
    }

    if (registrationMode === "waitlist" && !params.inviteCode && !passAccepted) {
      return `${this.config.get<ConfigAppInterface>("app").url}oauth/error?error=waitlist_required`;
    }

    // An invite registers only the email it was sent to. An invalid invite is
    // left to completeOAuthRegistration, which rejects it.
    if (registrationMode === "waitlist" && params.inviteCode && !passAccepted && this.waitlistService) {
      const inviteValidation = await this.waitlistService.validateInviteCode(params.inviteCode);
      if (
        inviteValidation?.valid &&
        (params.userDetails.email ?? "").trim().toLowerCase() !== (inviteValidation.email ?? "").trim().toLowerCase()
      ) {
        return `${this.config.get<ConfigAppInterface>("app").url}oauth/error?error=invite_email_mismatch&invite=${encodeURIComponent(params.inviteCode)}`;
      }
    }

    // Store pending registration in Redis (include invite code AND referral code if present).
    // An accepted pass is stored instead of the invite, so a pass sign-up never consumes an invite.
    const pendingId = await this.pendingRegistrationService.create({
      provider: "discord",
      providerUserId: params.userDetails.id,
      email: params.userDetails.email,
      name: params.userDetails.username,
      avatar: params.userDetails.avatar,
      inviteCode: passAccepted ? undefined : params.inviteCode,
      referralCode: params.referralCode,
      source: parseSignupSourceParam(params.source),
      ...(passAccepted && { pass: params.pass }),
    });

    return `${this.config.get<ConfigAppInterface>("app").url}auth/consent?pending=${pendingId}`;
  }

  async exchangeCodeForToken(code: string): Promise<string> {
    const response = await axios.post(
      `${this._discordApiUrl}oauth2/token`,
      new URLSearchParams({
        client_id: this.config.get<ConfigDiscordInterface>("discord").clientId,
        client_secret: this.config.get<ConfigDiscordInterface>("discord").clientSecret,
        grant_type: "authorization_code",
        code: code,
        redirect_uri: `${this.config.get<ConfigApiInterface>("api").url}auth/callback/discord`,
      }).toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      },
    );

    return response.data.access_token;
  }

  async fetchUserDetails(accessToken: string): Promise<discordUser> {
    const response = await axios.get(`${this._discordApiUrl}users/@me`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const avatarUrl = response.data.avatar
      ? `~https://cdn.discordapp.com/avatars/${response.data.id}/${response.data.avatar}.png`
      : null;

    return {
      id: response.data.id,
      email: response.data.email,
      username: response.data.username,
      avatar: avatarUrl,
    };
  }
}
