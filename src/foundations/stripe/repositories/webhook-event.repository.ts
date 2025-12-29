import { Injectable, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "crypto";
import { Neo4jService } from "@carlonicora/nestjs-neo4jsonapi";
import { WebhookEvent, WebhookEventStatus } from "../entities/webhook-event.entity";
import { webhookEventMeta } from "../entities/webhook-event.meta";
import { WebhookEventModel } from "../entities/webhook-event.model";

/**
 * WebhookEventRepository
 *
 * Neo4j repository for managing WebhookEvent nodes that track Stripe webhook processing.
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
 *
 * @example
 * ```typescript
 * const webhookEvent = await webhookEventRepository.create({
 *   stripeEventId: 'evt_stripe123',
 *   eventType: 'customer.subscription.updated',
 *   livemode: true,
 *   apiVersion: '2024-01-01',
 *   payload: { object: { id: 'sub_123' } }
 * });
 * ```
 */
@Injectable()
export class WebhookEventRepository implements OnModuleInit {
  constructor(private readonly neo4j: Neo4jService) {}

  /**
   * Initialize repository constraints
   *
   * Creates unique constraints on module initialization for idempotency.
   */
  async onModuleInit() {
    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT ${webhookEventMeta.nodeName}_id IF NOT EXISTS FOR (${webhookEventMeta.nodeName}:${webhookEventMeta.labelName}) REQUIRE ${webhookEventMeta.nodeName}.id IS UNIQUE`,
    });

    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT ${webhookEventMeta.nodeName}_stripeEventId IF NOT EXISTS FOR (${webhookEventMeta.nodeName}:${webhookEventMeta.labelName}) REQUIRE ${webhookEventMeta.nodeName}.stripeEventId IS UNIQUE`,
    });
  }

  /**
   * Find webhook event by Stripe event ID
   *
   * Used to check for duplicate webhook events (idempotency).
   *
   * @param params - Query parameters
   * @param params.stripeEventId - Stripe event ID
   * @returns WebhookEvent if found, null otherwise
   */
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

  /**
   * Find pending webhook events for retry processing
   *
   * Returns events with status 'pending' or 'failed' that have not exceeded retry limit.
   *
   * @param params - Query parameters
   * @param params.limit - Optional limit (default: 100)
   * @returns Array of pending events ordered by creation date ascending
   */
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

  /**
   * Create a new webhook event
   *
   * Creates a WebhookEvent node with 'pending' status and retry count of 0.
   *
   * @param params - Creation parameters
   * @param params.stripeEventId - Stripe event ID for idempotency
   * @param params.eventType - Stripe event type (e.g., 'customer.subscription.updated')
   * @param params.livemode - Whether event occurred in live mode
   * @param params.apiVersion - Stripe API version (null if not specified)
   * @param params.payload - Full event payload for debugging
   * @returns Created WebhookEvent
   */
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

  /**
   * Update webhook event status
   *
   * Updates processing status with optional error tracking and retry count increment.
   *
   * @param params - Update parameters
   * @param params.id - Internal webhook event ID
   * @param params.status - New processing status
   * @param params.processedAt - Optional processing completion timestamp
   * @param params.error - Optional error message for failed processing
   * @param params.incrementRetryCount - Whether to increment retry count (for failures)
   * @returns Updated WebhookEvent
   *
   * @example
   * ```typescript
   * // Mark event as succeeded
   * await webhookEventRepository.updateStatus({
   *   id: 'evt_123',
   *   status: 'succeeded',
   *   processedAt: new Date()
   * });
   *
   * // Mark event as failed with error and increment retry
   * await webhookEventRepository.updateStatus({
   *   id: 'evt_123',
   *   status: 'failed',
   *   error: 'Customer not found',
   *   incrementRetryCount: true
   * });
   * ```
   */
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
