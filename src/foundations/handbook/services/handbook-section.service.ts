import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AbstractService } from "../../../core/neo4j/abstracts/abstract.service";
import { HandbookSection, HandbookSectionDescriptor } from "../entities/handbook-section";
import { HandbookSectionRepository } from "../repositories/handbook-section.repository";

/**
 * Read-only from the API's point of view: sections are written only by the
 * ingest, through the repository. Nothing is overridden — the inherited
 * `find` is the whole surface.
 */
@Injectable()
export class HandbookSectionService extends AbstractService<
  HandbookSection,
  typeof HandbookSectionDescriptor.relationships
> {
  protected readonly descriptor = HandbookSectionDescriptor;

  constructor(
    jsonApiService: JsonApiService,
    handbookSectionRepository: HandbookSectionRepository,
    clsService: ClsService,
  ) {
    super(jsonApiService, handbookSectionRepository, clsService, HandbookSectionDescriptor.model);
  }
}
