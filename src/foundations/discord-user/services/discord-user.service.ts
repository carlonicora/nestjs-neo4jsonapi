import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { ClsService } from "nestjs-cls";
import { RoleId } from "../../../common";
import { CompanyRepository } from "../../company";
import { UserRepository } from "../../user";
import { DiscordUserRepository } from "../repositories/discord-user.repository";
import { discordUser } from "../types/discord.user.type";
import { shouldUseDiscordAvatar } from "../utils/discord-avatar";

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

    await this.companyRepository.createCompanyNode({
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

  /**
   * Links a Discord account to an existing user (Discord connect). Creates no User and no Company:
   * the DiscordUser goes in the user's own company. The user's name is never changed; the Discord
   * picture is written only when {@link shouldUseDiscordAvatar} allows it.
   *
   * @returns "blocked" when the Discord id is already linked or the user already has Discord.
   */
  async link(params: { userId: string; userDetails: discordUser }): Promise<"linked" | "blocked"> {
    const user = await this.userRepository.findByUserId({ userId: params.userId });

    const linked = await this.discordUserRepository.linkToUser({
      userId: params.userId,
      discordId: params.userDetails.id,
      name: params.userDetails.username,
    });
    if (!linked) return "blocked";

    if (shouldUseDiscordAvatar(user?.avatar)) {
      await this.userRepository.updateAvatar({ userId: params.userId, avatar: params.userDetails.avatar });
    }

    return "linked";
  }
}
