import { Injectable, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "crypto";
import { JsonApiCursorInterface } from "../../../core/jsonapi/interfaces/jsonapi.cursor.interface";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { Audit } from "../../audit/entities/audit.entity";
import { auditMeta } from "../../audit/entities/audit.meta";
import { auditModel } from "../../audit/entities/audit.model";
import { userMeta } from "../../user/entities/user.meta";

@Injectable()
export class AuditRepository implements OnModuleInit {
  constructor(private readonly neo4jService: Neo4jService) {}

  async onModuleInit() {
    await this.neo4jService.writeOne({
      query: `CREATE CONSTRAINT ${auditMeta.nodeName}_id IF NOT EXISTS FOR (${auditMeta.nodeName}:${auditMeta.labelName}) REQUIRE ${auditMeta.nodeName}.id IS UNIQUE`,
    });
  }

  async findByUser(params: { userId: string; cursor?: JsonApiCursorInterface }): Promise<Audit[]> {
    const query = this.neo4jService.initQuery({ serialiser: auditModel, cursor: params.cursor });

    query.queryParams = {
      ...query.queryParams,
      userId: params.userId,
    };

    query.query = `
        MATCH (audit_user:${userMeta.labelName} {id: $userId})-[:INITIATED]->(audit:${auditMeta.labelName})
        OPTIONAL MATCH (audit)-[:AUDITED]->(audit_audited)
        RETURN audit, audit_user, audit_audited, labels(audit_audited) as audit_audited_labels
        ORDER BY audit.createdAt DESC
    `;

    return this.neo4jService.readMany(query);
  }

  async create(params: {
    userId: string;
    entityType: string;
    entityId: string;
    auditType: string;
    changes?: string;
  }): Promise<void> {
    const query = this.neo4jService.initQuery();
    query.queryParams = {
      ...query.queryParams,
      id: randomUUID(),
      userId: params.userId,
      entityId: params.entityId,
      auditType: params.auditType,
      changes: params.changes ?? null,
    };

    query.query += `
        MATCH (${userMeta.nodeName}:${userMeta.labelName} {id: $userId})
        MATCH (audited:${params.entityType} {id: $entityId})
        CREATE (${auditMeta.nodeName}:${auditMeta.labelName} {
            id: $id,
            auditType: $auditType,
            changes: $changes,
            createdAt: datetime(),
            updatedAt: datetime()
        })
        WITH ${userMeta.nodeName}, ${auditMeta.nodeName}, audited
        CREATE (${userMeta.nodeName})-[:INITIATED]->(${auditMeta.nodeName})
        CREATE (${auditMeta.nodeName})-[:AUDITED]->(audited)
    `;

    await this.neo4jService.writeOne(query);
  }
}
