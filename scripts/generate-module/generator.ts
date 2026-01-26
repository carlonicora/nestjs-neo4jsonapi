import * as fs from "fs";
import * as path from "path";
import { JsonModuleDefinition } from "./types/json-schema.interface";
import { TemplateData, TemplateField } from "./types/template-data.interface";
import { transformNames } from "./transformers/name-transformer";
import { mapRelationships } from "./transformers/relationship-mapper";
import { generateNestedRoutes } from "./transformers/nested-route-generator";
import { validateJsonSchema, validationPassed, formatValidationErrors } from "./validators/json-schema-validator";
import { generateEntityFile } from "./templates/entity.template";
import { generateMetaFile } from "./templates/meta.template";
import { generateModuleFile } from "./templates/module.template";
import { generateServiceFile } from "./templates/service.template";
import { generateRepositoryFile } from "./templates/repository.template";
import { generateControllerFile } from "./templates/controller.template";
import { generateBaseDTOFile } from "./templates/dto.base.template";
import { generatePostDTOFile } from "./templates/dto.post.template";
import { generatePutDTOFile } from "./templates/dto.put.template";
import { generateRelationshipDTOFile } from "./templates/dto.relationship.template";
import { generateServiceSpecFile } from "./templates/service.spec.template";
import { generateRepositorySpecFile } from "./templates/repository.spec.template";
import { generateControllerSpecFile } from "./templates/controller.spec.template";
import { generateDTOSpecFile } from "./templates/dto.spec.template";
import { writeFiles, FileToWrite } from "./utils/file-writer";
import { registerModule } from "./utils/module-registrar";
import { normalizeCypherType, getTsType, getValidationDecorators, CypherType } from "./utils/type-utils";

export interface GenerateModuleOptions {
  jsonPath: string;
  dryRun?: boolean;
  force?: boolean;
  noRegister?: boolean;
}

/**
 * Main generator function
 *
 * @param options - Generation options
 */
