import { Entity } from "@carlonicora/nestjs-neo4jsonapi";

export type WebhookEventStatus = "pending" | "processing" | "completed" | "failed";

export type WebhookEvent = Entity & {
  stripeEventId: string;
  eventType: string;
  livemode: boolean;
  apiVersion: string | null;
  status: WebhookEventStatus;
  payload: Record<string, any>;
  processedAt?: Date;
  error?: string;
  retryCount: number;
};
