import { Equals, IsArray, IsIn, IsNotEmpty, IsString, MaxLength, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { assistantMeta } from "../entities/assistant.meta";

export class AssistantMessageDto {
  @IsIn(["user", "assistant", "system"])
  role!: "user" | "assistant" | "system";

  @IsString()
  @IsNotEmpty()
  @MaxLength(10_000)
  content!: string;
}

export class AssistantRequestAttributesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AssistantMessageDto)
  messages!: AssistantMessageDto[];
}

export class AssistantRequestDataDto {
  @Equals(assistantMeta.endpoint)
  type!: string;

  @ValidateNested()
  @Type(() => AssistantRequestAttributesDto)
  attributes!: AssistantRequestAttributesDto;
}

export class AssistantRequestDto {
  @ValidateNested()
  @Type(() => AssistantRequestDataDto)
  data!: AssistantRequestDataDto;
}
