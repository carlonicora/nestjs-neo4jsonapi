import type { Entity } from "../../../common/abstracts/entity";
import { defineEntity } from "../../../common/helpers/define-entity";
import type { Company } from "../../company/entities/company";
import type { StripeCustomer } from "../../stripe-customer/entities/stripe-customer.entity";
import { stripeCustomerMeta } from "../../stripe-customer/entities/stripe-customer.meta";
import type { StripePrice } from "../../stripe-price/entities/stripe-price.entity";
import { stripePriceMeta } from "../../stripe-price/entities/stripe-price.meta";
import type { User } from "../../user/entities/user";
import { userMeta } from "../../user/entities/user.meta";
import { stripeSubscriptionMeta } from "./stripe-subscription.meta";

export type StripeSubscriptionStatus =
  "active" | "past_due" | "unpaid" | "canceled" | "incomplete" | "incomplete_expired" | "trialing" | "paused";

export type StripeSubscriptionDiscountDuration = "forever" | "once" | "repeating";

export type StripeSubscription = Entity & {
  stripeSubscriptionId: string;
  stripeSubscriptionItemId?: string;

  status: StripeSubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  canceledAt?: Date;

  trialStart?: Date;
  trialEnd?: Date;

  cardExpiryCheckedFor?: Date; // the currentPeriodEnd the card check last ran for

  quantity: number;

  // The discount Stripe applies to the subscription (first subscription-level discount),
  // copied from its coupon on every write from Stripe. Absent when there is none.
  discountPercentOff?: number;
  discountAmountOff?: number; // minor units, in discountCurrency
  discountCurrency?: string;
  discountDuration?: StripeSubscriptionDiscountDuration;
  discountDurationInMonths?: number;
  discountEnd?: Date; // when a repeating discount stops; absent for once/forever

  stripeCustomer: StripeCustomer;
  stripePrice: StripePrice;
  company: Company;
  createdBy?: User;
};

export const StripeSubscriptionDescriptor = defineEntity<StripeSubscription>()({
  ...stripeSubscriptionMeta,

  // Machine strings (Stripe ids, enum values) are excluded from search: no fulltext index.
  fields: {
    stripeSubscriptionId: { type: "string", required: true, excludeFromSearch: true },
    stripeSubscriptionItemId: { type: "string", excludeFromSearch: true },
    status: { type: "string", required: true, excludeFromSearch: true },
    currentPeriodStart: { type: "datetime", required: true },
    currentPeriodEnd: { type: "datetime", required: true },
    cancelAtPeriodEnd: { type: "boolean", required: true, default: false },
    canceledAt: { type: "datetime" },
    trialStart: { type: "datetime" },
    trialEnd: { type: "datetime" },
    cardExpiryCheckedFor: { type: "datetime" },
    quantity: { type: "number", required: true, default: 1 },
    discountPercentOff: { type: "number" },
    discountAmountOff: { type: "number" },
    discountCurrency: { type: "string", excludeFromSearch: true },
    discountDuration: { type: "string", excludeFromSearch: true },
    discountDurationInMonths: { type: "number" },
    discountEnd: { type: "datetime" },
  },

  // Directions follow the stored edge arrows (plan decision D9): both edges leave the subscription.
  relationships: {
    stripeCustomer: {
      model: stripeCustomerMeta,
      direction: "out",
      relationship: "BELONGS_TO",
      cardinality: "one",
      required: true,
      dtoKey: "stripeCustomer",
    },
    stripePrice: {
      model: stripePriceMeta,
      direction: "out",
      relationship: "USES_PRICE",
      cardinality: "one",
      required: true,
      dtoKey: "stripePrice",
    },
    createdBy: {
      model: userMeta,
      direction: "out",
      relationship: "CREATED_BY",
      cardinality: "one",
      required: false,
      contextKey: "userId",
      immutable: true,
      dtoKey: "createdBy",
    },
  },
});

export type StripeSubscriptionDescriptorType = typeof StripeSubscriptionDescriptor;
