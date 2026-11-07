import { Type } from "class-transformer";
import { Equals, IsNotEmpty, IsUUID, ValidateNested } from "class-validator";
import { discordConnectConfirmationMeta } from "../entities/discord-connect-confirmation.meta";

export class DiscordConnectConfirmationPostDataDTO {
  @Equals(discordConnectConfirmationMeta.endpoint)
  type: string;

  /** The confirmation token the callback handed to the browser. */
  @IsUUID()
  id: string;
}

export class DiscordConnectConfirmationPostDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => DiscordConnectConfirmationPostDataDTO)
  data: DiscordConnectConfirmationPostDataDTO;
}
