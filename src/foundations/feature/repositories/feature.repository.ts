import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { Feature, FeatureDescriptor } from "../entities/feature";
import { featureMeta } from "../entities/feature.meta";

@Injectable()
export class FeatureRepository extends AbstractRepository<Feature, typeof FeatureDescriptor.relationships> {
  protected readonly descriptor = FeatureDescriptor;

  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  // onModuleInit() (id constraint + fulltext index) and find({ term, cursor, orderBy })
  // (search + module relationship) are inherited — the descriptor declares `module` as a
  // cardinality-many relationship, so buildReturnStatement() already emits the
  // `OPTIONAL MATCH (feature)<-[:IN_FEATURE]-(feature_module:Module)` the old bespoke
  // find() had, and the `name` string field auto-generates the fulltext index the
  // inherited find() searches against for `term`.

  /**
   * Companies opt into features via a (Company)-[:HAS_FEATURE]->(Feature) edge that
   * is NOT modelled as a descriptor relationship (Feature.isCompanyScoped is false —
   * it is a global entity many companies point to, not something a Feature "belongs"
   * to). The explicit Company MATCH is the intended cross-tenant opt-in for a global
   * entity, not a bypass of buildDefaultMatch(). Keep the name and signature stable —
   * external consumers depend on them.
   */
  async findByCompany(params: { companyId: string }): Promise<Feature[]> {
    const query = this.neo4j.initQuery({ serialiser: FeatureDescriptor.model });

    query.queryParams = { ...query.queryParams, companyId: params.companyId };

    query.query = `
      MATCH (company:Company {id: $companyId})-[:HAS_FEATURE]->(${featureMeta.nodeName}:${featureMeta.labelName})
      RETURN ${featureMeta.nodeName}
    `;

    return this.neo4j.readMany(query);
  }

  /**
   * Case-insensitive exact-name lookup — not the fulltext CONTAINS search the
   * inherited find({ term }) performs. Feature is a global entity, so the bare
   * label MATCH is correct here. Keep the name and signature stable — external
   * consumers depend on them.
   */
  async findByName(params: { name: string }): Promise<Feature> {
    const query = this.neo4j.initQuery({ serialiser: FeatureDescriptor.model });

    query.queryParams = { ...query.queryParams, name: params.name };

    query.query = `
      MATCH (${featureMeta.nodeName}:${featureMeta.labelName})
      WHERE toLower(${featureMeta.nodeName}.name) = toLower($name)
      ${this.buildReturnStatement()}
    `;

    return this.neo4j.readOne(query);
  }
}
