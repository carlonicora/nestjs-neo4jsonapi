import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { ClsService } from "nestjs-cls";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { companyMeta } from "../../company/entities/company.meta";
import { stripeCustomerMeta } from "../../stripe-customer/entities/stripe-customer.meta";
import { stripePriceMeta } from "../../stripe-price/entities/stripe-price.meta";
import { stripeProductMeta } from "../../stripe-product/entities/stripe-product.meta";
import { userMeta } from "../../user/entities/user.meta";
import {
  StripeSubscription,
  StripeSubscriptionDescriptor,
  StripeSubscriptionStatus,
} from "../entities/stripe-subscription";
import { StripeSubscriptionDiscount, discountQueryParams } from "../entities/stripe-subscription.discount";
import { stripeSubscriptionMeta } from "../entities/stripe-subscription.meta";

const S = stripeSubscriptionMeta.nodeName;

type StripeSubscriptionUpdateParams = {
  status?: StripeSubscriptionStatus;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  cancelAtPeriodEnd?: boolean;
  canceledAt?: Date | null;
  trialStart?: Date;
  trialEnd?: Date;
  cardExpiryCheckedFor?: Date | null;
  quantity?: number;
  discount?: StripeSubscriptionDiscount | null;
};

/** Datetime fields `update()` can set or clear: undefined leaves, null clears. */
const CLEARABLE_DATETIME_FIELDS = ["canceledAt", "cardExpiryCheckedFor"] as const;

/**
 * StripeSubscriptionRepository
 *
 * Neo4j repository for StripeSubscription nodes:
 * `(stripeSubscription)-[:BELONGS_TO]->(stripeCustomer)`, `-[:USES_PRICE]->(stripePrice)`,
 * `-[:BELONGS_TO]->(company)` and `-[:CREATED_BY]->(user)`.
 *
 * Every read and every request-time write starts from `buildDefaultMatch()`, so a request is
 * scoped to the caller's company. Jobs with no company in CLS (webhooks, crons, backfills)
 * reach every company through the `$companyId IS NULL` branch.
 */
@Injectable()
export class StripeSubscriptionRepository extends AbstractRepository<
  StripeSubscription,
  typeof StripeSubscriptionDescriptor.relationships
