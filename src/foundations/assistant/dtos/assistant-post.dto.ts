import { Type } from "class-transformer";
import { Equals, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from "class-validator";
import { assistantMeta } from "../entities/assistant.meta";

export class AssistantPostAttributesDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(10_000)
  content!: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  title?: string;
}

export class AssistantPostDataDto {
  @Equals(assistantMeta.endpoint)
  type!: string;

  @ValidateNested()
  @Type(() => AssistantPostAttributesDto)
  attributes!: AssistantPostAttributesDto;
}

export class AssistantPostDto {
  @ValidateNested()
  @Type(() => AssistantPostDataDto)
  data!: AssistantPostDataDto;
}
