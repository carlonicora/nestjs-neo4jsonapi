import { TemplateData } from "../types/template-data.interface";

/**
 * Generate module file content
 *
 * @param data - Template data
 * @returns Generated TypeScript code
 */
export function generateModuleFile(data: TemplateData): string {
  const { names, targetDir } = data;

  return `import {
  AuditModule,
  modelRegistry,
} from "@carlonicora/nestjs-neo4jsonapi";
import { Module, OnModuleInit } from "@nestjs/common";
import { ${names.pascalCase}Controller } from "src/${targetDir}/${names.kebabCase}/controllers/${names.kebabCase}.controller";
import { ${names.pascalCase}Descriptor } from "src/${targetDir}/${names.kebabCase}/entities/${names.kebabCase}";
import { ${names.pascalCase}Repository } from "src/${targetDir}/${names.kebabCase}/repositories/${names.kebabCase}.repository";
import { ${names.pascalCase}Service } from "src/${targetDir}/${names.kebabCase}/services/${names.kebabCase}.service";

@Module({
  controllers: [${names.pascalCase}Controller],
  providers: [
    ${names.pascalCase}Descriptor.model.serialiser,
    ${names.pascalCase}Repository,
    ${names.pascalCase}Service,
  ],
  exports: [],
  imports: [AuditModule],
})
export class ${names.pascalCase}Module implements OnModuleInit {
  onModuleInit() {
    modelRegistry.register(${names.pascalCase}Descriptor.model);
  }
}
`;
}
