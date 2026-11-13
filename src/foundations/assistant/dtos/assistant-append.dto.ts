import { Type } from "class-transformer";
import {
  Equals,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Validate,
  ValidateNested,
} from "class-validator";
import type { AssistantClientContext } from "../../../common/interfaces/assistant.client-context.interface";
import { AssistantClientContextConstraint } from "./assistant-client-context.constraint";

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

  @IsOptional()
  @IsBoolean()
  handbookMode?: boolean;

  @IsOptional()
  @IsString()
  limitToHandbookPageId?: string;

  /**
   * Opaque context the client attaches to this user message (string values
   * only). Stored on the message and handed to the turn's seed providers and
   * operator tools.
   */
  @IsOptional()
  @Validate(AssistantClientContextConstraint)
  clientContext?: AssistantClientContext;
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
