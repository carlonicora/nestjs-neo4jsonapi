import { Injectable, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "crypto";
import { Neo4jService } from "@carlonicora/nestjs-neo4jsonapi";
import { subscriptionMeta } from "../entities/subscription.meta";
import { UsageRecord } from "../entities/usage-record.entity";
import { usageRecordMeta } from "../entities/usage-record.meta";
import { UsageRecordModel } from "../entities/usage-record.model";

@Injectable()
export class UsageRecordRepository implements OnModuleInit {
  constructor(private readonly neo4j: Neo4jService) {}

  async onModuleInit() {
    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT ${usageRecordMeta.nodeName}_id IF NOT EXISTS FOR (${usageRecordMeta.nodeName}:${usageRecordMeta.labelName}) REQUIRE ${usageRecordMeta.nodeName}.id IS UNIQUE`,
    });

    await this.neo4j.writeOne({
      query: `CREATE INDEX ${usageRecordMeta.nodeName}_subscriptionId_idx IF NOT EXISTS FOR (${usageRecordMeta.nodeName}:${usageRecordMeta.labelName}) ON (${usageRecordMeta.nodeName}.subscriptionId)`,
    });
  }

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
