import { Injectable, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "crypto";
import { Neo4jService } from "@carlonicora/nestjs-neo4jsonapi";
import { subscriptionMeta } from "../entities/subscription.meta";
import { UsageRecord } from "../entities/usage-record.entity";
import { usageRecordMeta } from "../entities/usage-record.meta";
import { UsageRecordModel } from "../entities/usage-record.model";

/**
 * UsageRecordRepository
 *
 * Neo4j repository for managing UsageRecord nodes and their relationships to Subscription nodes.
 * Tracks usage events for metered billing with time-based filtering and aggregation.
 *
 * Key Features:
 * - Automatic constraint creation for ID uniqueness and subscription indexing
 * - Query usage records by subscription with time range filtering
 * - Create operations for recording usage events
 * - Aggregation support for usage summaries by meter
 * - Integration with Stripe V2 Billing Meters
 * - Stores meter ID and event name for tracking
 * - Links to Stripe event IDs for idempotency
 *
 * @example
 * ```typescript
 * const usageRecord = await usageRecordRepository.create({
 *   subscriptionId: 'sub_123',
 *   meterId: 'meter_456',
 *   meterEventName: 'api_calls',
 *   quantity: 100,
 *   timestamp: new Date(),
 *   stripeEventId: 'evt_stripe789'
 * });
 * ```
 */
@Injectable()
export class UsageRecordRepository implements OnModuleInit {
  constructor(private readonly neo4j: Neo4jService) {}

  /**
   * Initialize repository constraints and indexes
   *
   * Creates unique constraint on ID and index on subscriptionId for efficient queries.
   */
  async onModuleInit() {
    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT ${usageRecordMeta.nodeName}_id IF NOT EXISTS FOR (${usageRecordMeta.nodeName}:${usageRecordMeta.labelName}) REQUIRE ${usageRecordMeta.nodeName}.id IS UNIQUE`,
    });

    await this.neo4j.writeOne({
      query: `CREATE INDEX ${usageRecordMeta.nodeName}_subscriptionId_idx IF NOT EXISTS FOR (${usageRecordMeta.nodeName}:${usageRecordMeta.labelName}) ON (${usageRecordMeta.nodeName}.subscriptionId)`,
    });
  }

  /**
   * Find usage records by subscription ID
   *
   * @param params - Query parameters
   * @param params.subscriptionId - Subscription identifier
   * @param params.startTime - Optional filter by start time (inclusive)
   * @param params.endTime - Optional filter by end time (inclusive)
   * @param params.limit - Optional limit (default: 100)
   * @returns Array of usage records ordered by timestamp descending
   */
  async findBySubscriptionId(params: {
    subscriptionId: string;
    startTime?: Date;
    endTime?: Date;
    limit?: number;
  }): Promise<UsageRecord[]> {
    const query = this.neo4j.initQuery({ serialiser: UsageRecordModel });

    const whereParams: string[] = [`${usageRecordMeta.nodeName}.subscriptionId = $subscriptionId`];

    query.queryParams = {
      subscriptionId: params.subscriptionId,
      limit: params.limit ?? 100,
    };

    if (params.startTime) {
      query.queryParams.startTime = params.startTime.toISOString();
      whereParams.push(`${usageRecordMeta.nodeName}.timestamp >= datetime($startTime)`);
    }

    if (params.endTime) {
      query.queryParams.endTime = params.endTime.toISOString();
      whereParams.push(`${usageRecordMeta.nodeName}.timestamp <= datetime($endTime)`);
    }

    query.query = `
      MATCH (${usageRecordMeta.nodeName}:${usageRecordMeta.labelName})
      WHERE ${whereParams.join(" AND ")}
      OPTIONAL MATCH (${usageRecordMeta.nodeName})-[:BELONGS_TO]->(${subscriptionMeta.nodeName}:${subscriptionMeta.labelName})
      RETURN ${usageRecordMeta.nodeName}, ${subscriptionMeta.nodeName}
      ORDER BY ${usageRecordMeta.nodeName}.timestamp DESC
      LIMIT $limit
    `;

    return this.neo4j.readMany(query);
  }

  /**
   * Create a new usage record
   *
   * Creates a UsageRecord node with BELONGS_TO relationship to Subscription.
   *
   * @param params - Creation parameters
   * @param params.subscriptionId - Subscription ID to link to
   * @param params.meterId - Meter ID for local tracking
   * @param params.meterEventName - Stripe meter event name
   * @param params.quantity - Usage quantity reported
   * @param params.timestamp - Timestamp of usage event
   * @param params.stripeEventId - Optional Stripe event ID for idempotency
   * @returns Created UsageRecord
   */
  async create(params: {
    subscriptionId: string;
    meterId: string;
    meterEventName: string;
    quantity: number;
    timestamp: Date;
    stripeEventId?: string;
  }): Promise<UsageRecord> {
    const query = this.neo4j.initQuery({ serialiser: UsageRecordModel });

    const id = randomUUID();

    query.queryParams = {
      id,
      subscriptionId: params.subscriptionId,
      meterId: params.meterId,
      meterEventName: params.meterEventName,
      quantity: params.quantity,
      timestamp: params.timestamp.toISOString(),
      stripeEventId: params.stripeEventId ?? null,
    };

    query.query = `
      MATCH (${subscriptionMeta.nodeName}:${subscriptionMeta.labelName} {id: $subscriptionId})
      CREATE (${usageRecordMeta.nodeName}:${usageRecordMeta.labelName} {
        id: $id,
        subscriptionId: $subscriptionId,
        meterId: $meterId,
        meterEventName: $meterEventName,
        quantity: $quantity,
        timestamp: datetime($timestamp),
        stripeEventId: $stripeEventId,
        createdAt: datetime(),
        updatedAt: datetime()
      })
      CREATE (${usageRecordMeta.nodeName})-[:BELONGS_TO]->(${subscriptionMeta.nodeName})
      RETURN ${usageRecordMeta.nodeName}
    `;

    return this.neo4j.writeOne(query);
  }

  /**
   * Get usage summary for a subscription
   *
   * Aggregates usage data for a time period with totals and breakdowns by meter.
   *
   * @param params - Query parameters
   * @param params.subscriptionId - Subscription identifier
   * @param params.startTime - Summary period start time (inclusive)
   * @param params.endTime - Summary period end time (inclusive)
   * @returns Usage summary with total quantity, record count, and per-meter breakdown
   *
   * @example
   * ```typescript
   * const summary = await usageRecordRepository.getUsageSummary({
   *   subscriptionId: 'sub_123',
   *   startTime: new Date('2024-01-01'),
   *   endTime: new Date('2024-01-31')
   * });
   * // summary.total: 5000
   * // summary.count: 50
   * // summary.byMeter: { 'meter_api': 3000, 'meter_storage': 2000 }
   * ```
   */
  async getUsageSummary(params: { subscriptionId: string; startTime: Date; endTime: Date }): Promise<{
    total: number;
    count: number;
    byMeter: Record<string, number>;
  }> {
    const cypher = `
      MATCH (${usageRecordMeta.nodeName}:${usageRecordMeta.labelName})
      WHERE ${usageRecordMeta.nodeName}.subscriptionId = $subscriptionId
        AND ${usageRecordMeta.nodeName}.timestamp >= datetime($startTime)
        AND ${usageRecordMeta.nodeName}.timestamp <= datetime($endTime)
      WITH ${usageRecordMeta.nodeName}
      RETURN
        sum(${usageRecordMeta.nodeName}.quantity) as total,
        count(${usageRecordMeta.nodeName}) as count,
        collect({meterId: ${usageRecordMeta.nodeName}.meterId, quantity: ${usageRecordMeta.nodeName}.quantity}) as records
    `;

    const queryParams = {
      subscriptionId: params.subscriptionId,
      startTime: params.startTime.toISOString(),
      endTime: params.endTime.toISOString(),
    };

    const result = await this.neo4j.read(cypher, queryParams);

    if (!result || result.length === 0) {
      return { total: 0, count: 0, byMeter: {} };
    }

    const row = result[0];
    const byMeter: Record<string, number> = {};
    const records = row.records || [];
    for (const record of records) {
      byMeter[record.meterId] = (byMeter[record.meterId] || 0) + Number(record.quantity ?? 0);
    }

    return {
      total: Number(row.total ?? 0),
      count: Number(row.count ?? 0),
      byMeter,
    };
  }
}
