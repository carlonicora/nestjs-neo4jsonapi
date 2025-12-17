import { Global, Module } from "@nestjs/common";
import { DiscordErrorSerialiser } from "./serialisers/discord.error.serialiser";
import { DiscordService } from "./services/discord.service";

@Global()
@Module({
  providers: [DiscordService, DiscordErrorSerialiser],
  exports: [DiscordService, DiscordErrorSerialiser],
})
export class DiscordModule {}