export async function generateModule(options: GenerateModuleOptions): Promise<void> {
  const { jsonPath, dryRun = false, force = false, noRegister = false } = options;

  // 1. Load and parse JSON
  console.log(`📖 Loading JSON schema from: ${jsonPath}`);
  const jsonContent = fs.readFileSync(jsonPath, "utf-8");
  let jsonSchema: JsonModuleDefinition = JSON.parse(jsonContent);

  // Handle array format (for bulk import compatibility)
  if (Array.isArray(jsonSchema)) {
    if (jsonSchema.length === 0) {
      throw new Error("JSON array is empty");
    }
    if (jsonSchema.length > 1) {
      console.warn(`⚠️  Warning: JSON file contains ${jsonSchema.length} definitions. Only processing the first one.`);
    }
    jsonSchema = jsonSchema[0];
  }

  // 2. Validate JSON schema
  console.log(`✓ Validating JSON schema...`);
  const validationErrors = validateJsonSchema(jsonSchema);

  if (validationErrors.length > 0) {
    console.error("❌ Validation failed:\n");
    console.error(formatValidationErrors(validationErrors));

    if (!validationPassed(validationErrors)) {
      process.exit(1);
    }
  }

  // 3. Transform data
  console.log(`✓ Transforming data...`);
  const names = transformNames(jsonSchema.moduleName, jsonSchema.endpointName);
  const relationships = mapRelationships(jsonSchema.relationships);
  const nestedRoutes = generateNestedRoutes(relationships, {
    endpoint: jsonSchema.endpointName,
    nodeName: names.camelCase,
  });

  // Map fields to template fields with type normalization
  const fields: TemplateField[] = jsonSchema.fields.map((field) => {
    const normalizedType = normalizeCypherType(field.type);
    if (!normalizedType) {
      throw new Error(`Invalid field type "${field.type}" for field "${field.name}". Valid types: string, number, boolean, date, datetime, json (and their array variants with [])`);
    }
    return {
      name: field.name,
      type: normalizedType,
      required: !field.nullable,
      tsType: getTsType(normalizedType),
    };
  });

  // Build template data
  const templateData: TemplateData = {
    names,
    endpoint: jsonSchema.endpointName,
    labelName: names.pascalCase,
    nodeName: names.camelCase,
    isCompanyScoped: true, // Default: true
    targetDir: jsonSchema.targetDir,
    fields,
    relationships,
    libraryImports: [],
    entityImports: [],
    metaImports: [],
    dtoImports: [],
    nestedRoutes,
    dtoFields: fields.map((field) => ({
      name: field.name,
      type: field.tsType,
      isOptional: !field.required,
      decorators: getValidationDecorators(field.type as CypherType, field.required),
    })),
    postDtoRelationships: [],
    putDtoRelationships: [],
  };

  // 4. Generate files
  console.log(`✓ Generating files...`);
  const basePath = `apps/api/src/${jsonSchema.targetDir}/${names.kebabCase}`;

  const filesToWrite: FileToWrite[] = [
    // Meta (must be generated before entity to avoid circular dependencies)
    {
      path: path.resolve(process.cwd(), `${basePath}/entities/${names.kebabCase}.meta.ts`),
      content: generateMetaFile(templateData),
    },
    // Entity
    {
      path: path.resolve(process.cwd(), `${basePath}/entities/${names.kebabCase}.ts`),
      content: generateEntityFile(templateData),
    },
    // Module
    {
      path: path.resolve(process.cwd(), `${basePath}/${names.kebabCase}.module.ts`),
      content: generateModuleFile(templateData),
    },
    // Service
    {
      path: path.resolve(process.cwd(), `${basePath}/services/${names.kebabCase}.service.ts`),
      content: generateServiceFile(templateData),
    },
    // Repository
    {
      path: path.resolve(process.cwd(), `${basePath}/repositories/${names.kebabCase}.repository.ts`),
      content: generateRepositoryFile(templateData),
    },
    // Controller
    {
      path: path.resolve(process.cwd(), `${basePath}/controllers/${names.kebabCase}.controller.ts`),
      content: generateControllerFile(templateData),
    },
    // DTOs
    {
      path: path.resolve(process.cwd(), `${basePath}/dtos/${names.kebabCase}.dto.ts`),
      content: generateBaseDTOFile(templateData),
    },
    {
      path: path.resolve(process.cwd(), `${basePath}/dtos/${names.kebabCase}.post.dto.ts`),
      content: generatePostDTOFile(templateData),
    },
    {
      path: path.resolve(process.cwd(), `${basePath}/dtos/${names.kebabCase}.put.dto.ts`),
      content: generatePutDTOFile(templateData),
    },
  ];

  // Add relationship DTO file if there are MANY relationships
  const relationshipDTOContent = generateRelationshipDTOFile(templateData);
  if (relationshipDTOContent) {
    filesToWrite.push({
      path: path.resolve(process.cwd(), `${basePath}/dtos/${names.kebabCase}.relationship.dto.ts`),
      content: relationshipDTOContent,
    });
  }

  // Add test files (co-located with source files)
  filesToWrite.push(
    // Service test
    {
      path: path.resolve(process.cwd(), `${basePath}/services/${names.kebabCase}.service.spec.ts`),
      content: generateServiceSpecFile(templateData),
    },
    // Repository test
    {
      path: path.resolve(process.cwd(), `${basePath}/repositories/${names.kebabCase}.repository.spec.ts`),
      content: generateRepositorySpecFile(templateData),
    },
    // Controller test
    {
      path: path.resolve(process.cwd(), `${basePath}/controllers/${names.kebabCase}.controller.spec.ts`),
      content: generateControllerSpecFile(templateData),
    },
    // DTO test
    {
      path: path.resolve(process.cwd(), `${basePath}/dtos/${names.kebabCase}.dto.spec.ts`),
      content: generateDTOSpecFile(templateData),
    },
  );

  // 5. Write files
  console.log(`\n📝 Writing ${filesToWrite.length} files...\n`);
  writeFiles(filesToWrite, { dryRun, force });

  // 6. Register module
  if (!noRegister && !dryRun) {
    console.log(`\n📦 Registering module...`);
    try {
      registerModule({
        moduleName: names.pascalCase,
        targetDir: jsonSchema.targetDir,
        kebabName: names.kebabCase,
        dryRun,
      });
    } catch (error: any) {
      console.error(`⚠️  Warning: Could not register module: ${error.message}`);
    }
  }

  // 7. Summary
  console.log(`\n✅ Module generation complete!`);
  console.log(`\n📂 Generated files in: apps/api/src/${jsonSchema.targetDir}/${names.kebabCase}/`);
  console.log(`\n📋 Next steps:`);
  console.log(`   1. Review generated code`);
  console.log(`   2. Run: pnpm lint:api --fix`);
  console.log(`   3. Run: pnpm build:api`);
  console.log(`   4. Run tests: pnpm --filter only35-api test -- ${names.kebabCase}`);
}
