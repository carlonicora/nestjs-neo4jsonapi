import { Type } from "class-transformer";
import { Equals, IsEmail, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from "class-validator";
import { stripeCustomerMeta } from "../entities/stripe-customer.meta";

// Base DTO for reference with ID and type validation
export class StripeCustomerDTO {
  @Equals(stripeCustomerMeta.endpoint)
  type: string;

  @IsUUID()
  id: string;
}

// POST DTOs (for creating customers)
// All fields are optional - backend will auto-fetch from company if not provided
export class StripeCustomerPostAttributesDTO {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;
}

export class StripeCustomerPostDataDTO {
  @IsOptional()
  @Equals(stripeCustomerMeta.endpoint)
  type?: string;

  @IsOptional()
  @IsUUID()
  id?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => StripeCustomerPostAttributesDTO)
  attributes?: StripeCustomerPostAttributesDTO;
}

export class StripeCustomerPostDTO {
  @IsOptional()
  @ValidateNested()
  @Type(() => StripeCustomerPostDataDTO)
  data?: StripeCustomerPostDataDTO;

  @IsOptional()
  included?: any[];
}

// PUT DTOs (for updating customers)
export class StripeCustomerPutAttributesDTO {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  defaultPaymentMethodId?: string;
}

export class StripeCustomerPutDataDTO {
  @Equals(stripeCustomerMeta.endpoint)
  type: string;

  @IsUUID()
  id: string;

  @ValidateNested()
  @IsOptional()
  @Type(() => StripeCustomerPutAttributesDTO)
  attributes?: StripeCustomerPutAttributesDTO;
}

export class StripeCustomerPutDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => StripeCustomerPutDataDTO)
  data: StripeCustomerPutDataDTO;

  @IsOptional()
  included?: any[];
}
