import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { ClsService } from "nestjs-cls";
import { RoleId } from "../../../common";
import { CompanyRepository } from "../../company";
import { UserRepository } from "../../user";
import { GoogleUserRepository } from "../repositories/google-user.repository";
import { googleUser } from "../types/google.user.type";

@Injectable()
export class GoogleUserService {
  constructor(
    private readonly googleUserRepository: GoogleUserRepository,
    private readonly userRepository: UserRepository,
    private readonly companyRepository: CompanyRepository,
    private readonly clsService: ClsService,
  ) {}

  async create(params: {
    userId: string;
    companyId: string;
    userDetails: googleUser;
    termsAcceptedAt?: string;
    marketingConsent?: boolean;
    marketingConsentAt?: string | null;
  }): Promise<void> {
    this.clsService.set("companyId", params.companyId);
    this.clsService.set("userId", params.userId);

    await this.companyRepository.create({
      companyId: params.companyId,
      name: `${params.userDetails.name}`,
    });

    await this.userRepository.createUser({
      userId: params.userId,
      email: params.userDetails.email ?? params.userDetails.id,
      name: params.userDetails.name,
      password: randomUUID(),
      companyId: params.companyId,
      avatar: params.userDetails.picture,
      roleIds: [RoleId.CompanyAdministrator],
      isActive: true,
      termsAcceptedAt: params.termsAcceptedAt,
      marketingConsent: params.marketingConsent,
      marketingConsentAt: params.marketingConsentAt ?? undefined,
    });

    await this.googleUserRepository.create({
      id: params.userId,
      googleId: params.userDetails.id,
      name: params.userDetails.name,
      user: params.userId,
    });
  }
}
