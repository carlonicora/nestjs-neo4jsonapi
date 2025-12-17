import { Injectable } from "@nestjs/common";
import { EmbedBuilder } from "discord.js";

@Injectable()
export class DiscordErrorSerialiser {
  serialise(params: { error: string; description?: string }): EmbedBuilder {
    const description = params.description ? `${params.error}\n${params.description}` : params.error;
    const embed = new EmbedBuilder().setTitle(`Error`).setDescription(description).setColor(0xff0000);

    return embed;
  }
}
