import { Type } from "class-transformer";
import {
  Equals,
  IsIn,
  IsDefined,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from "class-validator";
import { EMAIL_PURPOSES, EmailPurpose } from "../../email-automation/utils/email-purpose";
import { emailBlastMeta } from "../entities/email-blast.meta";

// No status, counters or dates are accepted: the global whitelist strips them.
export class EmailBlastPostAttributesDTO {
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  subject: string;

  @IsDefined()
  @IsNotEmpty()
  @IsString()
  body: string;

  @IsOptional()
  @IsEmail()
  replyTo?: string;

  // Optional at the API: a missing value counts as Marketing.
  @IsOptional()
  @IsIn(EMAIL_PURPOSES)
  purpose?: EmailPurpose;
}

export class EmailBlastPostDataDTO {
  @Equals(emailBlastMeta.endpoint)
  type: string;

  @IsUUID()
  id: string;

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => EmailBlastPostAttributesDTO)
  attributes: EmailBlastPostAttributesDTO;
}

export class EmailBlastPostDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => EmailBlastPostDataDTO)
  data: EmailBlastPostDataDTO;
}
