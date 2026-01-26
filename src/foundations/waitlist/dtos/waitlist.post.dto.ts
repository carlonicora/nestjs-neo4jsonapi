import { Type } from "class-transformer";
import { Equals, IsBoolean, IsEmail, IsNotEmpty, IsOptional, IsString, IsUUID, ValidateNested } from "class-validator";
import { waitlistMeta } from "../entities/waitlist.meta";

export class WaitlistPostAttributesDTO {
  @IsEmail()
  email: string;

  @IsBoolean()
  gdprConsent: boolean;

  @IsBoolean()
  @IsOptional()
  marketingConsent?: boolean;

  @IsString()
  @IsOptional()
  questionnaire?: string;
}

export class WaitlistPostDataDTO {
  @Equals(waitlistMeta.type)
  type: string;

  @IsUUID()
  id: string;

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => WaitlistPostAttributesDTO)
  attributes: WaitlistPostAttributesDTO;
}

export class WaitlistPostDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => WaitlistPostDataDTO)
  data: WaitlistPostDataDTO;
}
