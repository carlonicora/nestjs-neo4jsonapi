import { HttpException, HttpStatus, Injectable } from "@nestjs/common";

import { JsonApiPaginator } from "../../../core/jsonapi/serialisers/jsonapi.paginator";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { RolePostDataDTO } from "../../role/dtos/role.post.dto";
import { RoleDescriptor } from "../../role/entities/role";
import { RoleRepository } from "../repositories/role.repository";
import {
  JsonApiListDocument,
  JsonApiSingleDocument,
} from "../../../core/jsonapi/interfaces/jsonapi.document.interface";

@Injectable()
export class RoleService {
  constructor(
    private readonly builder: JsonApiService,
    private readonly roleRepository: RoleRepository,
  ) {}

  async expectNotExists(params: { name: string }): Promise<void> {
    const role = await this.roleRepository.findByName({ name: params.name });

    if (role) throw new HttpException("A role with the given name already exists", HttpStatus.CONFLICT);
  }

  async findById(params: { roleId: string }): Promise<JsonApiSingleDocument> {
    return this.builder.buildSingle(
      RoleDescriptor.model,
      await this.roleRepository.findById({
        roleId: params.roleId,
      }),
    );
  }

  async find(params: { term?: string; query: any }): Promise<JsonApiListDocument> {
    const paginator: JsonApiPaginator = new JsonApiPaginator(params.query);

    return this.builder.buildList(
      RoleDescriptor.model,
      await this.roleRepository.find({
        term: params.term,
        cursor: paginator.generateCursor(),
      }),
      paginator,
    );
  }

  async findForUser(params: { userId: string; term: string; query: any }): Promise<JsonApiListDocument> {
    const paginator: JsonApiPaginator = new JsonApiPaginator(params.query);

    return this.builder.buildList(
      RoleDescriptor.model,
      await this.roleRepository.findForUser({
        userId: params.userId,
        term: params.term,
        cursor: paginator.generateCursor(),
      }),
      paginator,
    );
  }

  async findNotInUser(params: { userId: string; term: string; query: any }): Promise<JsonApiListDocument> {
    const paginator: JsonApiPaginator = new JsonApiPaginator(params.query);

    return this.builder.buildList(
      RoleDescriptor.model,
      await this.roleRepository.findNotInUser({
        userId: params.userId,
        term: params.term,
        cursor: paginator.generateCursor(),
      }),
      paginator,
    );
  }

  async create(params: { data: RolePostDataDTO }): Promise<JsonApiSingleDocument> {
    await this.roleRepository.create({
      id: params.data.id,
      name: params.data.attributes.name,
      description: params.data.attributes.description,
    });

    return this.findById({ roleId: params.data.id });
  }

  async update(params: { data: RolePostDataDTO }): Promise<JsonApiSingleDocument> {
    const role = await this.roleRepository.findByNameNotId({
      roleId: params.data.id,
      name: params.data.attributes.name,
    });

    if (role) throw new HttpException("A role with the given name already exists", HttpStatus.CONFLICT);

    await this.roleRepository.update({
      id: params.data.id,
      name: params.data.attributes.name,
      description: params.data.attributes.description,
    });

    return this.findById({ roleId: params.data.id });
  }

  async delete(params: { roleId: string }): Promise<void> {
    await this.roleRepository.delete({ roleId: params.roleId });
  }
}
