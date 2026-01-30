import { TemplateData } from "../types/template-data.interface";
import { isFoundationImport, FOUNDATION_PACKAGE, resolveMetaImportPath } from "../transformers/import-resolver";
import { toPascalCase } from "../transformers/name-transformer";
import { getManyRelationships } from "./dto.relationship.template";

/**
 * Generate controller file content with CRUD and nested routes
 * Uses handler factories pattern for cleaner, more maintainable controllers
 *
 * @param data - Template data
 * @returns Generated TypeScript code
 */
export function generateControllerFile(data: TemplateData): string {
  const { names, targetDir, nestedRoutes } = data;

  // Separate OLD and NEW structure routes
  const oldStructureRoutes = nestedRoutes.filter((route) => !route.isNewStructure);
  const newStructureRoutes = nestedRoutes.filter((route) => route.isNewStructure);

  // Build meta imports for OLD structure nested routes
  const oldMetaImportPaths = new Map<string, string[]>();
  for (const route of oldStructureRoutes) {
    const rel = data.relationships.find((r) => r.model === route.relatedMeta)!;
    // Skip self-referential relationships - own meta is imported separately below
    if (rel.relatedEntity.name === names.pascalCase) {
      continue;
    }
    const path = isFoundationImport(rel.relatedEntity.directory)
      ? FOUNDATION_PACKAGE
      : resolveMetaImportPath({
          fromDir: targetDir,
          fromModule: names.kebabCase,
          toDir: rel.relatedEntity.directory,
          toModule: rel.relatedEntity.kebabCase,
        });
    if (!oldMetaImportPaths.has(path)) {
      oldMetaImportPaths.set(path, []);
    }
    if (!oldMetaImportPaths.get(path)!.includes(route.relatedMeta)) {
      oldMetaImportPaths.get(path)!.push(route.relatedMeta);
    }
  }

  // Build Descriptor imports for NEW structure nested routes
  const newDescriptorImportPaths = new Map<string, string[]>();
  for (const route of newStructureRoutes) {
    if (route.importPath && route.descriptorName) {
      if (!newDescriptorImportPaths.has(route.importPath)) {
        newDescriptorImportPaths.set(route.importPath, []);
      }
      if (!newDescriptorImportPaths.get(route.importPath)!.includes(route.descriptorName)) {
        newDescriptorImportPaths.get(route.importPath)!.push(route.descriptorName);
      }
    }
  }

  // Combine all import lines
  const importLines: string[] = [];
  for (const [path, items] of oldMetaImportPaths.entries()) {
    importLines.push(`import { ${items.join(", ")} } from "${path}";`);
  }
  for (const [path, items] of newDescriptorImportPaths.entries()) {
    importLines.push(`import { ${items.join(", ")} } from "${path}";`);
  }

  const metaImportsCode = importLines.length > 0 ? `\n${importLines.join("\n")}\n` : "";

  // Get MANY relationships for add/remove endpoints
  const manyRelationships = getManyRelationships(data.relationships);

  // Build meta imports for MANY relationship endpoints (to access their endpoint)
  for (const rel of manyRelationships) {
    if (rel.isNewStructure) {
      // NEW structure: import Descriptor
      if (rel.importPath && rel.descriptorName) {
        if (!newDescriptorImportPaths.has(rel.importPath)) {
          newDescriptorImportPaths.set(rel.importPath, []);
        }
        if (!newDescriptorImportPaths.get(rel.importPath)!.includes(rel.descriptorName)) {
          newDescriptorImportPaths.get(rel.importPath)!.push(rel.descriptorName);
        }
      }
    } else {
      // OLD structure: import meta
      const path = isFoundationImport(rel.relatedEntity.directory)
        ? FOUNDATION_PACKAGE
        : resolveMetaImportPath({
            fromDir: targetDir,
            fromModule: names.kebabCase,
            toDir: rel.relatedEntity.directory,
            toModule: rel.relatedEntity.kebabCase,
          });
      if (!oldMetaImportPaths.has(path)) {
        oldMetaImportPaths.set(path, []);
      }
      if (!oldMetaImportPaths.get(path)!.includes(rel.model)) {
        oldMetaImportPaths.get(path)!.push(rel.model);
      }
    }
  }

  // Regenerate combined import lines after adding MANY relationship imports
  importLines.length = 0;
  for (const [path, items] of oldMetaImportPaths.entries()) {
    importLines.push(`import { ${items.join(", ")} } from "${path}";`);
  }
  for (const [path, items] of newDescriptorImportPaths.entries()) {
    importLines.push(`import { ${items.join(", ")} } from "${path}";`);
  }

  const combinedMetaImportsCode = importLines.length > 0 ? `\n${importLines.join("\n")}\n` : "";

  // Build relationship DTO import
  const hasRelationshipDTOs = manyRelationships.length > 0;
  const relationshipDTOImport = hasRelationshipDTOs
    ? `import {
${manyRelationships
  .map((rel) => {
    const dtoKey = rel.dtoKey || rel.key;
    const pascalDtoKey = toPascalCase(dtoKey);
    return `  ${names.pascalCase}${pascalDtoKey}AddDTO,
  ${names.pascalCase}${pascalDtoKey}AddSingleDTO,
  ${names.pascalCase}${pascalDtoKey}RemoveDTO,`;
  })
  .join("\n")}
} from "src/${targetDir}/${names.kebabCase}/dtos/${names.kebabCase}.relationship.dto";
`
    : "";

  // Generate nested route methods using relationship handler
  const nestedRouteMethods = nestedRoutes
    .map(
      (route) => `
  @Get(\`${route.path}\`)
  async ${route.methodName}(
    @Res() reply: FastifyReply,
    @Param("${route.paramName}") ${route.paramName}: string,
    @Query() query: any,
    @Query("search") search?: string,
    @Query("fetchAll") fetchAll?: boolean,
    @Query("orderBy") orderBy?: string,
  ) {
    return this.relationships.findByRelated(reply, {
      relationship: ${names.pascalCase}Descriptor.relationshipKeys.${route.relationshipKey},
      id: ${route.paramName},
      query,
      search,
      fetchAll,
      orderBy,
    });
  }`
    )
    .join("\n");

  // Generate relationship add/remove endpoint methods for MANY relationships
  const relationshipEndpointMethods = manyRelationships
    .map((rel) => {
      const dtoKey = rel.dtoKey || rel.key;
      const pascalDtoKey = toPascalCase(dtoKey);
      const pascalKey = toPascalCase(rel.key);

      // Determine the endpoint accessor based on structure type
      const endpointAccessor = rel.isNewStructure
        ? `${rel.descriptorName}.model.endpoint`
        : `${rel.model}.endpoint`;

      // Check if relationship has edge property fields
      const hasFields = rel.fields && rel.fields.length > 0;

      return `
  // Batch add ${dtoKey}
  @Post(\`\${${names.camelCase}Meta.endpoint}/:${names.camelCase}Id/\${${endpointAccessor}}\`)
  async add${pascalDtoKey}(
    @Res() reply: FastifyReply,
    @Param("${names.camelCase}Id") ${names.camelCase}Id: string,
    @Body() body: ${names.pascalCase}${pascalDtoKey}AddDTO,
  ) {
    return this.relationships.addToRelationship(
      reply,
      ${names.camelCase}Id,
      ${names.pascalCase}Descriptor.relationshipKeys.${rel.key},
      body.data,
    );
  }

  // Batch remove ${dtoKey}
  @Delete(\`\${${names.camelCase}Meta.endpoint}/:${names.camelCase}Id/\${${endpointAccessor}}\`)
  async remove${pascalDtoKey}(
    @Res() reply: FastifyReply,
    @Param("${names.camelCase}Id") ${names.camelCase}Id: string,
    @Body() body: ${names.pascalCase}${pascalDtoKey}RemoveDTO,
  ) {
    return this.relationships.removeFromRelationship(
      reply,
      ${names.camelCase}Id,
      ${names.pascalCase}Descriptor.relationshipKeys.${rel.key},
      body.data,
    );
  }

  // Single add ${rel.key}
  @Post(\`\${${names.camelCase}Meta.endpoint}/:${names.camelCase}Id/\${${endpointAccessor}}/:${rel.key}Id\`)
  async add${pascalKey}(
    @Res() reply: FastifyReply,
    @Param("${names.camelCase}Id") ${names.camelCase}Id: string,
    @Param("${rel.key}Id") ${rel.key}Id: string,
    @Body() ${hasFields ? `body` : `_body`}: ${names.pascalCase}${pascalDtoKey}AddSingleDTO,
  ) {
    const response = await this.${names.camelCase}Service.addToRelationshipFromDTO({
      id: ${names.camelCase}Id,
      relationship: ${names.pascalCase}Descriptor.relationshipKeys.${rel.key},
      data: { id: ${rel.key}Id, type: ${endpointAccessor}${hasFields ? `, meta: body.data?.meta` : ``} },
    });
    reply.send(response);
  }

  // Single remove ${rel.key}
  @Delete(\`\${${names.camelCase}Meta.endpoint}/:${names.camelCase}Id/\${${endpointAccessor}}/:${rel.key}Id\`)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove${pascalKey}(
    @Res() reply: FastifyReply,
    @Param("${names.camelCase}Id") ${names.camelCase}Id: string,
    @Param("${rel.key}Id") ${rel.key}Id: string,
  ) {
    await this.${names.camelCase}Service.removeFromRelationshipFromDTO({
      id: ${names.camelCase}Id,
      relationship: ${names.pascalCase}Descriptor.relationshipKeys.${rel.key},
      data: [{ id: ${rel.key}Id, type: ${endpointAccessor} }],
    });
    reply.send();
  }`;
    })
    .join("\n");

  return `import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { FastifyReply } from "fastify";
import {
  Audit,
  AuditService,
  AuthenticatedRequest,
  CacheInvalidate,
  CacheService,
  createCrudHandlers,
  createRelationshipHandlers,
  JwtAuthGuard,
  ValidateId,
} from "@carlonicora/nestjs-neo4jsonapi";${combinedMetaImportsCode}
import { ${names.pascalCase}PostDTO } from "src/${targetDir}/${names.kebabCase}/dtos/${names.kebabCase}.post.dto";
import { ${names.pascalCase}PutDTO } from "src/${targetDir}/${names.kebabCase}/dtos/${names.kebabCase}.put.dto";
${relationshipDTOImport}
import { ${names.pascalCase}Descriptor } from "src/${targetDir}/${names.kebabCase}/entities/${names.kebabCase}";
import { ${names.camelCase}Meta } from "src/${targetDir}/${names.kebabCase}/entities/${names.kebabCase}.meta";
import { ${names.pascalCase}Service } from "src/${targetDir}/${names.kebabCase}/services/${names.kebabCase}.service";

@UseGuards(JwtAuthGuard)
@Controller()
export class ${names.pascalCase}Controller {
  private readonly crud = createCrudHandlers(() => this.${names.camelCase}Service);
  private readonly relationships = createRelationshipHandlers(() => this.${names.camelCase}Service);

  constructor(
    private readonly ${names.camelCase}Service: ${names.pascalCase}Service,
    private readonly cacheService: CacheService,
    private readonly auditService: AuditService,
  ) {}

  @Get(${names.camelCase}Meta.endpoint)
  async findAll(
    @Res() reply: FastifyReply,
    @Query() query: any,
    @Query("search") search?: string,
    @Query("fetchAll") fetchAll?: boolean,
    @Query("orderBy") orderBy?: string,
  ) {
    return this.crud.findAll(reply, { query, search, fetchAll, orderBy });
  }

  @Get(\`\${${names.camelCase}Meta.endpoint}/:${names.camelCase}Id\`)
  @Audit(${names.camelCase}Meta, "${names.camelCase}Id")
  async findById(
    @Req() request: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("${names.camelCase}Id") ${names.camelCase}Id: string,
  ) {
    return this.crud.findById(reply, ${names.camelCase}Id);
  }

  @Post(${names.camelCase}Meta.endpoint)
  @CacheInvalidate(${names.camelCase}Meta)
  async create(
    @Res() reply: FastifyReply,
    @Body() body: ${names.pascalCase}PostDTO,
  ) {
    return this.crud.create(reply, body);
  }

  @Put(\`\${${names.camelCase}Meta.endpoint}/:${names.camelCase}Id\`)
  @ValidateId("${names.camelCase}Id")
  @CacheInvalidate(${names.camelCase}Meta, "${names.camelCase}Id")
  async update(
    @Req() request: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Body() body: ${names.pascalCase}PutDTO,
  ) {
    return this.crud.update(reply, body);
  }

  @Delete(\`\${${names.camelCase}Meta.endpoint}/:${names.camelCase}Id\`)
  @HttpCode(HttpStatus.NO_CONTENT)
  @CacheInvalidate(${names.camelCase}Meta, "${names.camelCase}Id")
  async delete(
    @Req() request: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("${names.camelCase}Id") ${names.camelCase}Id: string,
  ) {
    return this.crud.delete(reply, ${names.camelCase}Id);
  }
${nestedRouteMethods}
${relationshipEndpointMethods}
}
`;
}
