import { Type } from "class-transformer";
import { Equals, IsDefined, IsEmail, IsNotEmpty, IsOptional, IsString, IsUUID, ValidateNested } from "class-validator";
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
