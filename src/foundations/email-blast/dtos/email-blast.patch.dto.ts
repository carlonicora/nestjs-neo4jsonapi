import { Type } from "class-transformer";
import { Equals, IsIn, IsEmail, IsNotEmpty, IsOptional, IsString, IsUUID, ValidateNested } from "class-validator";
import { EMAIL_PURPOSES, EmailPurpose } from "../../email-automation/utils/email-purpose";
import { emailBlastMeta } from "../entities/email-blast.meta";

// No status, counters or dates are accepted: the global whitelist strips them.
export class EmailBlastPatchAttributesDTO {
  @IsOptional()
  @IsNotEmpty()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsNotEmpty()
  @IsString()
  body?: string;

  @IsOptional()
  @IsEmail()
  replyTo?: string;

  // Optional at the API: a missing value counts as Marketing.
  @IsOptional()
  @IsIn(EMAIL_PURPOSES)
  purpose?: EmailPurpose;
}

export class EmailBlastPatchDataDTO {
  @Equals(emailBlastMeta.endpoint)
  type: string;

  @IsUUID()
  id: string;

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => EmailBlastPatchAttributesDTO)
  attributes: EmailBlastPatchAttributesDTO;
}

export class EmailBlastPatchDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => EmailBlastPatchDataDTO)
  data: EmailBlastPatchDataDTO;
}
