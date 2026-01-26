import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios from "axios";
import { randomUUID } from "crypto";
import { ClsService } from "nestjs-cls";
import { AuthService } from "..";
import { BaseConfigInterface, ConfigApiInterface, ConfigAppInterface, ConfigAuthInterface } from "../../../config";
import { ConfigGoogleInterface } from "../../../config/interfaces/config.google.interface";
import { GoogleUser } from "../../google-user/entities/google-user";
import { GoogleUserRepository } from "../../google-user/repositories/google-user.repository";
import { googleUser } from "../../google-user/types/google.user.type";
import { UserRepository } from "../../user";
import { PendingRegistrationService } from "./pending-registration.service";

@Injectable()
export class AuthGoogleService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly googleUserRepository: GoogleUserRepository,
    private readonly authService: AuthService,
    private readonly config: ConfigService<BaseConfigInterface>,
    private readonly clsService: ClsService,
    private readonly pendingRegistrationService: PendingRegistrationService,
  ) {}

  private readonly _googleAuthUrl = "https://accounts.google.com/o/oauth2/v2/auth";
  private readonly _googleTokenUrl = "https://oauth2.googleapis.com/token";
  private readonly _googleUserInfoUrl = "https://www.googleapis.com/oauth2/v2/userinfo";

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
      client_id: this.config.get<ConfigGoogleInterface>("google").clientId,
      redirect_uri: `${this.config.get<ConfigApiInterface>("api").url}auth/callback/google`,
      response_type: "code",
      scope: "https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile",
      access_type: "offline",
      state,
    });

    return `${this._googleAuthUrl}?${params.toString()}`;
  }

  parseInviteCodeFromState(state: string): string | undefined {
    try {
      const stateData = JSON.parse(Buffer.from(state, "base64url").toString());
      return stateData.invite;
    } catch {
      return undefined;
    }
  }

  async handleGoogleLogin(params: { userDetails: googleUser; inviteCode?: string }): Promise<string> {
    const googleUser: GoogleUser = await this.googleUserRepository.findByGoogleId({
      googleId: params.userDetails.id,
    });

    // Existing user - normal login flow
    if (googleUser) {
      if (params.userDetails.picture && googleUser.user.avatar !== params.userDetails.picture) {
        await this.userRepository.updateAvatar({
          userId: googleUser.user.id,
          avatar: params.userDetails.picture,
        });
      }

      const token: any = await this.authService.createToken({ user: googleUser.user });
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
      provider: "google",
      providerUserId: params.userDetails.id,
      email: params.userDetails.email,
      name: params.userDetails.name,
      avatar: params.userDetails.picture,
      inviteCode: params.inviteCode,
    });

    return `${this.config.get<ConfigAppInterface>("app").url}auth/consent?pending=${pendingId}`;
  }

  async exchangeCodeForToken(code: string): Promise<string> {
    const response = await axios.post(
      this._googleTokenUrl,
      new URLSearchParams({
        client_id: this.config.get<ConfigGoogleInterface>("google").clientId,
        client_secret: this.config.get<ConfigGoogleInterface>("google").clientSecret,
        grant_type: "authorization_code",
        code: code,
        redirect_uri: `${this.config.get<ConfigApiInterface>("api").url}auth/callback/google`,
      }).toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      },
    );

    return response.data.access_token;
  }

  async fetchUserDetails(accessToken: string): Promise<googleUser> {
    const response = await axios.get(this._googleUserInfoUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    return {
      id: response.data.id,
      email: response.data.email,
      name: response.data.name,
      picture: response.data.picture ?? null,
    };
  }
}
