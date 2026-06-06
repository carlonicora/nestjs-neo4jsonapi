import { TemplateData } from "../types/template-data.interface";

/**
 * Generate module file content
 *
 * @param data - Template data
 * @returns Generated TypeScript code
 */
export function generateModuleFile(data: TemplateData): string {
  const { names, targetDir, requiresS3, exportService, sharedScope } = data;

  const libImports = ["AuditModule", "GraphModule", "GraphDescriptorRegistry", "modelRegistry"];
  if (requiresS3) libImports.push("S3Module");

  const moduleImports = requiresS3 ? "[AuditModule, S3Module, GraphModule]" : "[AuditModule, GraphModule]";
  const exportsArr = exportService ? `[${names.pascalCase}Service]` : "[]";

  return `import {
  ${[...libImports].sort().join(",\n  ")},
} from "@carlonicora/nestjs-neo4jsonapi";
import { Module, OnModuleInit } from "@nestjs/common";
import { ModuleId } from "${sharedScope}";
import { ${names.pascalCase}Controller } from "src/${targetDir}/${names.kebabCase}/controllers/${names.kebabCase}.controller";
import { ${names.pascalCase}Descriptor } from "src/${targetDir}/${names.kebabCase}/entities/${names.kebabCase}";
import { ${names.pascalCase}Repository } from "src/${targetDir}/${names.kebabCase}/repositories/${names.kebabCase}.repository";
import { ${names.pascalCase}Service } from "src/${targetDir}/${names.kebabCase}/services/${names.kebabCase}.service";

@Module({
  controllers: [${names.pascalCase}Controller],
  providers: [${names.pascalCase}Descriptor.model.serialiser, ${names.pascalCase}Repository, ${names.pascalCase}Service],
  exports: ${exportsArr},
  imports: ${moduleImports},
})
export class ${names.pascalCase}Module implements OnModuleInit {
  constructor(private readonly graphRegistry: GraphDescriptorRegistry) {}

  onModuleInit() {
    modelRegistry.register(${names.pascalCase}Descriptor.model);
    this.graphRegistry.register({ descriptor: ${names.pascalCase}Descriptor, moduleId: ModuleId.${names.pascalCase} });
  }
}
`;
}
