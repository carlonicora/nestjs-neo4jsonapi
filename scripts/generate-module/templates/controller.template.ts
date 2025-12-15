import { TemplateData } from "../types/template-data.interface";

/**
 * Generate controller file content with CRUD and nested routes
 *
 * @param data - Template data
 * @returns Generated TypeScript code
 */
export function generateControllerFile(data: TemplateData): string {
  const { names, targetDir, nestedRoutes } = data;

  // Build meta imports for nested routes
  const metaImportPaths = new Map<string, string[]>();
  for (const route of nestedRoutes) {
    const rel = data.relationships.find((r) => r.model === route.relatedMeta)!;
    const path = `../../${rel.relatedEntity.directory}/${rel.relatedEntity.kebabCase}/entities/${rel.relatedEntity.kebabCase}.meta`;
    if (!metaImportPaths.has(path)) {
      metaImportPaths.set(path, []);
    }
    metaImportPaths.get(path)!.push(route.relatedMeta);
  }

  const metaImportsCode =
    metaImportPaths.size > 0
      ? `\n${Array.from(metaImportPaths.entries())
          .map(([path, items]) => `import { ${items.join(", ")} } from "${path}";`)
          .join("\n")}\n`
      : "";

  // Generate nested route methods
  const nestedRouteMethods = nestedRoutes
    .map(
      (route) => `
  @Get(\`\${${route.relatedMeta}.endpoint}/:\${${route.paramName}}/\${${names.pascalCase}Descriptor.model.endpoint}\`)
  async ${route.methodName}(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("${route.paramName}") ${route.paramName}: string,
    @Query() query: any,
    @Query("search") search?: string,
    @Query("fetchAll") fetchAll?: boolean,
    @Query("orderBy") orderBy?: string,
  ) {
    const response = await this.${names.camelCase}Service.findByRelated({
      relationship: ${names.pascalCase}Descriptor.relationshipKeys.${route.relationshipKey},
      id: ${route.paramName},
      term: search,
      query: query,
      fetchAll: fetchAll,
      orderBy: orderBy,
    });

    reply.send(response);
  }`
    )
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
  PreconditionFailedException,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { FastifyReply } from "fastify";
import {
  AuditService,
  AuthenticatedRequest,
  CacheService,
  JsonApiDTOData,
  JwtAuthGuard,
} from "@carlonicora/nestjs-neo4jsonapi";${metaImportsCode}
import { ${names.pascalCase}PostDTO } from "src/${targetDir}/${names.kebabCase}/dtos/${names.kebabCase}.post.dto";
import { ${names.pascalCase}PutDTO } from "src/${targetDir}/${names.kebabCase}/dtos/${names.kebabCase}.put.dto";
import { ${names.pascalCase}Descriptor } from "src/${targetDir}/${names.kebabCase}/entities/${names.kebabCase}";
import { ${names.pascalCase}Service } from "src/${targetDir}/${names.kebabCase}/services/${names.kebabCase}.service";

@UseGuards(JwtAuthGuard)
@Controller()
export class ${names.pascalCase}Controller {
  constructor(
    private readonly ${names.camelCase}Service: ${names.pascalCase}Service,
    private readonly cacheService: CacheService,
    private readonly auditService: AuditService,
  ) {}

  @Get(${names.pascalCase}Descriptor.model.endpoint)
  async findAll(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Query() query: any,
    @Query("search") search?: string,
    @Query("fetchAll") fetchAll?: boolean,
    @Query("orderBy") orderBy?: string,
  ) {
    const response = await this.${names.camelCase}Service.find({
      term: search,
      query: query,
      fetchAll: fetchAll,
      orderBy: orderBy,
    });

    reply.send(response);
  }

  @Get(\`\${${names.pascalCase}Descriptor.model.endpoint}/:${names.camelCase}Id\`)
  async findById(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("${names.camelCase}Id") ${names.camelCase}Id: string,
  ) {
    const response = await this.${names.camelCase}Service.findById({
      id: ${names.camelCase}Id,
    });

    reply.send(response);

    this.auditService.createAuditEntry({
      entityType: ${names.pascalCase}Descriptor.model.labelName,
      entityId: ${names.camelCase}Id,
    });
  }

  @Post(${names.pascalCase}Descriptor.model.endpoint)
  async create(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Body() body: ${names.pascalCase}PostDTO,
  ) {
    const response = await this.${names.camelCase}Service.createFromDTO({
      data: body.data as unknown as JsonApiDTOData,
    });

    reply.send(response);

    await this.cacheService.invalidateByType(${names.pascalCase}Descriptor.model.endpoint);
  }

  @Put(\`\${${names.pascalCase}Descriptor.model.endpoint}/:${names.camelCase}Id\`)
  async update(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("${names.camelCase}Id") ${names.camelCase}Id: string,
    @Body() body: ${names.pascalCase}PutDTO,
  ) {
    if (${names.camelCase}Id !== body.data.id)
      throw new PreconditionFailedException("ID in URL does not match ID in body");

    const response = await this.${names.camelCase}Service.putFromDTO({
      data: body.data as unknown as JsonApiDTOData,
    });

    reply.send(response);

    await this.cacheService.invalidateByElement(${names.pascalCase}Descriptor.model.endpoint, body.data.id);
  }

  @Delete(\`\${${names.pascalCase}Descriptor.model.endpoint}/:${names.camelCase}Id\`)
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("${names.camelCase}Id") ${names.camelCase}Id: string,
  ) {
    await this.${names.camelCase}Service.delete({ id: ${names.camelCase}Id });
    reply.send();

    await this.cacheService.invalidateByElement(${names.pascalCase}Descriptor.model.endpoint, ${names.camelCase}Id);
  }
${nestedRouteMethods}
}
`;
}
