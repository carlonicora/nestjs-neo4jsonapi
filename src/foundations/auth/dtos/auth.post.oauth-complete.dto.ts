import { Type } from "class-transformer";
import { Equals, IsBoolean, IsDateString, IsNotEmpty, IsOptional, IsUUID, ValidateNested } from "class-validator";
import { authMeta } from "../../auth/entities/auth.meta";

/**
 * Consent for an OAuth sign-up. Every field is optional: a sign-up with a
 * usable waitlist invite takes its consent from the waitlist entry, and the
 * service refuses any other sign-up that has no `termsAcceptedAt`.
 */
export class AuthPostOAuthCompleteAttributesDTO {
  @IsOptional()
  @IsDateString()
  termsAcceptedAt?: string;

  @IsOptional()
  @IsBoolean()
  marketingConsent?: boolean;

  @IsOptional()
  @IsDateString()
  marketingConsentAt?: string | null;
}

export class AuthPostOAuthCompleteDataDTO {
  @Equals(authMeta.endpoint)
  type: string;

  /** The pending registration id. */
  @IsUUID()
  id: string;

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => AuthPostOAuthCompleteAttributesDTO)
  attributes: AuthPostOAuthCompleteAttributesDTO;
}

export class AuthPostOAuthCompleteDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => AuthPostOAuthCompleteDataDTO)
  data: AuthPostOAuthCompleteDataDTO;
}
