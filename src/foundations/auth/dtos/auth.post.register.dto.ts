import { Type } from "class-transformer";
import {
  Equals,
  IsBoolean,
  IsDefined,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from "class-validator";
import { authMeta } from "../../auth/entities/auth.meta";

export class AuthPostRegisterAttributesDTO {
  @IsOptional()
  @IsString()
  companyName?: string;

  @IsDefined()
  @IsString()
  name: string;

  @IsDefined()
  @IsEmail()
  email: string;

  @IsDefined()
  @IsString()
  password: string;

  @IsDefined()
  @IsString()
  termsAcceptedAt: string;

  @IsOptional()
  @IsBoolean()
  marketingConsent?: boolean;

  @IsOptional()
  @IsString()
  marketingConsentAt?: string;

  @IsOptional()
  @IsString()
  inviteCode?: string;
}

export class AuthPostRegisterDataDTO {
  @Equals(authMeta.endpoint)
  type: string;

  @IsUUID()
  id: string;

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => AuthPostRegisterAttributesDTO)
  attributes: AuthPostRegisterAttributesDTO;
}

export class AuthPostRegisterDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => AuthPostRegisterDataDTO)
  data: AuthPostRegisterDataDTO;
}
