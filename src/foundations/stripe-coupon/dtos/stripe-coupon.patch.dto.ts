import { Type } from "class-transformer";
import { Equals, IsNotEmpty, IsOptional, IsString, IsUUID, ValidateNested } from "class-validator";
import { stripeCouponMeta } from "../entities/stripe-coupon.meta";

export class StripeCouponPatchAttributesDTO {
  @IsOptional()
  @IsNotEmpty()
  @IsString()
  name?: string;
}

export class StripeCouponPatchDataDTO {
  @Equals(stripeCouponMeta.endpoint)
  type: string;

  @IsUUID()
  id: string;

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => StripeCouponPatchAttributesDTO)
  attributes: StripeCouponPatchAttributesDTO;
}

export class StripeCouponPatchDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => StripeCouponPatchDataDTO)
  data: StripeCouponPatchDataDTO;
}
