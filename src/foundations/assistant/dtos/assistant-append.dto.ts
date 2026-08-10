import { Type } from "class-transformer";
import { Equals, IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from "class-validator";

export class AssistantAppendAttributesDto {
  /**
   * This user message. Either plain text, or — following the host app's
   * BlockNote convention — a JSON-serialised BlockNote document, which the
   * server detects and converts. An append carries no binding; it inherits
   * the thread's.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(200_000)
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
