import { Entity } from "@carlonicora/nestjs-neo4jsonapi";
import { Company } from "@carlonicora/nestjs-neo4jsonapi";

export type BillingCustomer = Entity & {
  stripeCustomerId: string;
  email: string;
  name: string;
  defaultPaymentMethodId?: string;
  currency: string;
  balance: number;
  delinquent: boolean;

  company: Company;
};
