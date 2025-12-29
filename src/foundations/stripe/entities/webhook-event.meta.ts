import { DataMeta } from "@carlonicora/nestjs-neo4jsonapi";

export const webhookEventMeta: DataMeta = {
  type: "webhook-events",
  endpoint: "webhook-events",
  nodeName: "webhookEvent",
  labelName: "WebhookEvent",
};
