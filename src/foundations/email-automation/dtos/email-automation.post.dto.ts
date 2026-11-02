import { Type } from "class-transformer";
import {
  Equals,
  IsBoolean,
  IsDefined,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from "class-validator";
import { emailAutomationMeta } from "../entities/email-automation.meta";
import { EMAIL_PURPOSES, EmailPurpose } from "../utils/email-purpose";

export class EmailAutomationPostAttributesDTO {
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  trigger?: string;

  @IsOptional()
  @IsString()
  exitTrigger?: string;

  @IsOptional()
  @IsString()
  @IsEmail()
  replyTo?: string;

  @IsOptional()
  @IsIn(EMAIL_PURPOSES)
  purpose?: EmailPurpose;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class EmailAutomationPostDataDTO {
  @Equals(emailAutomationMeta.endpoint)
  type: string;

  @IsUUID()
  id: string;

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => EmailAutomationPostAttributesDTO)
  attributes: EmailAutomationPostAttributesDTO;
}

export class EmailAutomationPostDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => EmailAutomationPostDataDTO)
  data: EmailAutomationPostDataDTO;
}
