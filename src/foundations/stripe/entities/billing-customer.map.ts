import { mapEntity } from "@carlonicora/nestjs-neo4jsonapi";
import { EntityFactory } from "@carlonicora/nestjs-neo4jsonapi";
import { BillingCustomer } from "../entities/billing-customer.entity";

export const mapBillingCustomer = (params: {
  data: any;
  record: any;
  entityFactory: EntityFactory;
}): BillingCustomer => {
  return {
    ...mapEntity({ record: params.data }),
    stripeCustomerId: params.data.stripeCustomerId,
    email: params.data.email,
    name: params.data.name,
    defaultPaymentMethodId: params.data.defaultPaymentMethodId,
    currency: params.data.currency,
    balance: Number(params.data.balance ?? 0),
    delinquent: params.data.delinquent === true,
    company: undefined,
  };
};
