import { Injectable, Logger, Optional } from "@nestjs/common";
import { Client, RepliableInteraction } from "discord.js";

@Injectable()
export class DiscordService {
  private readonly logger = new Logger(DiscordService.name);

  constructor(@Optional() private readonly client?: Client) {}

  getClient(): Client | undefined {
    return this.client;
  }

  isReady(): boolean {
    return this.client?.isReady() ?? false;
  }

  isEnabled(): boolean {
    return !!this.client;
  }

  async handleInteractionError(
    interaction: RepliableInteraction,
    error: Error,
    message = "An error occurred while processing your command.",
  ): Promise<void> {
    this.logger.error(`Interaction error: ${error.message}`, error.stack);

    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: message, flags: 64 });
      } else if (interaction.deferred) {
        await interaction.editReply({ content: message });
      }
    } catch (replyError) {
      this.logger.error("Failed to send error response", replyError);
    }
  }
}
