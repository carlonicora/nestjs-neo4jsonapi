import { Type } from "class-transformer";
import {
  Equals,
  IsBoolean,
  IsDateString,
  IsDefined,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
  ValidateNested,
} from "class-validator";
import { stripeCouponCodeMeta } from "../entities/stripe-coupon-code.meta";
import { StripeCouponDataDTO } from "./stripe-coupon.dto";

export class StripeCouponCodePostAttributesDTO {
  @IsOptional()
  @IsNotEmpty()
  @IsString()
  code?: string;

  @IsOptional()
  @IsBoolean()
  firstTimeTransaction?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  minimumAmount?: number;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  minimumAmountCurrency?: string;

  @IsOptional()
  @IsString()
  stripeCustomerId?: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxRedemptions?: number;

  @IsOptional()
  @IsBoolean()
  automatic?: boolean;
}

export class StripeCouponCodePostRelationshipsDTO {
  @ValidateNested()
  @IsDefined()
  @Type(() => StripeCouponDataDTO)
  coupon: StripeCouponDataDTO;
}

export class StripeCouponCodePostDataDTO {
  @Equals(stripeCouponCodeMeta.endpoint)
  type: string;

  @IsUUID()
  id: string;

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => StripeCouponCodePostAttributesDTO)
  attributes: StripeCouponCodePostAttributesDTO;

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => StripeCouponCodePostRelationshipsDTO)
  relationships: StripeCouponCodePostRelationshipsDTO;
}

export class StripeCouponCodePostDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => StripeCouponCodePostDataDTO)
  data: StripeCouponCodePostDataDTO;
}
