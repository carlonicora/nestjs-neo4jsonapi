import { Type } from "class-transformer";
import { Equals, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from "class-validator";
import { conversationMeta } from "../entities/conversation.meta";

export class AssistantPatchAttributesDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;
}

export class AssistantPatchDataDto {
  @Equals(conversationMeta.endpoint)
  type!: string;

  @IsUUID()
  id!: string;

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => AssistantPatchAttributesDto)
  attributes!: AssistantPatchAttributesDto;
}

export class AssistantPatchRequestDto {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => AssistantPatchDataDto)
  data!: AssistantPatchDataDto;
}
