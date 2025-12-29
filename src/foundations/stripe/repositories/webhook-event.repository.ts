import { Injectable, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "crypto";
import { Neo4jService } from "@carlonicora/nestjs-neo4jsonapi";
import { WebhookEvent, WebhookEventStatus } from "../entities/webhook-event.entity";
import { webhookEventMeta } from "../entities/webhook-event.meta";
import { WebhookEventModel } from "../entities/webhook-event.model";

@Injectable()
export class WebhookEventRepository implements OnModuleInit {
  constructor(private readonly neo4j: Neo4jService) {}

  async onModuleInit() {
    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT ${webhookEventMeta.nodeName}_id IF NOT EXISTS FOR (${webhookEventMeta.nodeName}:${webhookEventMeta.labelName}) REQUIRE ${webhookEventMeta.nodeName}.id IS UNIQUE`,
    });

    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT ${webhookEventMeta.nodeName}_stripeEventId IF NOT EXISTS FOR (${webhookEventMeta.nodeName}:${webhookEventMeta.labelName}) REQUIRE ${webhookEventMeta.nodeName}.stripeEventId IS UNIQUE`,
    });
  }

  async findByStripeEventId(params: { stripeEventId: string }): Promise<WebhookEvent | null> {
    const query = this.neo4j.initQuery({ serialiser: WebhookEventModel });

    query.queryParams = {
      stripeEventId: params.stripeEventId,
    };

    query.query = `
      MATCH (${webhookEventMeta.nodeName}:${webhookEventMeta.labelName} {stripeEventId: $stripeEventId})
      RETURN ${webhookEventMeta.nodeName}
    `;

    return this.neo4j.readOne(query);
  }

  async findPendingEvents(params: { limit?: number }): Promise<WebhookEvent[]> {
    const query = this.neo4j.initQuery({ serialiser: WebhookEventModel });

    query.queryParams = {
      limit: params.limit ?? 100,
    };

    query.query = `
      MATCH (${webhookEventMeta.nodeName}:${webhookEventMeta.labelName})
      WHERE ${webhookEventMeta.nodeName}.status IN ['pending', 'failed']
        AND ${webhookEventMeta.nodeName}.retryCount < 5
      RETURN ${webhookEventMeta.nodeName}
      ORDER BY ${webhookEventMeta.nodeName}.createdAt ASC
      LIMIT $limit
    `;

    return this.neo4j.readMany(query);
  }

  async create(params: {
    stripeEventId: string;
    eventType: string;
    livemode: boolean;
    apiVersion: string | null;
    payload: Record<string, any>;
  }): Promise<WebhookEvent> {
    const query = this.neo4j.initQuery({ serialiser: WebhookEventModel });

    const id = randomUUID();

    query.queryParams = {
      id,
      stripeEventId: params.stripeEventId,
      eventType: params.eventType,
      livemode: params.livemode,
      apiVersion: params.apiVersion,
      status: "pending" as WebhookEventStatus,
      payload: JSON.stringify(params.payload),
      retryCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    query.query = `
      CREATE (${webhookEventMeta.nodeName}:${webhookEventMeta.labelName} {
        id: $id,
        stripeEventId: $stripeEventId,
        eventType: $eventType,
        livemode: $livemode,
        apiVersion: $apiVersion,
        status: $status,
        payload: $payload,
        retryCount: $retryCount,
        createdAt: datetime($createdAt),
        updatedAt: datetime($updatedAt)
      })
      RETURN ${webhookEventMeta.nodeName}
    `;

    return this.neo4j.writeOne(query);
  }

  async updateStatus(params: {
    id: string;
    status: WebhookEventStatus;
    processedAt?: Date;
    error?: string;
    incrementRetryCount?: boolean;
  }): Promise<WebhookEvent> {
    const query = this.neo4j.initQuery({ serialiser: WebhookEventModel });

    const setValues: string[] = [
      `${webhookEventMeta.nodeName}.status = $status`,
      `${webhookEventMeta.nodeName}.updatedAt = datetime($updatedAt)`,
    ];

    query.queryParams = {
      id: params.id,
      status: params.status,
      updatedAt: new Date().toISOString(),
    };

    if (params.processedAt) {
      query.queryParams.processedAt = params.processedAt.toISOString();
      setValues.push(`${webhookEventMeta.nodeName}.processedAt = datetime($processedAt)`);
    }

    if (params.error !== undefined) {
      query.queryParams.error = params.error;
      setValues.push(`${webhookEventMeta.nodeName}.error = $error`);
    }

    if (params.incrementRetryCount) {
      setValues.push(`${webhookEventMeta.nodeName}.retryCount = ${webhookEventMeta.nodeName}.retryCount + 1`);
    }

    query.query = `
      MATCH (${webhookEventMeta.nodeName}:${webhookEventMeta.labelName} {id: $id})
      SET ${setValues.join(", ")}
      RETURN ${webhookEventMeta.nodeName}
    `;

    return this.neo4j.writeOne(query);
  }
}
