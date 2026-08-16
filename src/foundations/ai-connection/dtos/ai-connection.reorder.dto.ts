import { Type } from "class-transformer";
import { ArrayNotEmpty, Equals, IsDefined, IsNotEmpty, IsUUID, ValidateNested } from "class-validator";
import { aiConnectionMeta } from "../entities/ai-connection.meta";

export class AiConnectionReorderDataDTO {
  @Equals(aiConnectionMeta.endpoint)
  type: string;

  @IsDefined()
  @ArrayNotEmpty()
  @IsUUID(undefined, { each: true })
  ids: string[];
}

export class AiConnectionReorderDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => AiConnectionReorderDataDTO)
  data: AiConnectionReorderDataDTO;
}
