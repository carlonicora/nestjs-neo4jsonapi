import { IsDefined, IsUUID } from "class-validator";

/**
 * Query parameters of `GET stripe-coupon-codes/automatic`.
 */
export class StripeCouponCodeAutomaticQueryDTO {
  /** Our StripePrice id the GM is about to buy. */
  @IsDefined()
  @IsUUID()
  priceId: string;
}
