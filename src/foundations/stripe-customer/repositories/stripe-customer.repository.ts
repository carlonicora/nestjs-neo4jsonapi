import { Injectable, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "crypto";
import { Neo4jService } from "../../../core/neo4j";
import { companyMeta } from "../../company";
import { StripeCustomer } from "../entities/stripe-customer.entity";
import { stripeCustomerMeta } from "../entities/stripe-customer.meta";
import { StripeCustomerModel } from "../entities/stripe-customer.model";

/**
 * StripeCustomerRepository
 *
 * Neo4j repository for managing StripeCustomer nodes and their relationships to Company nodes.
 * Handles CRUD operations and maintains unique constraints for customer identifiers.
 *
 * Key Features:
 * - Automatic constraint creation for ID and Stripe customer ID uniqueness
 * - Query by company ID, Stripe customer ID, or internal ID
 * - Create and update operations with relationship management
 * - Support for syncing from Stripe webhook data
 * - Tracks customer balance, delinquency status, and default payment method
 * - Maintains BELONGS_TO relationship with Company nodes
 *
 * @example
 * ```typescript
 * const customer = await stripeCustomerRepository.create({
 *   companyId: 'comp_123',
 *   stripeCustomerId: 'cus_stripe123',
 *   email: 'customer@example.com',
 *   name: 'Example Corp',
 *   currency: 'usd'
 * });
 * ```
 */
@Injectable()
export class StripeCustomerRepository implements OnModuleInit {
  constructor(private readonly neo4j: Neo4jService) {}

  /**
   * Initialize repository constraints
   *
   * Creates unique constraints on module initialization for data integrity.
   */
  async onModuleInit() {
    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT ${stripeCustomerMeta.nodeName}_id IF NOT EXISTS FOR (${stripeCustomerMeta.nodeName}:${stripeCustomerMeta.labelName}) REQUIRE ${stripeCustomerMeta.nodeName}.id IS UNIQUE`,
    });

    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT ${stripeCustomerMeta.nodeName}_stripeCustomerId IF NOT EXISTS FOR (${stripeCustomerMeta.nodeName}:${stripeCustomerMeta.labelName}) REQUIRE ${stripeCustomerMeta.nodeName}.stripeCustomerId IS UNIQUE`,
    });
  }

  /**
   * Find stripe customer by company ID
   *
   * @param params - Query parameters
   * @param params.companyId - Company identifier
   * @returns StripeCustomer if found, null otherwise
   */
  async findByCompanyId(params: { companyId: string }): Promise<StripeCustomer | null> {
    const query = this.neo4j.initQuery({ serialiser: StripeCustomerModel });

    query.queryParams = {
      companyId: params.companyId,
    };

    query.query = `
      MATCH (${stripeCustomerMeta.nodeName}:${stripeCustomerMeta.labelName})-[:BELONGS_TO]->(${companyMeta.nodeName}:${companyMeta.labelName} {id: $companyId})
      RETURN ${stripeCustomerMeta.nodeName}
    `;

    return this.neo4j.readOne(query);
  }

  /**
   * Find stripe customer by Stripe customer ID
   *
   * @param params - Query parameters
   * @param params.stripeCustomerId - Stripe customer ID
   * @returns StripeCustomer if found, null otherwise
   */
  async findByStripeCustomerId(params: { stripeCustomerId: string }): Promise<StripeCustomer | null> {
    const query = this.neo4j.initQuery({ serialiser: StripeCustomerModel });

    query.queryParams = {
      stripeCustomerId: params.stripeCustomerId,
    };

    query.query = `
      MATCH (${stripeCustomerMeta.nodeName}:${stripeCustomerMeta.labelName} {stripeCustomerId: $stripeCustomerId})
      RETURN ${stripeCustomerMeta.nodeName}
    `;

    return this.neo4j.readOne(query);
  }

  /**
   * Find stripe customer by internal ID
   *
   * @param params - Query parameters
   * @param params.id - Internal stripe customer ID
   * @returns StripeCustomer if found, null otherwise
   */
  async findById(params: { id: string }): Promise<StripeCustomer | null> {
    const query = this.neo4j.initQuery({ serialiser: StripeCustomerModel });

    query.queryParams = {
      id: params.id,
    };

    query.query = `
      MATCH (${stripeCustomerMeta.nodeName}:${stripeCustomerMeta.labelName} {id: $id})
      RETURN ${stripeCustomerMeta.nodeName}
    `;

    return this.neo4j.readOne(query);
  }

  /**
   * Create a new stripe customer
   *
   * Creates a StripeCustomer node and establishes BELONGS_TO relationship with Company.
   * Initializes balance to 0 and delinquent to false.
   *
   * @param params - Creation parameters
   * @param params.companyId - Company identifier to link to
   * @param params.stripeCustomerId - Stripe customer ID
   * @param params.email - Customer email address
   * @param params.name - Customer name
   * @param params.currency - Default currency code (e.g., 'usd')
   * @param params.defaultPaymentMethodId - Optional default payment method ID
   * @returns Created StripeCustomer
   *
   * @example
   * ```typescript
   * const customer = await stripeCustomerRepository.create({
   *   companyId: 'comp_123',
   *   stripeCustomerId: 'cus_stripe123',
   *   email: 'billing@company.com',
   *   name: 'Acme Corp',
   *   currency: 'usd'
   * });
   * ```
   */
  async create(params: {
    companyId: string;
    stripeCustomerId: string;
    email: string;
    name: string;
    currency: string;
    defaultPaymentMethodId?: string;
  }): Promise<StripeCustomer> {
    const query = this.neo4j.initQuery({ serialiser: StripeCustomerModel });

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
      CREATE (${stripeCustomerMeta.nodeName}:${stripeCustomerMeta.labelName} {
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
      ${query.queryParams.companyId ? `CREATE (${stripeCustomerMeta.nodeName})-[:BELONGS_TO]->(${companyMeta.nodeName})` : ``}
      RETURN ${stripeCustomerMeta.nodeName}
    `;

    return this.neo4j.writeOne(query);
  }

  /**
   * Update stripe customer by internal ID
   *
   * @param params - Update parameters
   * @param params.id - Internal stripe customer ID
   * @param params.email - Optional new email address
   * @param params.name - Optional new name
   * @param params.defaultPaymentMethodId - Optional new default payment method ID
   * @param params.balance - Optional new balance
   * @param params.delinquent - Optional new delinquency status
   * @returns Updated StripeCustomer
   */
  async update(params: {
    id: string;
    email?: string;
    name?: string;
    defaultPaymentMethodId?: string;
    balance?: number;
    delinquent?: boolean;
  }): Promise<StripeCustomer> {
    const query = this.neo4j.initQuery({ serialiser: StripeCustomerModel });

    const setParams: string[] = [];
    setParams.push(`${stripeCustomerMeta.nodeName}.updatedAt = datetime()`);

    if (params.email !== undefined) {
      setParams.push(`${stripeCustomerMeta.nodeName}.email = $email`);
    }
    if (params.name !== undefined) {
      setParams.push(`${stripeCustomerMeta.nodeName}.name = $name`);
    }
    if (params.defaultPaymentMethodId !== undefined) {
      setParams.push(`${stripeCustomerMeta.nodeName}.defaultPaymentMethodId = $defaultPaymentMethodId`);
    }
    if (params.balance !== undefined) {
      setParams.push(`${stripeCustomerMeta.nodeName}.balance = $balance`);
    }
    if (params.delinquent !== undefined) {
      setParams.push(`${stripeCustomerMeta.nodeName}.delinquent = $delinquent`);
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
      MATCH (${stripeCustomerMeta.nodeName}:${stripeCustomerMeta.labelName} {id: $id})
      SET ${setParams.join(", ")}
      RETURN ${stripeCustomerMeta.nodeName}
    `;

    return this.neo4j.writeOne(query);
  }

  /**
   * Update stripe customer by Stripe customer ID
   *
   * Used primarily by webhook handlers to sync customer data from Stripe.
   *
   * @param params - Update parameters
   * @param params.stripeCustomerId - Stripe customer ID
   * @param params.email - Optional new email address
   * @param params.name - Optional new name
   * @param params.defaultPaymentMethodId - Optional new default payment method ID
   * @param params.balance - Optional new balance
   * @param params.delinquent - Optional new delinquency status
   * @returns Updated StripeCustomer
   */
  async updateByStripeCustomerId(params: {
    stripeCustomerId: string;
    email?: string;
    name?: string;
    defaultPaymentMethodId?: string;
    balance?: number;
    delinquent?: boolean;
  }): Promise<StripeCustomer> {
    const query = this.neo4j.initQuery({ serialiser: StripeCustomerModel });

    const setParams: string[] = [];
    setParams.push(`${stripeCustomerMeta.nodeName}.updatedAt = datetime()`);

    if (params.email !== undefined) {
      setParams.push(`${stripeCustomerMeta.nodeName}.email = $email`);
    }
    if (params.name !== undefined) {
      setParams.push(`${stripeCustomerMeta.nodeName}.name = $name`);
    }
    if (params.defaultPaymentMethodId !== undefined) {
      setParams.push(`${stripeCustomerMeta.nodeName}.defaultPaymentMethodId = $defaultPaymentMethodId`);
    }
    if (params.balance !== undefined) {
      setParams.push(`${stripeCustomerMeta.nodeName}.balance = $balance`);
    }
    if (params.delinquent !== undefined) {
      setParams.push(`${stripeCustomerMeta.nodeName}.delinquent = $delinquent`);
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
      MATCH (${stripeCustomerMeta.nodeName}:${stripeCustomerMeta.labelName} {stripeCustomerId: $stripeCustomerId})
      SET ${setParams.join(", ")}
      RETURN ${stripeCustomerMeta.nodeName}
    `;

    return this.neo4j.writeOne(query);
  }

  /**
   * Delete stripe customer
   *
   * Performs a DETACH DELETE to remove the customer and all relationships.
   *
   * @param params - Deletion parameters
   * @param params.id - Internal stripe customer ID
   * @returns Promise that resolves when deletion is complete
   */
  async delete(params: { id: string }): Promise<void> {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      id: params.id,
    };

    query.query = `
      MATCH (${stripeCustomerMeta.nodeName}:${stripeCustomerMeta.labelName} {id: $id})
      DETACH DELETE ${stripeCustomerMeta.nodeName}
    `;

    await this.neo4j.writeOne(query);
  }
}
