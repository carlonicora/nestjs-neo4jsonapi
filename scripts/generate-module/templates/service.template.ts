import { TemplateData } from "../types/template-data.interface";

/**
 * Generate service file content
 *
 * @param data - Template data
 * @returns Generated TypeScript code
 */
export function generateServiceFile(data: TemplateData): string {
  const { names, targetDir } = data;

  return `import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import {
  AbstractService,
  JsonApiService,
} from "@carlonicora/nestjs-neo4jsonapi";
import { ${names.pascalCase} } from "src/${targetDir}/${names.kebabCase}/entities/${names.kebabCase}";
import { ${names.pascalCase}Descriptor } from "src/${targetDir}/${names.kebabCase}/entities/${names.kebabCase}";
import { ${names.pascalCase}Repository } from "src/${targetDir}/${names.kebabCase}/repositories/${names.kebabCase}.repository";

@Injectable()
export class ${names.pascalCase}Service extends AbstractService<${names.pascalCase}, typeof ${names.pascalCase}Descriptor.relationships> {
  protected readonly descriptor = ${names.pascalCase}Descriptor;

  constructor(
    jsonApiService: JsonApiService,
    private readonly ${names.camelCase}Repository: ${names.pascalCase}Repository,
    clsService: ClsService,
  ) {
    super(jsonApiService, ${names.camelCase}Repository, clsService, ${names.pascalCase}Descriptor.model);
  }

  // Inherited methods:
  // - find, findById, create, put, patch, delete
  // - createFromDTO, putFromDTO, patchFromDTO
  // - findByRelated

  // Add custom business logic methods here if needed
}
`;
}
