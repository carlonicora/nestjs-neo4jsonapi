import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { AbstractRepository, Neo4jService, SecurityService } from "@carlonicora/nestjs-neo4jsonapi";
import { HowTo } from "src/features/essentials/how-to/entities/how-to";
import { HowToDescriptor } from "src/features/essentials/how-to/entities/how-to";

@Injectable()
export class HowToRepository extends AbstractRepository<HowTo, typeof HowToDescriptor.relationships> {
  protected readonly descriptor = HowToDescriptor;

  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  // Inherited methods:
  // - find, findById, create, put, patch, delete
  // - findByRelated
  // - onModuleInit (creates constraints and indexes)

  // Add custom Cypher queries here if needed
}
