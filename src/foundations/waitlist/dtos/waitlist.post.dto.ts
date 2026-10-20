import { Type } from "class-transformer";
import {
  Equals,
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from "class-validator";
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

  @IsOptional()
  @IsString()
  @MaxLength(200)
  sourceRef?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  sourceUtmSource?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  sourceUtmMedium?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  sourceUtmCampaign?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  sourceReferrer?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  sourceLandingPath?: string;
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
