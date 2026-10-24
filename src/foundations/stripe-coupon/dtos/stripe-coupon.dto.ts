import { Type } from "class-transformer";
import { Equals, IsNotEmpty, IsUUID, ValidateNested } from "class-validator";
import { stripeCouponMeta } from "../entities/stripe-coupon.meta";

export class StripeCouponDTO {
  @Equals(stripeCouponMeta.endpoint)
  type: string;

  @IsUUID()
  id: string;
}

export class StripeCouponDataDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => StripeCouponDTO)
  data: StripeCouponDTO;
}
