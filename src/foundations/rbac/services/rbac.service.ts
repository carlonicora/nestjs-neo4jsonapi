import { Injectable } from "@nestjs/common";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { JsonApiDataInterface } from "../../../core/jsonapi/interfaces/jsonapi.data.interface";
import { RbacRepository } from "../repositories/rbac.repository";
import { permissionMappingModel } from "../entities/permission-mapping.model";
import { modulePathsModel } from "../entities/module-paths.model";

@Injectable()
export class RbacService {
  constructor(
    private readonly rbacRepository: RbacRepository,
    private readonly jsonApiService: JsonApiService,
  ) {}

  async findPermissionMappings(): Promise<JsonApiDataInterface> {
    const entities = await this.rbacRepository.findPermissionMappings();
    return this.jsonApiService.buildList(permissionMappingModel, entities);
  }

  async findModuleRelationshipPaths(): Promise<JsonApiDataInterface> {
    const entities = await this.rbacRepository.findModuleRelationshipPaths();
    return this.jsonApiService.buildList(modulePathsModel, entities);
  }
}
