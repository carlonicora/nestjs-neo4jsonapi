import { Type } from "class-transformer";
import { Equals, IsBoolean, IsNotEmpty, IsOptional, IsUUID, ValidateNested } from "class-validator";
import { stripeCouponCodeMeta } from "../entities/stripe-coupon-code.meta";

export class StripeCouponCodePatchAttributesDTO {
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsBoolean()
  automatic?: boolean;
}

export class StripeCouponCodePatchDataDTO {
  @Equals(stripeCouponCodeMeta.endpoint)
  type: string;

  @IsUUID()
  id: string;

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => StripeCouponCodePatchAttributesDTO)
  attributes: StripeCouponCodePatchAttributesDTO;
}

export class StripeCouponCodePatchDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => StripeCouponCodePatchDataDTO)
  data: StripeCouponCodePatchDataDTO;
}
