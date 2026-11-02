import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { OfflineChangeSet, OfflineChangeSetDescriptor } from "../entities/offline-change-set";

/**
 * Repository of the stored offline change sets (one `OfflineChangeSet` node of the caller's
 * company per package opened, holding its results). The service uses the inherited,
 * company-scoped `findById` (a package sent again) and `create` (a package just opened), and
 * `deleteOlderThan` (clean-up of old ones); every read and write of a change itself runs
 * through the app's own routes (`OfflineRouteRunner`).
 * The inherited `onModuleInit` creates the id constraint.
 */
@Injectable()
export class OfflineChangeSetRepository extends AbstractRepository<
  OfflineChangeSet,
  typeof OfflineChangeSetDescriptor.relationships
> {
  protected readonly descriptor = OfflineChangeSetDescriptor;

  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  /**
   * Deletes the request company's stored change sets created before `before`. Without a company
   * in the request it deletes nothing: `buildDefaultMatch()` matches every company's nodes when
   * `$companyId` is null.
   */
  async deleteOlderThan(params: { before: Date }): Promise<void> {
    const { nodeName } = this.descriptor.model;
    const query = this.neo4j.initQuery({ serialiser: this.descriptor.model });
    if (!query.queryParams.companyId) return;

    query.queryParams = { ...query.queryParams, before: params.before.toISOString() };

    query.query += `
      ${this.buildDefaultMatch()}
      WHERE ${nodeName}.createdAt < datetime($before)
      DETACH DELETE ${nodeName}
    `;

    await this.neo4j.writeOne(query);
  }
}
