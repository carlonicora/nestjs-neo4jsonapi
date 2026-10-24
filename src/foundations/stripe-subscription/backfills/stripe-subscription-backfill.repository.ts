import { Injectable } from "@nestjs/common";
import { Neo4jService } from "../../../core/neo4j";

/**
 * Records which one-off StripeSubscription backfills have finished, so a worker
 * boot runs each of them once per database.
 *
 * The marker is a `(:StripeSubscriptionBackfill {id})` node. It is not a
 * `(:Migration)` node on purpose: the migrator orders Migration nodes by their
 * date/increment version and reads the newest as "last applied", so a library
 * marker there would make it skip the app's own migrations.
 */
@Injectable()
export class StripeSubscriptionBackfillRepository {
  constructor(private readonly neo4j: Neo4jService) {}

  async isCompleted(params: { id: string }): Promise<boolean> {
    const total = await this.neo4j.readCount(
      `MATCH (backfill:StripeSubscriptionBackfill {id: $id}) RETURN count(backfill) AS total`,
      { id: params.id },
    );
    return total > 0;
  }

  async markCompleted(params: { id: string; summary: string }): Promise<void> {
    await this.neo4j.writeOne({
      query: `
        MERGE (backfill:StripeSubscriptionBackfill {id: $id})
        ON CREATE SET backfill.createdAt = datetime()
        SET backfill.completedAt = datetime(), backfill.summary = $summary
      `,
      queryParams: { id: params.id, summary: params.summary },
    });
  }
}
