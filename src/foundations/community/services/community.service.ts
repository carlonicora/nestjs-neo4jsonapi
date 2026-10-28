import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AbstractService } from "../../../core/neo4j/abstracts/abstract.service";
import { Community, CommunityDescriptor } from "../entities/community.entity";
import { CommunityRepository } from "../repositories/community.repository";

/** No endpoint exposes groups: the agents call CommunityRepository directly. */
@Injectable()
export class CommunityService extends AbstractService<Community, typeof CommunityDescriptor.relationships> {
  protected readonly descriptor = CommunityDescriptor;

  constructor(jsonApiService: JsonApiService, communityRepository: CommunityRepository, clsService: ClsService) {
    super(jsonApiService, communityRepository, clsService, CommunityDescriptor.model);
  }
}