> {
  protected readonly descriptor = StripeSubscriptionDescriptor;

  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  /** The inherited id constraint and indexes, plus the unique Stripe subscription id. */
  async onModuleInit() {
    await super.onModuleInit();

    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT ${S}_stripeSubscriptionId IF NOT EXISTS FOR (${S}:${stripeSubscriptionMeta.labelName}) REQUIRE ${S}.stripeSubscriptionId IS UNIQUE`,
    });
  }

  /**
   * The subscription with its company, customer, price, the price's product and its creator.
   */
  protected buildReturnStatement(): string {
    return `
      MATCH (${S})-[:BELONGS_TO]->(${S}_${companyMeta.nodeName}:${companyMeta.labelName})
      MATCH (${S})-[:BELONGS_TO]->(${S}_stripeCustomer:${stripeCustomerMeta.labelName})
      MATCH (${S})-[:USES_PRICE]->(${S}_stripePrice:${stripePriceMeta.labelName})-[:BELONGS_TO]->(${S}_stripePrice_${stripeProductMeta.nodeName}:${stripeProductMeta.labelName})
      OPTIONAL MATCH (${S})-[:CREATED_BY]->(${S}_createdBy:${userMeta.labelName})
      RETURN ${S},
        ${S}_${companyMeta.nodeName},
        ${S}_stripeCustomer,
        ${S}_stripePrice,
        ${S}_stripePrice_${stripeProductMeta.nodeName},
        ${S}_createdBy
    `;
  }

  /**
   * The cron finders read across every company. Inside a request `buildDefaultMatch()` would
   * scope them to the caller's company, so they refuse to run there.
   */
  private assertNoRequestCompany(method: string): void {
    if (this.clsService.get("companyId")) {
      throw new Error(`StripeSubscriptionRepository.${method} is for the worker cron only, not for a request.`);
    }
  }

  /**
   * Subscriptions of a customer, newest first.
   *
   * @param params.stripeCustomerId - internal StripeCustomer id
   * @param params.status - optional status filter
   */
  async findByStripeCustomerId(params: {
    stripeCustomerId: string;
    status?: StripeSubscriptionStatus;
  }): Promise<StripeSubscription[]> {
    const query = this.neo4j.initQuery({ serialiser: StripeSubscriptionDescriptor.model, fetchAll: true });

    query.queryParams = {
      ...query.queryParams,
      stripeCustomerId: params.stripeCustomerId,
      ...(params.status ? { status: params.status } : {}),
    };

    query.query += `
      ${this.buildDefaultMatch()}
      MATCH (${S})-[:BELONGS_TO]->(:${stripeCustomerMeta.labelName} {id: $stripeCustomerId})
      ${params.status ? `WHERE ${S}.status = $status` : ``}
      WITH ${S}
      ${this.buildReturnStatement()}
      ORDER BY ${S}.createdAt DESC
    `;

    return this.neo4j.readMany(query);
  }

  /**
   * Every subscription, oldest first. Not paginated: it serves system jobs that run outside a
   * request (the discount backfill), never an endpoint.
   */
  async findAll(): Promise<StripeSubscription[]> {
    const query = this.neo4j.initQuery({ serialiser: StripeSubscriptionDescriptor.model, fetchAll: true });

    query.query += `
      ${this.buildDefaultMatch()}
      ${this.buildReturnStatement()}
      ORDER BY ${S}.createdAt ASC
    `;

    return this.neo4j.readMany(query);
  }

  /** The subscription with this Stripe subscription id, or null. */
  async findByStripeSubscriptionId(params: { stripeSubscriptionId: string }): Promise<StripeSubscription | null> {
    const query = this.neo4j.initQuery({ serialiser: StripeSubscriptionDescriptor.model });

    query.queryParams = { ...query.queryParams, searchValue: params.stripeSubscriptionId };

    query.query += `
      ${this.buildDefaultMatch({ searchField: "stripeSubscriptionId" })}
      ${this.buildReturnStatement()}
    `;

    return this.neo4j.readOne(query);
  }

  /**
   * Creates a subscription linked to its customer, its price, the caller's company and the
   * caller. The customer and price ids are checked against the caller's company first.
   */
  async createSubscription(params: {
    stripeCustomerId: string;
    priceId: string;
    stripeSubscriptionId: string;
    stripeSubscriptionItemId?: string;
    status: StripeSubscriptionStatus;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    cancelAtPeriodEnd: boolean;
    trialStart?: Date;
    trialEnd?: Date;
    quantity: number;
    discount?: StripeSubscriptionDiscount | null;
  }): Promise<StripeSubscription> {
    await this.neo4j.validateRelatedNodes({
      nodes: [
        { id: params.stripeCustomerId, label: stripeCustomerMeta.labelName },
        { id: params.priceId, label: stripePriceMeta.labelName },
      ],
    });

    const query = this.neo4j.initQuery({ serialiser: StripeSubscriptionDescriptor.model });

    query.queryParams = {
      ...query.queryParams,
      id: randomUUID(),
      stripeCustomerId: params.stripeCustomerId,
      priceId: params.priceId,
      stripeSubscriptionId: params.stripeSubscriptionId,
      stripeSubscriptionItemId: params.stripeSubscriptionItemId ?? null,
      status: params.status,
      currentPeriodStart: params.currentPeriodStart.toISOString(),
      currentPeriodEnd: params.currentPeriodEnd.toISOString(),
      cancelAtPeriodEnd: params.cancelAtPeriodEnd,
      trialStart: params.trialStart?.toISOString() ?? null,
      trialEnd: params.trialEnd?.toISOString() ?? null,
      quantity: params.quantity,
      ...discountQueryParams(params.discount ?? null),
    };

    // Guarded: initQuery() binds `company` / `currentUser` only when CLS holds them; an
    // unbound CREATE target would create an orphan node.
    query.query += `
      MATCH (newStripeCustomer:${stripeCustomerMeta.labelName} {id: $stripeCustomerId})
      MATCH (newStripePrice:${stripePriceMeta.labelName} {id: $priceId})
      CREATE (${S}:${stripeSubscriptionMeta.labelName} {
        id: $id,
        stripeSubscriptionId: $stripeSubscriptionId,
        stripeSubscriptionItemId: $stripeSubscriptionItemId,
        status: $status,
        currentPeriodStart: datetime($currentPeriodStart),
        currentPeriodEnd: datetime($currentPeriodEnd),
        cancelAtPeriodEnd: $cancelAtPeriodEnd,
        trialStart: CASE WHEN $trialStart IS NOT NULL THEN datetime($trialStart) ELSE null END,
        trialEnd: CASE WHEN $trialEnd IS NOT NULL THEN datetime($trialEnd) ELSE null END,
        quantity: $quantity,
        discountPercentOff: $discountPercentOff,
        discountAmountOff: $discountAmountOff,
        discountCurrency: $discountCurrency,
        discountDuration: $discountDuration,
        discountDurationInMonths: $discountDurationInMonths,
        discountEnd: CASE WHEN $discountEnd IS NOT NULL THEN datetime($discountEnd) ELSE null END,
        createdAt: datetime(),
        updatedAt: datetime()
      })
      CREATE (${S})-[:BELONGS_TO]->(newStripeCustomer)
      CREATE (${S})-[:USES_PRICE]->(newStripePrice)
      ${query.queryParams.companyId ? `CREATE (${S})-[:BELONGS_TO]->(${companyMeta.nodeName})` : ``}
      ${query.queryParams.currentUserId ? `CREATE (${S})-[:CREATED_BY]->(currentUser)` : ``}
      WITH ${S}
      ${this.buildReturnStatement()}
    `;

    return this.neo4j.writeOne(query);
  }

  /**
   * Updates a subscription by internal id. For every optional field, undefined leaves the
   * stored value and (where the type allows it) null clears it.
   */
  async update(params: { id: string } & StripeSubscriptionUpdateParams): Promise<StripeSubscription> {
    const query = this.neo4j.initQuery({ serialiser: StripeSubscriptionDescriptor.model });

    const setParams: string[] = [`${S}.updatedAt = datetime()`];
    const values: Record<string, unknown> = {};

    if (params.status !== undefined) {
      setParams.push(`${S}.status = $status`);
      values.status = params.status;
    }
    if (params.currentPeriodStart !== undefined) {
      setParams.push(`${S}.currentPeriodStart = datetime($currentPeriodStart)`);
      values.currentPeriodStart = params.currentPeriodStart.toISOString();
    }
    if (params.currentPeriodEnd !== undefined) {
      setParams.push(`${S}.currentPeriodEnd = datetime($currentPeriodEnd)`);
      values.currentPeriodEnd = params.currentPeriodEnd.toISOString();
    }
    if (params.cancelAtPeriodEnd !== undefined) {
      setParams.push(`${S}.cancelAtPeriodEnd = $cancelAtPeriodEnd`);
      values.cancelAtPeriodEnd = params.cancelAtPeriodEnd;
    }
    if (params.trialStart !== undefined) {
      setParams.push(`${S}.trialStart = datetime($trialStart)`);
      values.trialStart = params.trialStart.toISOString();
    }
    if (params.trialEnd !== undefined) {
      setParams.push(`${S}.trialEnd = datetime($trialEnd)`);
      values.trialEnd = params.trialEnd.toISOString();
    }
    for (const field of CLEARABLE_DATETIME_FIELDS) {
      const value = params[field];
      if (value === undefined) continue;
      if (value === null) {
        setParams.push(`${S}.${field} = null`);
      } else {
        setParams.push(`${S}.${field} = datetime($${field})`);
        values[field] = value.toISOString();
      }
    }
    if (params.quantity !== undefined) {
      setParams.push(`${S}.quantity = $quantity`);
      values.quantity = params.quantity;
    }
    // undefined leaves the stored discount as it is; null clears it.
    if (params.discount !== undefined) {
      setParams.push(
        `${S}.discountPercentOff = $discountPercentOff`,
        `${S}.discountAmountOff = $discountAmountOff`,
        `${S}.discountCurrency = $discountCurrency`,
        `${S}.discountDuration = $discountDuration`,
        `${S}.discountDurationInMonths = $discountDurationInMonths`,
        `${S}.discountEnd = CASE WHEN $discountEnd IS NOT NULL THEN datetime($discountEnd) ELSE null END`,
      );
      Object.assign(values, discountQueryParams(params.discount));
    }

    query.queryParams = { ...query.queryParams, ...values, searchValue: params.id };

    query.query += `
      ${this.buildDefaultMatch({ searchField: "id" })}
      SET ${setParams.join(", ")}
      WITH ${S}
      ${this.buildReturnStatement()}
    `;

    return this.neo4j.writeOne(query);
  }

  /**
   * Updates a subscription by Stripe subscription id (webhook sync).
   *
   * @returns the updated subscription, or null when none has this id
   */
  async updateByStripeSubscriptionId(
    params: { stripeSubscriptionId: string } & StripeSubscriptionUpdateParams,
  ): Promise<StripeSubscription | null> {
    const existing = await this.findByStripeSubscriptionId({ stripeSubscriptionId: params.stripeSubscriptionId });
    if (!existing) return null;

    return this.update({ id: existing.id, ...params });
  }

  /**
   * Moves the subscription to another price (plan change). The price id is checked against
   * the caller's company first.
   */
  async updatePrice(params: { id: string; newPriceId: string }): Promise<StripeSubscription> {
    await this.neo4j.validateRelatedNodes({
      nodes: [{ id: params.newPriceId, label: stripePriceMeta.labelName }],
    });

    const query = this.neo4j.initQuery({ serialiser: StripeSubscriptionDescriptor.model });

    query.queryParams = { ...query.queryParams, searchValue: params.id, newPriceId: params.newPriceId };

    query.query += `
      ${this.buildDefaultMatch({ searchField: "id" })}
      MATCH (${S})-[oldRel:USES_PRICE]->(:${stripePriceMeta.labelName})
      DELETE oldRel
      WITH ${S}
      MATCH (newStripePrice:${stripePriceMeta.labelName} {id: $newPriceId})
      CREATE (${S})-[:USES_PRICE]->(newStripePrice)
      SET ${S}.updatedAt = datetime()
      WITH ${S}
      ${this.buildReturnStatement()}
    `;

    return this.neo4j.writeOne(query);
  }

  /**
   * Cancels every active, trialing or past_due subscription of a customer (customer deleted).
   *
   * @param params.stripeCustomerId - Stripe customer id (cus_xxx)
   * @returns number of subscriptions cancelled
   */
  async cancelAllByStripeCustomerId(params: { stripeCustomerId: string }): Promise<number> {
    const query = this.neo4j.initQuery({ serialiser: StripeSubscriptionDescriptor.model });

    query.queryParams = {
      ...query.queryParams,
      stripeCustomerId: params.stripeCustomerId,
      canceledStatus: "canceled" as StripeSubscriptionStatus,
      canceledAt: new Date().toISOString(),
    };

    query.query += `
      ${this.buildDefaultMatch()}
      MATCH (${S})-[:BELONGS_TO]->(:${stripeCustomerMeta.labelName} {stripeCustomerId: $stripeCustomerId})
      WHERE ${S}.status IN ['active', 'trialing', 'past_due']
      SET ${S}.status = $canceledStatus,
          ${S}.canceledAt = datetime($canceledAt),
          ${S}.cancelAtPeriodEnd = false,
          ${S}.updatedAt = datetime()
      WITH ${S}
      ${this.buildReturnStatement()}
    `;

    const cancelled = await this.neo4j.writeAndReturnMany(query);
    return (cancelled ?? []).length;
  }

  /**
   * Active or trialing subscriptions of a customer, newest first (smart feature removal).
   *
   * @param params.stripeCustomerId - Stripe customer id (cus_xxx)
   */
  async findActiveByStripeCustomerId(params: { stripeCustomerId: string }): Promise<StripeSubscription[]> {
    const query = this.neo4j.initQuery({ serialiser: StripeSubscriptionDescriptor.model, fetchAll: true });

    query.queryParams = { ...query.queryParams, stripeCustomerId: params.stripeCustomerId };

    query.query += `
      ${this.buildDefaultMatch()}
      MATCH (${S})-[:BELONGS_TO]->(:${stripeCustomerMeta.labelName} {stripeCustomerId: $stripeCustomerId})
      WHERE ${S}.status IN ['active', 'trialing']
      WITH ${S}
      ${this.buildReturnStatement()}
      ORDER BY ${S}.createdAt DESC
    `;

    return this.neo4j.readMany(query);
  }

  /**
   * Worker cron only. Active recurring subscriptions renewing between `now` (excluded) and
   * `before` (included), not cancelling, whose card has not been checked yet for this renewal.
   */
  async findRenewalsForCardCheck(params: { now: Date; before: Date }): Promise<StripeSubscription[]> {
    this.assertNoRequestCompany("findRenewalsForCardCheck");
    const query = this.neo4j.initQuery({ serialiser: StripeSubscriptionDescriptor.model, fetchAll: true });

    query.queryParams = {
      ...query.queryParams,
      now: params.now.toISOString(),
      before: params.before.toISOString(),
    };

    query.query += `
      ${this.buildDefaultMatch()}
      WHERE ${S}.status = "active"
        AND ${S}.cancelAtPeriodEnd = false
        AND ${S}.currentPeriodEnd > datetime($now)
        AND ${S}.currentPeriodEnd <= datetime($before)
        AND (${S}.cardExpiryCheckedFor IS NULL OR ${S}.cardExpiryCheckedFor <> ${S}.currentPeriodEnd)
        AND EXISTS {
          MATCH (${S})-[:USES_PRICE]->(recurringPrice:${stripePriceMeta.labelName})
          WHERE recurringPrice.priceType = "recurring"
        }
      ${this.buildReturnStatement()}
      ORDER BY ${S}.currentPeriodEnd ASC
    `;

    return this.neo4j.readMany(query);
  }

  /**
   * Worker cron only. Trialing subscriptions ending in (after, upTo] whose customer is not paying.
   * A customer is paying when another of its subscriptions is active or past_due on a price that
   * is not a trial and costs more than zero.
   */
  async findOpenTrialsEndingBetween(params: { after: Date; upTo: Date }): Promise<StripeSubscription[]> {
    this.assertNoRequestCompany("findOpenTrialsEndingBetween");
    const query = this.neo4j.initQuery({ serialiser: StripeSubscriptionDescriptor.model, fetchAll: true });

    query.queryParams = {
      ...query.queryParams,
      after: params.after.toISOString(),
      upTo: params.upTo.toISOString(),
    };

    query.query += `
      ${this.buildDefaultMatch()}
      WHERE ${S}.status = "trialing"
        AND ${S}.trialEnd > datetime($after)
        AND ${S}.trialEnd <= datetime($upTo)
        AND NOT EXISTS {
          MATCH (${S})-[:BELONGS_TO]->(cust:${stripeCustomerMeta.labelName})<-[:BELONGS_TO]-(paid:${stripeSubscriptionMeta.labelName})-[:USES_PRICE]->(paidPrice:${stripePriceMeta.labelName})
          WHERE paid.status IN ['active', 'past_due']
            AND coalesce(paidPrice.isTrial, false) = false
            AND coalesce(paidPrice.unitAmount, 0) > 0
        }
      ${this.buildReturnStatement()}
      ORDER BY ${S}.trialEnd ASC
    `;

    return this.neo4j.readMany(query);
  }
}
