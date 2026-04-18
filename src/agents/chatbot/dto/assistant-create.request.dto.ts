import { Type } from "class-transformer";
import {
  ArrayMinSize,
  Equals,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { conversationMeta } from "../entities/conversation.meta";

export class AssistantCreateMessageDto {
  @IsIn(["user"])
  role!: "user";

  @IsString()
  @IsNotEmpty()
  @MaxLength(10_000)
  content!: string;
}

export class AssistantCreateAttributesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AssistantCreateMessageDto)
  messages!: AssistantCreateMessageDto[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
}

export class AssistantCreateDataDto {
  @Equals(conversationMeta.endpoint)
  type!: string;

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => AssistantCreateAttributesDto)
  attributes!: AssistantCreateAttributesDto;
}

export class AssistantCreateRequestDto {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => AssistantCreateDataDto)
  data!: AssistantCreateDataDto;
}
