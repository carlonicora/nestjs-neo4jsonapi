import { Type } from "class-transformer";
import { Equals, IsDefined, IsNotEmpty, IsString, IsUUID, ValidateNested } from "class-validator";
import { discordConnectIntentMeta } from "../entities/discord-connect-intent.meta";

export class DiscordConnectIntentPostAttributesDTO {
  @IsDefined()
  @IsString()
  @IsNotEmpty()
  returnPath: string;
}

export class DiscordConnectIntentPostDataDTO {
  @Equals(discordConnectIntentMeta.endpoint)
  type: string;

  @IsUUID()
  id: string;

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => DiscordConnectIntentPostAttributesDTO)
  attributes: DiscordConnectIntentPostAttributesDTO;
}

export class DiscordConnectIntentPostDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => DiscordConnectIntentPostDataDTO)
  data: DiscordConnectIntentPostDataDTO;
}
