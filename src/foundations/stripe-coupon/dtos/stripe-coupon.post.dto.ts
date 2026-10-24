import { Type } from "class-transformer";
import {
  Equals,
  IsArray,
  IsDateString,
  IsDefined,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import { stripeCouponMeta } from "../entities/stripe-coupon.meta";
import type { StripeCouponDiscountType, StripeCouponDurationType } from "../entities/stripe-coupon";
import { StripeCouponCodePostAttributesDTO } from "./stripe-coupon-code.post.dto";

/** The customer-facing code created together with the coupon: same attributes as a code POST. */
export class StripeCouponFirstCodeAttributesDTO extends StripeCouponCodePostAttributesDTO {}

export class StripeCouponPostAttributesDTO {
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  name: string;

  /** Optional custom Stripe coupon id; Stripe generates one when absent. */
  @IsOptional()
  @IsNotEmpty()
  @IsString()
  stripeCouponId?: string;

  @IsDefined()
  @IsIn(["percent_off", "amount_off"])
  discountType: StripeCouponDiscountType;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(100)
  percentOff?: number;

  /** Minor units (cents). */
  @IsOptional()
  @IsInt()
  @Min(1)
  amountOff?: number;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @IsDefined()
  @IsIn(["once", "repeating", "forever"])
  duration: StripeCouponDurationType;

  @IsOptional()
  @IsInt()
  @Min(1)
  durationInMonths?: number;

  /** Our StripeProduct ids; absent or empty = every product. */
  @IsOptional()
  @IsArray()
  @IsUUID("4", { each: true })
  productIds?: string[];

  @IsOptional()
  @IsDateString()
  redeemBy?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxRedemptions?: number;

  @ValidateNested()
  @IsDefined()
  @Type(() => StripeCouponFirstCodeAttributesDTO)
  firstCode: StripeCouponFirstCodeAttributesDTO;
}

export class StripeCouponPostDataDTO {
  @Equals(stripeCouponMeta.endpoint)
  type: string;

  @IsUUID()
  id: string;

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => StripeCouponPostAttributesDTO)
  attributes: StripeCouponPostAttributesDTO;
}

export class StripeCouponPostDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => StripeCouponPostDataDTO)
  data: StripeCouponPostDataDTO;
}
