import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { ClsService } from "nestjs-cls";
import { SystemRoles } from "../../../common/constants/system.roles";

type CompanyConfigurationsLike = { hasRole(role: string): boolean };

export const hashPassword = async (password: string): Promise<string> => {
  const salt = await bcrypt.genSalt(10);
  const hash = await bcrypt.hash(password, salt);
  return hash;
};

export const checkPassword = async (password: string, hash: string): Promise<boolean> => {
  return bcrypt.compare(password, hash);
};

@Injectable()
export class SecurityService {
  constructor(
    protected readonly jwtService: JwtService,
    protected readonly clsService: ClsService,
  ) {}

  get refreshTokenExpiration(): Date {
    return new Date(new Date().getTime() + 7 * 24 * 60 * 60 * 1000);
  }

  get tokenExpiration(): Date {
    return new Date(new Date().getTime() + 24 * 60 * 60 * 1000);
  }

  signJwt(params: {
    userId: string;
    roles: string[];
    companyId: string;
    features: string[];
    userName?: string;
  }): string {
    return this.jwtService.sign({
      userId: params.userId,
      roles: params.roles.map((role) => role),
      companyId: params.companyId,
      features: params.features,
      userName: params.userName,
      expiration: this.tokenExpiration,
    });
  }

  get invitationSelectionTokenExpiration(): Date {
    return new Date(new Date().getTime() + 10 * 60 * 1000);
  }

  signInvitationSelectionJwt(params: { userId: string }): string {
    return this.jwtService.sign({
      userId: params.userId,
      scope: "invitation-selection",
      expiration: this.invitationSelectionTokenExpiration,
    });
  }

  isCurrentUserCompanyAdmin(): boolean {
    const configurations = this.clsService.get<CompanyConfigurationsLike>("companyConfigurations");
    return configurations?.hasRole(SystemRoles.CompanyAdministrator) ?? false;
  }

  validateAdmin(params: { user: any }): void {
    if (
      !this.isUserInRoles({
        user: params.user,
        roles: [SystemRoles.Administrator, SystemRoles.CompanyAdministrator],
      })
    )
      throw new Error("User is not an admin");
  }

  isUserInRoles(params: { user: any; roles: string[] }): boolean {
    if (!params.user || !params.user.roles) return false;
    return params.roles.some((role: string) => params.user.roles.includes(role));
  }

  userHasAccess(params: { validator: (params?: any) => string }): string {
    const isAutomatedJob = this.clsService.get("isAutomatedJob");
    if (isAutomatedJob) return "";
    return params.validator();
  }

  /**
   * Generate a pending JWT for 2FA flows.
   * This token has limited access and a short TTL (5 minutes).
   * It includes the userId and indicates that 2FA verification is required.
   *
   * @param params - The parameters for the pending JWT
   * @param params.userId - The user's ID
   * @param params.pendingId - The pending 2FA session ID
   * @returns The signed pending JWT
   */
  signPendingJwt(params: { userId: string; pendingId: string }): string {
    const expiration = new Date(new Date().getTime() + 5 * 60 * 1000); // 5 minutes

    return this.jwtService.sign({
      userId: params.userId,
      pendingId: params.pendingId,
      pending: true,
      type: "pending_2fa",
      expiration: expiration,
    });
  }

  /**
   * Check if a JWT payload is a pending 2FA token.
   * Pending tokens have limited access and require 2FA verification
   * before being exchanged for a full access token.
   *
   * @param payload - The decoded JWT payload
   * @returns true if this is a pending 2FA token
   */
  isPendingToken(payload: any): boolean {
    return payload?.pending === true && payload?.type === "pending_2fa";
  }

  /**
   * Get the expiration time for pending 2FA tokens (5 minutes).
   */
  get pendingTokenExpiration(): Date {
    return new Date(new Date().getTime() + 5 * 60 * 1000);
  }
}
