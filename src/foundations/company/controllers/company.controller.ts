import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
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
import { RoleId } from "../../../common/constants/system.roles";
import { Roles } from "../../../common/decorators/roles.decorator";
import { AdminJwtAuthGuard } from "../../../common/guards/jwt.auth.admin.guard";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";

import { AuthenticatedRequest } from "../../../common/interfaces/authenticated.request.interface";
import { CacheService } from "../../../core/cache/services/cache.service";
import { CompanyPostDTO } from "../../company/dtos/company.post.dto";
import { CompanyPutDTO } from "../../company/dtos/company.put.dto";
import { companyMeta } from "../../company/entities/company.meta";
import { CompanyService } from "../../company/services/company.service";
import { CompanyConfigurationsPutDTO } from "../dtos/company.configurations.put.dto";

@Controller()
export class CompanyController {
  constructor(
    private readonly companyService: CompanyService,
    private readonly cacheService: CacheService,
  ) {}

  @UseGuards(AdminJwtAuthGuard)
  @Roles(RoleId.Administrator)
  @Get(companyMeta.endpoint)
  async fetchAllCompanies(
    @Req() request: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Query() query: any,
    @Query("search") search?: string,
  ) {
    const response = await this.companyService.find({ term: search, query: query });
    reply.send(response);
  }

  @UseGuards(JwtAuthGuard)
  @Get(`${companyMeta.endpoint}/:companyId`)
  async findCompany(
    @Req() request: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("companyId") companyId: string,
  ) {
    if (request.user.companyId !== companyId && !request.user.roles.includes(RoleId.Administrator))
      throw new HttpException("Unauthorised", 401);

    const response = await this.companyService.findOne({ companyId: companyId });
    reply.send(response);
  }

  @UseGuards(AdminJwtAuthGuard)
  @Roles(RoleId.Administrator)
  @Post(companyMeta.endpoint)
  async create(@Req() request: AuthenticatedRequest, @Res() reply: FastifyReply, @Body() body: CompanyPostDTO) {
    const response = await this.companyService.createForController({ data: body.data });
    reply.send(response);

    await this.cacheService.invalidateByType(companyMeta.endpoint);
  }

  @UseGuards(JwtAuthGuard)
  @Roles(RoleId.Administrator, RoleId.CompanyAdministrator)
  @Put(`${companyMeta.endpoint}/:companyId`)
  async update(
    @Req() request: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Body() body: CompanyPutDTO,
    @Param("companyId") companyId: string,
  ) {
    if (request.user.companyId !== companyId && !request.user.roles.includes(RoleId.Administrator))
      throw new HttpException("Unauthorised", 401);

    if (companyId !== body.data.id)
      throw new HttpException("Company Id does not match the {json:api} id", HttpStatus.PRECONDITION_FAILED);

    const response = await this.companyService.update({ data: body.data });
    reply.send(response);

    await this.cacheService.invalidateByElement(companyMeta.endpoint, companyId);
  }

  @UseGuards(JwtAuthGuard)
  @Roles(RoleId.Administrator, RoleId.CompanyAdministrator)
  @Put(`${companyMeta.endpoint}/:companyId/configurations`)
  async updateConfigurations(
    @Req() request: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Body() body: CompanyConfigurationsPutDTO,
    @Param("companyId") companyId: string,
  ) {
    if (request.user.companyId !== companyId && !request.user.roles.includes(RoleId.Administrator))
      throw new HttpException("Unauthorised", 401);

    if (companyId !== body.data.id)
      throw new HttpException("Company Id does not match the {json:api} id", HttpStatus.PRECONDITION_FAILED);

    const response = await this.companyService.updateConfigurations({ data: body.data });
    reply.send(response);

    await this.cacheService.invalidateByElement(companyMeta.endpoint, companyId);
  }

  @UseGuards(JwtAuthGuard)
  @Roles(RoleId.Administrator)
  @Delete(`${companyMeta.endpoint}/:companyId`)
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @Req() request: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("companyId") companyId: string,
  ) {
    await this.companyService.deleteImmediate({ companyId });
    reply.send();

    await this.cacheService.invalidateByElement(companyMeta.endpoint, companyId);
  }

  @UseGuards(JwtAuthGuard)
  @Roles(RoleId.CompanyAdministrator)
  @Delete(`${companyMeta.endpoint}/:companyId/self-delete`)
  @HttpCode(HttpStatus.NO_CONTENT)
  async selfDelete(
    @Req() request: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("companyId") companyId: string,
  ) {
    console.log("[CompanyController.selfDelete] Endpoint called");
    console.log("[CompanyController.selfDelete] companyId from URL:", companyId);
    console.log("[CompanyController.selfDelete] User info:", {
      userId: request.user.userId,
      userCompanyId: request.user.companyId,
      userRoles: request.user.roles,
    });

    // Verify user belongs to this company
    if (request.user.companyId !== companyId) {
      console.error("[CompanyController.selfDelete] UNAUTHORIZED: User companyId mismatch");
      console.error("[CompanyController.selfDelete] User companyId:", request.user.companyId);
      console.error("[CompanyController.selfDelete] Requested companyId:", companyId);
      throw new HttpException("Unauthorised", 401);
    }
    console.log("[CompanyController.selfDelete] Company ownership verified");

    // Fetch company for audit logging
    console.log("[CompanyController.selfDelete] Fetching company from database...");
    const company = await this.companyService.findRaw({ companyId });
    console.log("[CompanyController.selfDelete] Company found:", {
      id: company.id,
      name: company.name,
    });

    // Delete company using immediate full deletion
    console.log("[CompanyController.selfDelete] Starting deleteImmediate...");
    await this.companyService.deleteImmediate({ companyId, companyName: company.name });
    console.log("[CompanyController.selfDelete] deleteImmediate completed successfully");
    reply.send();

    console.log("[CompanyController.selfDelete] Invalidating cache...");
    await this.cacheService.invalidateByElement(companyMeta.endpoint, companyId);
    console.log("[CompanyController.selfDelete] Cache invalidated, operation complete");
  }
}
