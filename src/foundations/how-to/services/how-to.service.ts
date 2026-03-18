import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { AbstractService, JsonApiService } from "@carlonicora/nestjs-neo4jsonapi";
import { HowTo } from "src/features/essentials/how-to/entities/how-to";
import { HowToDescriptor } from "src/features/essentials/how-to/entities/how-to";
import { HowToRepository } from "src/features/essentials/how-to/repositories/how-to.repository";

@Injectable()
export class HowToService extends AbstractService<HowTo, typeof HowToDescriptor.relationships> {
  protected readonly descriptor = HowToDescriptor;

  constructor(
    jsonApiService: JsonApiService,
    private readonly howToRepository: HowToRepository,
    clsService: ClsService,
  ) {
    super(jsonApiService, howToRepository, clsService, HowToDescriptor.model);
  }

  // Inherited methods:
  // - find, findById, create, put, patch, delete
  // - createFromDTO, putFromDTO, patchFromDTO
  // - findByRelated

  // Add custom business logic methods here if needed
}
