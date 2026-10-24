import { Entity } from "../../../common/abstracts/entity";
import { StripeSubscription } from "../../stripe-subscription/entities/stripe-subscription";

export type StripeUsageRecord = Entity & {
  subscriptionId: string;
  meterId: string;
  meterEventName: string;
  quantity: number;
  timestamp: Date;
  stripeEventId?: string;
  subscription?: StripeSubscription;
};
