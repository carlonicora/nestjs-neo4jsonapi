import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BaseConfigInterface as ConfigInterface } from "@carlonicora/nestjs-neo4jsonapi";
import { AbstractJsonApiSerialiser } from "@carlonicora/nestjs-neo4jsonapi";
import { JsonApiSerialiserFactory } from "@carlonicora/nestjs-neo4jsonapi";
import { JsonApiDataInterface } from "@carlonicora/nestjs-neo4jsonapi";
import { JsonApiServiceInterface } from "@carlonicora/nestjs-neo4jsonapi";
import { BillingCustomer } from "../entities/billing-customer.entity";
import { BillingCustomerModel } from "../entities/billing-customer.model";

@Injectable()
export class BillingCustomerSerialiser extends AbstractJsonApiSerialiser implements JsonApiServiceInterface {
  constructor(serialiserFactory: JsonApiSerialiserFactory, config: ConfigService<ConfigInterface>) {
    super(serialiserFactory, config);
  }

  get type(): string {
    return BillingCustomerModel.type;
  }

  create(): JsonApiDataInterface {
    this.attributes = {
      stripeCustomerId: "stripeCustomerId",
      email: "email",
      name: "name",
      defaultPaymentMethodId: "defaultPaymentMethodId",
      currency: "currency",
      balance: (data: BillingCustomer) => Number(data.balance ?? 0),
      delinquent: "delinquent",
    };

    return super.create();
  }
}
