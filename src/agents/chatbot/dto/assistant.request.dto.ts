import { IsArray, IsIn, IsNotEmpty, IsString, MaxLength, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

export class AssistantMessageDto {
  @IsIn(["user", "assistant", "system"])
  role!: "user" | "assistant" | "system";

  @IsString()
  @IsNotEmpty()
  @MaxLength(10_000)
  content!: string;
}

export class AssistantRequestDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AssistantMessageDto)
  messages!: AssistantMessageDto[];
}
