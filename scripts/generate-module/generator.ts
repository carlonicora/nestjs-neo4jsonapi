import * as fs from "fs";
import * as path from "path";
import { JsonModuleDefinition } from "./types/json-schema.interface";
import { AliasMetaInfo, TemplateData, TemplateField } from "./types/template-data.interface";
import { transformNames, toCamelCase, toKebabCase } from "./transformers/name-transformer";
import { mapRelationships } from "./transformers/relationship-mapper";
import { isFoundationImport, FOUNDATION_PACKAGE, resolveMetaImportPath } from "./transformers/import-resolver";
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
import { writeFiles, formatFiles, FileToWrite } from "./utils/file-writer";
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
  console.info(`📖 Loading JSON schema from: ${jsonPath}`);
  const jsonContent = fs.readFileSync(jsonPath, "utf-8");
  const parsed = JSON.parse(jsonContent);

  // Normalize to array
  const jsonSchemas: JsonModuleDefinition[] = Array.isArray(parsed) ? parsed : [parsed];
  if (jsonSchemas.length === 0) {
    throw new Error("JSON array is empty");
  }

  const total = jsonSchemas.length;
  console.info(`   Found ${total} module definition(s)\n`);

  let failedCount = 0;

  for (let i = 0; i < total; i++) {
    const jsonSchema = jsonSchemas[i];
    console.info(`\n📦 Processing module ${i + 1}/${total}: ${jsonSchema.moduleName || "unknown"}`);
    console.info(`${"─".repeat(50)}`);

    // 2. Validate JSON schema
    console.info(`✓ Validating JSON schema...`);
    const validationErrors = validateJsonSchema(jsonSchema);

    if (validationErrors.length > 0) {
      console.error("❌ Validation failed:\n");
      console.error(formatValidationErrors(validationErrors));

      if (!validationPassed(validationErrors)) {
        failedCount++;
        console.error(`   Skipping module ${jsonSchema.moduleName || i + 1}\n`);
        continue;
      }
    }

    // 3. Transform data
    console.info(`✓ Transforming data...`);
    const names = transformNames(jsonSchema.moduleName, jsonSchema.endpointName);
    const relationships = mapRelationships(jsonSchema.relationships);

    // Determine which aliases conflict (multiple aliases targeting the same entity)
    const entityAliasNames = new Map<string, string[]>();
    for (const rel of relationships) {
      if (rel.alias) {
        const key = rel.relatedEntity.name;
        if (!entityAliasNames.has(key)) entityAliasNames.set(key, []);
        entityAliasNames.get(key)!.push(rel.alias);
      }
    }
    const conflictingAliases = new Set<string>();
    for (const aliases of entityAliasNames.values()) {
      if (aliases.length > 1) {
        for (const alias of aliases) conflictingAliases.add(alias);
      }
    }

    const nestedRoutes = generateNestedRoutes(relationships, {
      endpoint: jsonSchema.endpointName,
      nodeName: names.camelCase,
    }, conflictingAliases);

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

    // Build alias metas only for relationships where multiple aliases target the same entity
    // (e.g., CreatedBy and AssignedTo both targeting User need disambiguation,
    //  but RelateToPartType targeting PartType alone does not)
    const entityAliasCount = new Map<string, number>();
    for (const rel of relationships) {
      if (rel.alias) {
        const key = rel.relatedEntity.name;
        entityAliasCount.set(key, (entityAliasCount.get(key) || 0) + 1);
      }
    }

    const aliasMetaMap = new Map<string, AliasMetaInfo>();
    for (const rel of relationships) {
      if (rel.alias && !aliasMetaMap.has(rel.alias) && (entityAliasCount.get(rel.relatedEntity.name) || 0) > 1) {
        const baseEntityMeta = `${toCamelCase(rel.relatedEntity.name)}Meta`;
        const baseEntityImportPath = isFoundationImport(rel.relatedEntity.directory)
          ? FOUNDATION_PACKAGE
          : resolveMetaImportPath({
              fromDir: jsonSchema.targetDir,
              fromModule: names.kebabCase,
              toDir: rel.relatedEntity.directory,
              toModule: rel.relatedEntity.kebabCase,
            });
        aliasMetaMap.set(rel.alias, {
          aliasName: rel.alias,
          aliasCamelCase: toCamelCase(rel.alias),
          aliasKebabCase: toKebabCase(rel.alias),
          baseEntityMeta,
          baseEntityImportPath,
        });
      }
    }
    const aliasMetas = Array.from(aliasMetaMap.values());

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
      aliasMetas,
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
    console.info(`✓ Generating files...`);
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
    console.info(`\n📝 Writing ${filesToWrite.length} files...\n`);
    writeFiles(filesToWrite, { dryRun, force });

    // 5b. Format files with Prettier
    if (!dryRun) {
      formatFiles(filesToWrite.map((f) => f.path));
    }

    // 6. Register module
    if (!noRegister && !dryRun) {
      console.info(`\n📦 Registering module...`);
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

    console.info(`\n✅ ${jsonSchema.moduleName} generation complete!`);
    console.info(`   📂 Generated files in: apps/api/src/${jsonSchema.targetDir}/${names.kebabCase}/`);
  }

  // 7. Summary
  console.info(`\n${"═".repeat(50)}`);
  console.info(`✅ All done! ${total - failedCount}/${total} module(s) generated successfully.`);
  if (failedCount > 0) {
    console.info(`⚠️  ${failedCount} module(s) failed validation and were skipped.`);
  }
  console.info(`\n📋 Next steps:`);
  console.info(`   1. Review generated code`);
  console.info(`   2. Run: pnpm lint:api --fix`);
  console.info(`   3. Run: pnpm build:api`);
  console.info(`   4. Run tests`);
}
