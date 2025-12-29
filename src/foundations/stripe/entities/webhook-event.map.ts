import { mapEntity } from "@carlonicora/nestjs-neo4jsonapi";
import { EntityFactory } from "@carlonicora/nestjs-neo4jsonapi";
import { WebhookEvent } from "../entities/webhook-event.entity";

export const mapWebhookEvent = (params: { data: any; record: any; entityFactory: EntityFactory }): WebhookEvent => {
  return {
    ...mapEntity({ record: params.data }),
    stripeEventId: params.data.stripeEventId,
    eventType: params.data.eventType,
    livemode: params.data.livemode === true,
    apiVersion: params.data.apiVersion || null,
    status: params.data.status || "pending",
    payload: params.data.payload ? JSON.parse(params.data.payload) : {},
    processedAt: params.data.processedAt ? new Date(params.data.processedAt) : undefined,
    error: params.data.error || undefined,
    retryCount: Number(params.data.retryCount ?? 0),
  };
};
