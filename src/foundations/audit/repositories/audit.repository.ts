import { Injectable, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "crypto";
import { JsonApiCursorInterface } from "../../../core/jsonapi/interfaces/jsonapi.cursor.interface";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { AuditLog } from "../entities/audit.entity";
import { auditLogMeta } from "../entities/audit.meta";
import { auditLogModel } from "../entities/audit.model";
import { userMeta } from "../../user/entities/user.meta";

@Injectable()
export class AuditRepository implements OnModuleInit {
  constructor(private readonly neo4jService: Neo4jService) {}

  async onModuleInit() {
    await this.neo4jService.writeOne({
      query: `CREATE CONSTRAINT ${auditLogMeta.nodeName}_id IF NOT EXISTS FOR (${auditLogMeta.nodeName}:${auditLogMeta.labelName}) REQUIRE ${auditLogMeta.nodeName}.id IS UNIQUE`,
    });
    await this.neo4jService.writeOne({
      query: `CREATE INDEX audit_entity IF NOT EXISTS FOR (a:${auditLogMeta.labelName}) ON (a.entity_type, a.entity_id)`,
    });
    await this.neo4jService.writeOne({
      query: `CREATE INDEX audit_timestamp IF NOT EXISTS FOR (a:${auditLogMeta.labelName}) ON (a.company_id, a.createdAt)`,
    });
  }

  async createEntry(params: {
    userId: string;
    companyId: string;
    ipAddress: string;
    action: string;
    entityType: string;
    entityId: string;
    fieldName: string | null;
    oldValue: string | null;
    newValue: string | null;
  }): Promise<void> {
    const query = this.neo4jService.initQuery();
    query.queryParams = {
      ...query.queryParams,
      id: randomUUID(),
      userId: params.userId,
      companyId: params.companyId,
      ipAddress: params.ipAddress,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      fieldName: params.fieldName,
      oldValue: params.oldValue,
      newValue: params.newValue,
    };

    query.query += `
        MATCH (${userMeta.nodeName}:${userMeta.labelName} {id: $userId})
        CREATE (${auditLogMeta.nodeName}:${auditLogMeta.labelName} {
            id: $id,
            action: $action,
            entity_type: $entityType,
            entity_id: $entityId,
            field_name: $fieldName,
            old_value: $oldValue,
            new_value: $newValue,
            ip_address: $ipAddress,
            company_id: $companyId,
            createdAt: datetime(),
            updatedAt: datetime()
        })
        WITH ${userMeta.nodeName}, ${auditLogMeta.nodeName}
        CREATE (${userMeta.nodeName})-[:PERFORMED]->(${auditLogMeta.nodeName})
        WITH ${auditLogMeta.nodeName}
        OPTIONAL MATCH (audited {id: $entityId})
        WHERE $entityType IN labels(audited)
        FOREACH (_ IN CASE WHEN audited IS NOT NULL THEN [1] ELSE [] END |
            CREATE (${auditLogMeta.nodeName})-[:AUDITED]->(audited)
        )
    `;

    await this.neo4jService.writeOne(query);
  }

  async findByEntity(params: {
    entityType: string;
    entityId: string;
    companyId: string;
    cursor?: JsonApiCursorInterface;
  }): Promise<AuditLog[]> {
    const query = this.neo4jService.initQuery({ serialiser: auditLogModel, cursor: params.cursor });

    query.queryParams = {
      ...query.queryParams,
      entityType: params.entityType,
      entityId: params.entityId,
      companyId: params.companyId,
    };

    query.query = `
        MATCH (${auditLogMeta.nodeName}_user:${userMeta.labelName})-[:PERFORMED]->(${auditLogMeta.nodeName}:${auditLogMeta.labelName} {
            entity_type: $entityType,
            entity_id: $entityId,
            company_id: $companyId
        })
        OPTIONAL MATCH (${auditLogMeta.nodeName})-[:AUDITED]->(${auditLogMeta.nodeName}_audited)
        RETURN ${auditLogMeta.nodeName}, ${auditLogMeta.nodeName}_user, ${auditLogMeta.nodeName}_audited, labels(${auditLogMeta.nodeName}_audited) as ${auditLogMeta.nodeName}_audited_labels
        ORDER BY ${auditLogMeta.nodeName}.createdAt DESC
    `;

    return this.neo4jService.readMany(query);
  }

  async findActivityByEntity(params: {
    entityType: string;
    entityId: string;
    companyId: string;
    cursor?: JsonApiCursorInterface;
  }): Promise<AuditLog[]> {
    const query = this.neo4jService.initQuery({ serialiser: auditLogModel, cursor: params.cursor });

    query.queryParams = {
      ...query.queryParams,
      entityType: params.entityType,
      entityId: params.entityId,
      companyId: params.companyId,
    };

    query.query = `
        CALL {
          MATCH (${auditLogMeta.nodeName}_${userMeta.nodeName}:${userMeta.labelName})-[:PERFORMED]->(${auditLogMeta.nodeName}:${auditLogMeta.labelName} {
            entity_type: $entityType,
            entity_id: $entityId,
            company_id: $companyId
          })
          WHERE ${auditLogMeta.nodeName}.action <> 'read'
          RETURN ${auditLogMeta.nodeName}, ${auditLogMeta.nodeName}_${userMeta.nodeName}

          UNION ALL

          MATCH (ann:Annotation)-[:RELATES_TO]->(target {id: $entityId})
          WHERE $entityType IN labels(target)
          MATCH (ann)-[:BELONGS_TO]->(:Company {id: $companyId})
          MATCH (ann)-[:CREATED_BY]->(ann_user:${userMeta.labelName})
          RETURN ann AS ${auditLogMeta.nodeName}, ann_user AS ${auditLogMeta.nodeName}_${userMeta.nodeName}
        }
        ORDER BY ${auditLogMeta.nodeName}.createdAt DESC
        {CURSOR}
        RETURN ${auditLogMeta.nodeName}, ${auditLogMeta.nodeName}_${userMeta.nodeName}
    `;

    return this.neo4jService.readMany(query);
  }

  async findByUser(params: { userId: string; cursor?: JsonApiCursorInterface }): Promise<AuditLog[]> {
    const query = this.neo4jService.initQuery({ serialiser: auditLogModel, cursor: params.cursor });

    query.queryParams = {
      ...query.queryParams,
      userId: params.userId,
    };

    query.query = `
        MATCH (${auditLogMeta.nodeName}_user:${userMeta.labelName} {id: $userId})-[:PERFORMED]->(${auditLogMeta.nodeName}:${auditLogMeta.labelName})
        OPTIONAL MATCH (${auditLogMeta.nodeName})-[:AUDITED]->(${auditLogMeta.nodeName}_audited)
        RETURN ${auditLogMeta.nodeName}, ${auditLogMeta.nodeName}_user, ${auditLogMeta.nodeName}_audited, labels(${auditLogMeta.nodeName}_audited) as ${auditLogMeta.nodeName}_audited_labels
        ORDER BY ${auditLogMeta.nodeName}.createdAt DESC
    `;

    return this.neo4jService.readMany(query);
  }
}
