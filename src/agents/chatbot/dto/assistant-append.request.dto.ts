import { Type } from "class-transformer";
import { Equals, IsIn, IsNotEmpty, IsString, MaxLength, ValidateNested } from "class-validator";

export class AssistantAppendAttributesDto {
  @IsIn(["user"])
  role!: "user";

  @IsString()
  @IsNotEmpty()
  @MaxLength(10_000)
  content!: string;
}

export class AssistantAppendDataDto {
  @Equals("messages")
  type!: string;

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => AssistantAppendAttributesDto)
  attributes!: AssistantAppendAttributesDto;
}

export class AssistantAppendRequestDto {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => AssistantAppendDataDto)
  data!: AssistantAppendDataDto;
}
