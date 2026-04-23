import { Type } from "class-transformer";
import { Equals, IsNotEmpty, IsUUID, ValidateNested } from "class-validator";
import { assistantMessageMeta } from "../entities/assistant-message.meta";

export class AssistantMessageDTO {
  @Equals(assistantMessageMeta.type)
  type!: string;

  @IsUUID()
  id!: string;
}

export class AssistantMessageDataDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => AssistantMessageDTO)
  data!: AssistantMessageDTO;
}

export class AssistantMessageDataListDTO {
  @ValidateNested({ each: true })
  @IsNotEmpty()
  @Type(() => AssistantMessageDTO)
  data!: AssistantMessageDTO[];
}
