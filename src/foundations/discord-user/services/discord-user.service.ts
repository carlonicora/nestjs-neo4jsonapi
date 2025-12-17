import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
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
  ) {}

  async create(params: { userId: string; companyId: string; userDetails: discordUser }): Promise<void> {
    await this.companyRepository.create({
      companyId: params.companyId,
      name: `${params.userDetails.username}`,
    });

    await this.userRepository.create({
      userId: params.userId,
      email: params.userDetails.email ?? params.userDetails.id,
      name: params.userDetails.username,
      password: randomUUID(),
      companyId: params.companyId,
      avatar: params.userDetails.avatar,
      roleIds: [RoleId.CompanyAdministrator],
    });

    await this.discordUserRepository.create({
      id: params.userId,
      discordId: params.userDetails.id,
      name: params.userDetails.username,
      user: params.userId,
    });
  }
}
