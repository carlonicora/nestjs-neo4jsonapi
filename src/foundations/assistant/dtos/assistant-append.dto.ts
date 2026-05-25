import { Type } from "class-transformer";
import { Equals, IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from "class-validator";

export class AssistantAppendAttributesDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(10_000)
  content!: string;

  @IsOptional()
  @IsBoolean()
  howToMode?: boolean;

  @IsOptional()
  @IsString()
  limitToHowToId?: string;
}

export class AssistantAppendDataDto {
  @Equals("assistant-messages")
  type!: string;

  @ValidateNested()
  @Type(() => AssistantAppendAttributesDto)
  attributes!: AssistantAppendAttributesDto;
}

export class AssistantAppendDto {
  @ValidateNested()
  @Type(() => AssistantAppendDataDto)
  data!: AssistantAppendDataDto;
}
