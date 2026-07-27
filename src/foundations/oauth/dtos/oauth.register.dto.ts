import { IsArray, IsIn, IsOptional, IsString, IsUrl } from "class-validator";

/**
 * OAuth Dynamic Client Registration Request (RFC 7591 Section 2)
 *
 * Used for POST /oauth/register. Field names follow the RFC 7591
 * client metadata wire format (snake_case).
 */
export class OAuthRegisterDto {
  @IsArray()
  @IsUrl({ require_tld: false }, { each: true })
  redirect_uris: string[];

  @IsString()
  @IsOptional()
  client_name?: string;

  @IsArray()
  @IsOptional()
  @IsIn(["authorization_code", "refresh_token"], { each: true })
  grant_types?: string[];

  @IsOptional()
  @IsIn(["none", "client_secret_basic", "client_secret_post"])
  token_endpoint_auth_method?: string;

  @IsString()
  @IsOptional()
  scope?: string;
}
