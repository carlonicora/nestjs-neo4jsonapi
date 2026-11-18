import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import {
  JsonApiListDocument,
  JsonApiSingleDocument,
} from "../../../core/jsonapi/interfaces/jsonapi.document.interface";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AbstractService, JsonApiDTOData } from "../../../core/neo4j/abstracts/abstract.service";
import { Skill, SkillDescriptor } from "../entities/skill";
import { SkillRepository } from "../repositories/skill.repository";
import { SkillService } from "./skill.service";

/**
 * The standard CRUD entry points of the Administrator's routes (createCrudHandlers in
 * SkillAdminController), mapped onto SkillService's global-skill methods. They read and
 * write global skills only and never go through the company-scoped read (decision P2).
 */
@Injectable()
export class SkillAdminService extends AbstractService<Skill, typeof SkillDescriptor.relationships> {
  protected readonly descriptor = SkillDescriptor;

  constructor(
    jsonApiService: JsonApiService,
    skillRepository: SkillRepository,
    clsService: ClsService,
    private readonly skillService: SkillService,
  ) {
    super(jsonApiService, skillRepository, clsService, SkillDescriptor.model);
  }

  async find(params: {
    query: any;
    term?: string;
    fetchAll?: boolean;
    orderBy?: string;
    sort?: string;
  }): Promise<JsonApiListDocument> {
    return this.skillService.findGlobal({ query: params.query, term: params.term, sort: params.sort });
  }

  async findById(params: { id: string }): Promise<JsonApiSingleDocument> {
    return this.skillService.findOneGlobal(params);
  }

  async createFromDTO(params: { data: JsonApiDTOData; included?: unknown[] }): Promise<JsonApiSingleDocument> {
    return this.skillService.createGlobal({ data: params.data });
  }

  async putFromDTO(params: { data: JsonApiDTOData; included?: unknown[] }): Promise<JsonApiSingleDocument> {
    return this.skillService.updateGlobal({ data: params.data });
  }

  async delete(params: { id: string }): Promise<void> {
    return this.skillService.removeGlobal(params);
  }
}
