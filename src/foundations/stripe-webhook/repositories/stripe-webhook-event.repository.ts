import { Injectable, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "crypto";
import { Neo4jService } from "../../../core/neo4j";
import { StripeWebhookEvent, StripeWebhookEventStatus } from "../entities/stripe-webhook-event.entity";
import { stripeWebhookEventMeta } from "../entities/stripe-webhook-event.meta";
import { StripeWebhookEventModel } from "../entities/stripe-webhook-event.model";

/**
 * StripeWebhookEventRepository
 *
 * Neo4j repository for managing StripeWebhookEvent nodes that track Stripe webhook processing.
 * Provides idempotent webhook handling and processing status tracking.
 *
 * Key Features:
 * - Automatic constraint creation for ID and Stripe event ID uniqueness
 * - Query events by ID, Stripe event ID, or processing status
 * - Create and update operations for webhook lifecycle
 * - Idempotency support to prevent duplicate processing
 * - Status tracking (pending, processing, succeeded, failed)
 * - Error message storage for failed events
 * - Retry count tracking with maximum retry limit
 * - Stores full event payload for debugging
 */
@Injectable()
export class StripeWebhookEventRepository implements OnModuleInit {
  constructor(private readonly neo4j: Neo4jService) {}

  /**
   * Initialize repository constraints
   */
  async onModuleInit() {
    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT ${stripeWebhookEventMeta.nodeName}_id IF NOT EXISTS FOR (${stripeWebhookEventMeta.nodeName}:${stripeWebhookEventMeta.labelName}) REQUIRE ${stripeWebhookEventMeta.nodeName}.id IS UNIQUE`,
    });

    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT ${stripeWebhookEventMeta.nodeName}_stripeEventId IF NOT EXISTS FOR (${stripeWebhookEventMeta.nodeName}:${stripeWebhookEventMeta.labelName}) REQUIRE ${stripeWebhookEventMeta.nodeName}.stripeEventId IS UNIQUE`,
    });
  }

  /**
   * Find webhook event by Stripe event ID
   */
  async findByStripeEventId(params: { stripeEventId: string }): Promise<StripeWebhookEvent | null> {
    const query = this.neo4j.initQuery({ serialiser: StripeWebhookEventModel });

    query.queryParams = {
      stripeEventId: params.stripeEventId,
    };

    query.query = `
      MATCH (${stripeWebhookEventMeta.nodeName}:${stripeWebhookEventMeta.labelName} {stripeEventId: $stripeEventId})
      RETURN ${stripeWebhookEventMeta.nodeName}
    `;

    return this.neo4j.readOne(query);
  }

  /**
   * Find pending webhook events for retry processing
   */
  async findPendingEvents(params: { limit?: number }): Promise<StripeWebhookEvent[]> {
    const query = this.neo4j.initQuery({ serialiser: StripeWebhookEventModel });

    query.queryParams = {
      limit: params.limit ?? 100,
    };

    query.query = `
      MATCH (${stripeWebhookEventMeta.nodeName}:${stripeWebhookEventMeta.labelName})
      WHERE ${stripeWebhookEventMeta.nodeName}.status IN ['pending', 'failed']
        AND ${stripeWebhookEventMeta.nodeName}.retryCount < 5
      RETURN ${stripeWebhookEventMeta.nodeName}
      ORDER BY ${stripeWebhookEventMeta.nodeName}.createdAt ASC
      LIMIT $limit
    `;

    return this.neo4j.readMany(query);
  }

  /**
   * Create a new webhook event
   */
  async create(params: {
    stripeEventId: string;
    eventType: string;
    livemode: boolean;
    apiVersion: string | null;
    payload: Record<string, any>;
  }): Promise<StripeWebhookEvent> {
    const query = this.neo4j.initQuery({ serialiser: StripeWebhookEventModel });

    const id = randomUUID();

    query.queryParams = {
      id,
      stripeEventId: params.stripeEventId,
      eventType: params.eventType,
      livemode: params.livemode,
      apiVersion: params.apiVersion,
      status: "pending" as StripeWebhookEventStatus,
      payload: JSON.stringify(params.payload),
      retryCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    query.query = `
      CREATE (${stripeWebhookEventMeta.nodeName}:${stripeWebhookEventMeta.labelName} {
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
      RETURN ${stripeWebhookEventMeta.nodeName}
    `;

    return this.neo4j.writeOne(query);
  }

  /**
   * Update webhook event status
   */
  async updateStatus(params: {
    id: string;
    status: StripeWebhookEventStatus;
    processedAt?: Date;
    error?: string;
    incrementRetryCount?: boolean;
  }): Promise<StripeWebhookEvent> {
    const query = this.neo4j.initQuery({ serialiser: StripeWebhookEventModel });

    const setValues: string[] = [
      `${stripeWebhookEventMeta.nodeName}.status = $status`,
      `${stripeWebhookEventMeta.nodeName}.updatedAt = datetime($updatedAt)`,
    ];

    query.queryParams = {
      id: params.id,
      status: params.status,
      updatedAt: new Date().toISOString(),
    };

    if (params.processedAt) {
      query.queryParams.processedAt = params.processedAt.toISOString();
      setValues.push(`${stripeWebhookEventMeta.nodeName}.processedAt = datetime($processedAt)`);
    }

    if (params.error !== undefined) {
      query.queryParams.error = params.error;
      setValues.push(`${stripeWebhookEventMeta.nodeName}.error = $error`);
    }

    if (params.incrementRetryCount) {
      setValues.push(
        `${stripeWebhookEventMeta.nodeName}.retryCount = ${stripeWebhookEventMeta.nodeName}.retryCount + 1`,
      );
    }

    query.query = `
      MATCH (${stripeWebhookEventMeta.nodeName}:${stripeWebhookEventMeta.labelName} {id: $id})
      SET ${setValues.join(", ")}
      RETURN ${stripeWebhookEventMeta.nodeName}
    `;

    return this.neo4j.writeOne(query);
  }
}
