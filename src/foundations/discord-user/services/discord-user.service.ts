import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { ClsService } from "nestjs-cls";
import { RoleId } from "../../../common";
import { CompanyRepository } from "../../company";
import { UserRepository } from "../../user";
import { DiscordUserRepository } from "../repositories/discord-user.repository";
import { discordUser } from "../types/discord.user.type";

@Injectable()
export class DiscordUserService {
  constructor(
    private readonly discordUserRepository: DiscordUserRepository,
    private readonly userRepository: UserRepository,
    private readonly companyRepository: CompanyRepository,
    private readonly clsService: ClsService,
  ) {}

  async create(params: {
    userId: string;
    companyId: string;
    userDetails: discordUser;
    termsAcceptedAt?: string;
    marketingConsent?: boolean;
    marketingConsentAt?: string | null;
  }): Promise<void> {
    this.clsService.set("companyId", params.companyId);
    this.clsService.set("userId", params.userId);

    await this.companyRepository.create({
      companyId: params.companyId,
      name: `${params.userDetails.username}`,
    });

    await this.userRepository.createUser({
      userId: params.userId,
      email: params.userDetails.email ?? params.userDetails.id,
      name: params.userDetails.username,
      password: randomUUID(),
      companyId: params.companyId,
      avatar: params.userDetails.avatar,
      roleIds: [RoleId.CompanyAdministrator],
      isActive: true,
      termsAcceptedAt: params.termsAcceptedAt,
      marketingConsent: params.marketingConsent,
      marketingConsentAt: params.marketingConsentAt ?? undefined,
    });

    await this.discordUserRepository.create({
      id: params.userId,
      discordId: params.userDetails.id,
      name: params.userDetails.username,
      user: params.userId,
    });
  }
}
