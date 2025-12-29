import { DataModelInterface } from "@carlonicora/nestjs-neo4jsonapi";
import { WebhookEvent } from "../entities/webhook-event.entity";
import { mapWebhookEvent } from "../entities/webhook-event.map";
import { webhookEventMeta } from "../entities/webhook-event.meta";
import { WebhookEventSerialiser } from "../serialisers/webhook-event.serialiser";

export const WebhookEventModel: DataModelInterface<WebhookEvent> = {
  ...webhookEventMeta,
  entity: undefined as unknown as WebhookEvent,
  mapper: mapWebhookEvent,
  serialiser: WebhookEventSerialiser,
  singleChildrenTokens: [],
  childrenTokens: [],
};
