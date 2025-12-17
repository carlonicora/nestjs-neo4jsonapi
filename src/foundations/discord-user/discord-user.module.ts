import { Module } from "@nestjs/common";
import { CompanyModule } from "../company";
import { UserModule } from "../user";
import { DiscordUserRepository } from "./repositories/discord-user.repository";
import { DiscordUserService } from "./services/discord-user.service";

@Module({
  controllers: [],
  providers: [DiscordUserRepository, DiscordUserService],
  exports: [DiscordUserRepository, DiscordUserService],
  imports: [CompanyModule, UserModule],
})
export class DiscordUserModule {}
