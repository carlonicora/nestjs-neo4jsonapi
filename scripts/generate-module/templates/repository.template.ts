import { TemplateData } from "../types/template-data.interface";

/**
 * Generate repository file content
 *
 * @param data - Template data
 * @returns Generated TypeScript code
 */
export function generateRepositoryFile(data: TemplateData): string {
  const { names, targetDir } = data;

  return `import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import {
  AbstractRepository,
  Neo4jService,
  SecurityService,
} from "@carlonicora/nestjs-neo4jsonapi";
import { ${names.pascalCase} } from "src/${targetDir}/${names.kebabCase}/entities/${names.kebabCase}";
import { ${names.pascalCase}Descriptor } from "src/${targetDir}/${names.kebabCase}/entities/${names.kebabCase}";

@Injectable()
export class ${names.pascalCase}Repository extends AbstractRepository<${names.pascalCase}, typeof ${names.pascalCase}Descriptor.relationships> {
  protected readonly descriptor = ${names.pascalCase}Descriptor;

  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  // Inherited methods:
  // - find, findById, create, put, patch, delete
  // - findByRelated
  // - onModuleInit (creates constraints and indexes)

  // Add custom Cypher queries here if needed
}
`;
}
