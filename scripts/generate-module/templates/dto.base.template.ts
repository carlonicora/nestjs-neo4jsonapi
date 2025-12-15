import { TemplateData } from "../types/template-data.interface";

/**
 * Generate base DTO file content
 *
 * @param data - Template data
 * @returns Generated TypeScript code
 */
export function generateBaseDTOFile(data: TemplateData): string {
  const { names, targetDir } = data;

  return `import { Type } from "class-transformer";
import { Equals, IsNotEmpty, IsUUID, ValidateNested } from "class-validator";
import { ${names.pascalCase}Descriptor } from "src/${targetDir}/${names.kebabCase}/entities/${names.kebabCase}";

export class ${names.pascalCase}DTO {
  @Equals(${names.pascalCase}Descriptor.model.endpoint)
  type: string;

  @IsUUID()
  id: string;
}

export class ${names.pascalCase}DataDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => ${names.pascalCase}DTO)
  data: ${names.pascalCase}DTO;
}

export class ${names.pascalCase}DataListDTO {
  @ValidateNested({ each: true })
  @IsNotEmpty()
  @Type(() => ${names.pascalCase}DTO)
  data: ${names.pascalCase}DTO[];
}
`;
}
