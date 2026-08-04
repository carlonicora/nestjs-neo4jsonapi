import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { JsonApiDataInterface } from "../../../core/jsonapi/interfaces/jsonapi.data.interface";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AbstractService } from "../../../core/neo4j/abstracts/abstract.service";
import { Feature, FeatureDescriptor } from "../entities/feature";
import { FeatureRepository } from "../repositories/feature.repository";

@Injectable()
export class FeatureService extends AbstractService<Feature, typeof FeatureDescriptor.relationships> {
  protected readonly descriptor = FeatureDescriptor;

  constructor(
    jsonApiService: JsonApiService,
    private readonly featureRepository: FeatureRepository,
    clsService: ClsService,
  ) {
    super(jsonApiService, featureRepository, clsService, FeatureDescriptor.model);
  }

  /**
   * Overrides the inherited find() only to preserve the old bespoke repository's
   * `ORDER BY feature.name ASC` default — the framework's inherited default order
   * is `updatedAt DESC` (EntityDescriptor.defaultOrderBy is not schema-overridable).
   */
  async find(params: {
    query: any;
    term?: string;
    fetchAll?: boolean;
    orderBy?: string;
  }): Promise<JsonApiDataInterface> {
    return super.find({ ...params, orderBy: params.orderBy ?? "name ASC" });
  }

  /**
   * findByCompany wraps a repository query that is not a declared descriptor
   * relationship (Feature.isCompanyScoped is false) — kept with its original name.
   */
  async findByCompany(params: { companyId: string }): Promise<JsonApiDataInterface> {
    return this.jsonApiService.buildList(
      FeatureDescriptor.model,
      await this.featureRepository.findByCompany({
        companyId: params.companyId,
      }),
    );
  }
}
