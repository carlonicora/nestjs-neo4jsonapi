import { Entity } from "@carlonicora/nestjs-neo4jsonapi";
import { Subscription } from "../entities/subscription.entity";

export type UsageRecord = Entity & {
  subscriptionId: string;
  meterId: string;
  meterEventName: string;
  quantity: number;
  timestamp: Date;
  stripeEventId?: string;
  subscription?: Subscription;
};
