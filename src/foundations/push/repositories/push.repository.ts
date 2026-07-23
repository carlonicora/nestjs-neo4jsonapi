import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { Push } from "../../push/entities/push.entity";
import { PushModel } from "../../push/entities/push.model";

@Injectable()
export class PushRepository {
  constructor(private readonly neo4j: Neo4jService) {}

  async findByUserId(params: { userId: string }): Promise<Push[]> {
    const query = this.neo4j.initQuery({ serialiser: PushModel });

    query.queryParams = {
      ...query.queryParams,
      userId: params.userId,
    };

    query.query += `
        MATCH (user:User {id: $userId})-[:BELONGS_TO]->(company)
        MATCH (push:PushSubscription)<-[:HAS_PUSH]-(user)
        RETURN push
    `;

    return this.neo4j.readMany(query);
  }

  async findByEndpoint(params: { endpoint: string }): Promise<Push[]> {
    const query = this.neo4j.initQuery({ serialiser: PushModel });

    query.queryParams = {
      ...query.queryParams,
      endpoint: params.endpoint,
    };

    query.query += `
        MATCH (user:User {id: $currentUserId})-[:BELONGS_TO]->(company)
        MATCH (push:PushSubscription {endpoint: $endpoint})<-[:HAS_PUSH]-(user)
        RETURN push
    `;

    return this.neo4j.readMany(query);
  }

  async deleteByEndpoint(params: { endpoint: string }): Promise<void> {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      ...query.queryParams,
      endpoint: params.endpoint,
    };

    // Endpoints are globally-unique push URLs, so this is intentionally NOT
    // user/company-scoped: a 410/404 can arrive from a worker with no CLS user
    // context, where a scoped MATCH would silently no-op and leave the dead row.
    query.query = `
        MATCH (push:PushSubscription {endpoint: $endpoint})
        DETACH DELETE push
    `;

    await this.neo4j.writeOne(query);
  }

  async create(params: { endpoint: string; p256dh: string; auth: string }): Promise<void> {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      ...query.queryParams,
      id: randomUUID(),
      endpoint: params.endpoint,
      p256dh: params.p256dh,
      auth: params.auth,
    };

    // A push subscription belongs to the BROWSER, not the user: the same FCM
    // endpoint is shared across every account logged in on that browser, and a
    // browser re-subscribes with the same endpoint across sessions. So this is an
    // UPSERT keyed on the endpoint (one node per endpoint), and the HAS_PUSH edge
    // is MERGEd per user. A plain CREATE here duplicated a node on every
    // re-registration/login and left dead duplicates the sender kept retrying.
    // Not company-scoped: a subscription is not a function of company membership.
    query.query = `
        MATCH (user:User {id: $currentUserId})
        MERGE (push:PushSubscription {endpoint: $endpoint})
          ON CREATE SET push.id = $id, push.createdAt = datetime()
        SET push.p256dh = $p256dh, push.auth = $auth, push.updatedAt = datetime()
        MERGE (user)-[:HAS_PUSH]->(push)
    `;

    await this.neo4j.writeOne(query);
  }
}
