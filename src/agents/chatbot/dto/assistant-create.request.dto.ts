import { Equals, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { conversationMeta } from "../entities/conversation.meta";

export class AssistantCreateAttributesDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(10_000)
  content!: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  title?: string;
}

export class AssistantCreateDataDto {
  @Equals(conversationMeta.endpoint)
  type!: string;

  @ValidateNested()
  @Type(() => AssistantCreateAttributesDto)
  attributes!: AssistantCreateAttributesDto;
}

export class AssistantCreateRequestDto {
  @ValidateNested()
  @Type(() => AssistantCreateDataDto)
  data!: AssistantCreateDataDto;
}
