import { Injectable, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "crypto";
import { Neo4jService } from "@carlonicora/nestjs-neo4jsonapi";
import { BillingCustomer } from "../entities/billing-customer.entity";
import { billingCustomerMeta } from "../entities/billing-customer.meta";
import { BillingCustomerModel } from "../entities/billing-customer.model";
import { companyMeta } from "@carlonicora/nestjs-neo4jsonapi";

@Injectable()
export class BillingCustomerRepository implements OnModuleInit {
  constructor(private readonly neo4j: Neo4jService) {}

  async onModuleInit() {
    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT ${billingCustomerMeta.nodeName}_id IF NOT EXISTS FOR (${billingCustomerMeta.nodeName}:${billingCustomerMeta.labelName}) REQUIRE ${billingCustomerMeta.nodeName}.id IS UNIQUE`,
    });

    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT ${billingCustomerMeta.nodeName}_stripeCustomerId IF NOT EXISTS FOR (${billingCustomerMeta.nodeName}:${billingCustomerMeta.labelName}) REQUIRE ${billingCustomerMeta.nodeName}.stripeCustomerId IS UNIQUE`,
    });
  }

  async findByCompanyId(params: { companyId: string }): Promise<BillingCustomer | null> {
    const query = this.neo4j.initQuery({ serialiser: BillingCustomerModel });

    query.queryParams = {
      companyId: params.companyId,
    };

    query.query = `
      MATCH (${billingCustomerMeta.nodeName}:${billingCustomerMeta.labelName})-[:BELONGS_TO]->(${companyMeta.nodeName}:${companyMeta.labelName} {id: $companyId})
      RETURN ${billingCustomerMeta.nodeName}
    `;

    return this.neo4j.readOne(query);
  }

  async findByStripeCustomerId(params: { stripeCustomerId: string }): Promise<BillingCustomer | null> {
    const query = this.neo4j.initQuery({ serialiser: BillingCustomerModel });

    query.queryParams = {
      stripeCustomerId: params.stripeCustomerId,
    };

    query.query = `
      MATCH (${billingCustomerMeta.nodeName}:${billingCustomerMeta.labelName} {stripeCustomerId: $stripeCustomerId})
      RETURN ${billingCustomerMeta.nodeName}
    `;

    return this.neo4j.readOne(query);
  }

  async findById(params: { id: string }): Promise<BillingCustomer | null> {
    const query = this.neo4j.initQuery({ serialiser: BillingCustomerModel });

    query.queryParams = {
      id: params.id,
    };

    query.query = `
      MATCH (${billingCustomerMeta.nodeName}:${billingCustomerMeta.labelName} {id: $id})
      RETURN ${billingCustomerMeta.nodeName}
    `;

    return this.neo4j.readOne(query);
  }

  async create(params: {
    companyId: string;
    stripeCustomerId: string;
    email: string;
    name: string;
    currency: string;
    defaultPaymentMethodId?: string;
  }): Promise<BillingCustomer> {
    const query = this.neo4j.initQuery({ serialiser: BillingCustomerModel });

    const id = randomUUID();

    query.queryParams = {
      id,
      companyId: params.companyId,
      stripeCustomerId: params.stripeCustomerId,
      email: params.email,
      name: params.name,
      currency: params.currency,
      defaultPaymentMethodId: params.defaultPaymentMethodId ?? null,
    };

    query.query = `
      MATCH (${companyMeta.nodeName}:${companyMeta.labelName} {id: $companyId})
      CREATE (${billingCustomerMeta.nodeName}:${billingCustomerMeta.labelName} {
        id: $id,
        stripeCustomerId: $stripeCustomerId,
        email: $email,
        name: $name,
        currency: $currency,
        defaultPaymentMethodId: $defaultPaymentMethodId,
        balance: 0,
        delinquent: false,
        createdAt: datetime(),
        updatedAt: datetime()
      })
      CREATE (${billingCustomerMeta.nodeName})-[:BELONGS_TO]->(${companyMeta.nodeName})
      RETURN ${billingCustomerMeta.nodeName}
    `;

    return this.neo4j.writeOne(query);
  }

  async update(params: {
    id: string;
    email?: string;
    name?: string;
    defaultPaymentMethodId?: string;
    balance?: number;
    delinquent?: boolean;
  }): Promise<BillingCustomer> {
    const query = this.neo4j.initQuery({ serialiser: BillingCustomerModel });

    const setParams: string[] = [];
    setParams.push(`${billingCustomerMeta.nodeName}.updatedAt = datetime()`);

    if (params.email !== undefined) {
      setParams.push(`${billingCustomerMeta.nodeName}.email = $email`);
    }
    if (params.name !== undefined) {
      setParams.push(`${billingCustomerMeta.nodeName}.name = $name`);
    }
    if (params.defaultPaymentMethodId !== undefined) {
      setParams.push(`${billingCustomerMeta.nodeName}.defaultPaymentMethodId = $defaultPaymentMethodId`);
    }
    if (params.balance !== undefined) {
      setParams.push(`${billingCustomerMeta.nodeName}.balance = $balance`);
    }
    if (params.delinquent !== undefined) {
      setParams.push(`${billingCustomerMeta.nodeName}.delinquent = $delinquent`);
    }

    query.queryParams = {
      id: params.id,
      email: params.email,
      name: params.name,
      defaultPaymentMethodId: params.defaultPaymentMethodId,
      balance: params.balance,
      delinquent: params.delinquent,
    };

    query.query = `
      MATCH (${billingCustomerMeta.nodeName}:${billingCustomerMeta.labelName} {id: $id})
      SET ${setParams.join(", ")}
      RETURN ${billingCustomerMeta.nodeName}
    `;

    return this.neo4j.writeOne(query);
  }

  async updateByStripeCustomerId(params: {
    stripeCustomerId: string;
    email?: string;
    name?: string;
    defaultPaymentMethodId?: string;
    balance?: number;
    delinquent?: boolean;
  }): Promise<BillingCustomer> {
    const query = this.neo4j.initQuery({ serialiser: BillingCustomerModel });

    const setParams: string[] = [];
    setParams.push(`${billingCustomerMeta.nodeName}.updatedAt = datetime()`);

    if (params.email !== undefined) {
      setParams.push(`${billingCustomerMeta.nodeName}.email = $email`);
    }
    if (params.name !== undefined) {
      setParams.push(`${billingCustomerMeta.nodeName}.name = $name`);
    }
    if (params.defaultPaymentMethodId !== undefined) {
      setParams.push(`${billingCustomerMeta.nodeName}.defaultPaymentMethodId = $defaultPaymentMethodId`);
    }
    if (params.balance !== undefined) {
      setParams.push(`${billingCustomerMeta.nodeName}.balance = $balance`);
    }
    if (params.delinquent !== undefined) {
      setParams.push(`${billingCustomerMeta.nodeName}.delinquent = $delinquent`);
    }

    query.queryParams = {
      stripeCustomerId: params.stripeCustomerId,
      email: params.email,
      name: params.name,
      defaultPaymentMethodId: params.defaultPaymentMethodId,
      balance: params.balance,
      delinquent: params.delinquent,
    };

    query.query = `
      MATCH (${billingCustomerMeta.nodeName}:${billingCustomerMeta.labelName} {stripeCustomerId: $stripeCustomerId})
      SET ${setParams.join(", ")}
      RETURN ${billingCustomerMeta.nodeName}
    `;

    return this.neo4j.writeOne(query);
  }

  async delete(params: { id: string }): Promise<void> {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      id: params.id,
    };

    query.query = `
      MATCH (${billingCustomerMeta.nodeName}:${billingCustomerMeta.labelName} {id: $id})
      DETACH DELETE ${billingCustomerMeta.nodeName}
    `;

    await this.neo4j.writeOne(query);
  }
}
