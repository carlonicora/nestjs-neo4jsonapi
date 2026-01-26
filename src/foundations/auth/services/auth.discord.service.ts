import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios from "axios";
import { randomUUID } from "crypto";
import { ClsService } from "nestjs-cls";
import { AuthService } from "..";
import { BaseConfigInterface, ConfigApiInterface, ConfigAppInterface, ConfigAuthInterface } from "../../../config";
import { ConfigDiscordInterface } from "../../../config/interfaces/config.discord.interface";
import { DiscordUserService } from "../../discord-user";
import { DiscordUser } from "../../discord-user/entities/discord-user";
import { DiscordUserRepository } from "../../discord-user/repositories/discord-user.repository";
import { discordUser } from "../../discord-user/types/discord.user.type";
import { UserRepository } from "../../user";
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
  ) {}

  private readonly _discordApiUrl = "https://discord.com/api/";

  private get authConfig(): ConfigAuthInterface {
    return this.config.get<ConfigAuthInterface>("auth");
  }

  generateLoginUrl(inviteCode?: string): string {
    // Encode invite code in state parameter if present
    const stateData = {
      nonce: randomUUID(),
      ...(inviteCode && { invite: inviteCode }),
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

  parseInviteCodeFromState(state: string): string | undefined {
    try {
      const stateData = JSON.parse(Buffer.from(state, "base64url").toString());
      return stateData.invite;
    } catch {
      return undefined;
    }
  }

  async handleDiscordLogin(params: { userDetails: discordUser; inviteCode?: string }): Promise<string> {
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

      const token: any = await this.authService.createToken({ user: discordUser.user });
      const authCodeId = randomUUID();

      await this.authService.createCode({
        authCodeId: authCodeId,
        authId: token.data.attributes.refreshToken,
      });

      return `${this.config.get<ConfigAppInterface>("app").url}auth?code=${authCodeId}`;
    }

    // New user - redirect to consent page
    if (!this.authConfig.allowRegistration) {
      return `${this.config.get<ConfigAppInterface>("app").url}auth?error=registration_disabled`;
    }

    // Store pending registration in Redis (include invite code if present)
    const pendingId = await this.pendingRegistrationService.create({
      provider: "discord",
      providerUserId: params.userDetails.id,
      email: params.userDetails.email,
      name: params.userDetails.username,
      avatar: params.userDetails.avatar,
      inviteCode: params.inviteCode,
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
