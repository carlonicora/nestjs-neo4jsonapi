import { Equals, IsNotEmpty, IsString, MaxLength, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

export class AssistantAppendAttributesDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(10_000)
  content!: string;
}

export class AssistantAppendDataDto {
  @Equals("messages")
  type!: string;

  @ValidateNested()
  @Type(() => AssistantAppendAttributesDto)
  attributes!: AssistantAppendAttributesDto;
}

export class AssistantAppendRequestDto {
  @ValidateNested()
  @Type(() => AssistantAppendDataDto)
  data!: AssistantAppendDataDto;
}
