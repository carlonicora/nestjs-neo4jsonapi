import { Entity } from "@carlonicora/nestjs-neo4jsonapi";

export type StripeProduct = Entity & {
  stripeProductId: string;
  name: string;
  description?: string;
  active: boolean;
  metadata?: string;
};
