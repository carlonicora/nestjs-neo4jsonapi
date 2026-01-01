import { Entity } from "../../../common/abstracts/entity";
import { StripePrice } from "../../stripe-price/entities/stripe-price.entity";

export type StripeProduct = Entity & {
  stripeProductId: string;
  name: string;
  description?: string;
  active: boolean;
  metadata?: string;

  stripePrice?: StripePrice[];
};
