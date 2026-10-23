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

import { CacheInvalidate } from "../../../common/decorators/cache-invalidate.decorator";
import { AuthenticatedRequest } from "../../../common/interfaces/authenticated.request.interface";
import { CacheService } from "../../../core/cache/services/cache.service";
import { CompanyPostDTO } from "../../company/dtos/company.post.dto";
import { CompanyPutDTO } from "../../company/dtos/company.put.dto";
import { companyMeta } from "../../company/entities/company.meta";
import { CompanyService } from "../../company/services/company.service";
import { CompanyConfigurationsPutDTO } from "../dtos/company.configurations.put.dto";
import { ModuleACL } from "../../../common/decorators/module.decorator";
import { CoreModuleId } from "../../../common/constants/core-module.ids";

@ModuleACL({ module: CoreModuleId.Company })
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
  @CacheInvalidate(companyMeta)
  async create(@Req() request: AuthenticatedRequest, @Res() reply: FastifyReply, @Body() body: CompanyPostDTO) {
    const response = await this.companyService.createForController({ data: body.data });
    reply.send(response);
  }

  @UseGuards(JwtAuthGuard)
  @Roles(RoleId.Administrator, RoleId.CompanyAdministrator)
  @Put(`${companyMeta.endpoint}/:companyId`)
  @CacheInvalidate(companyMeta, "companyId")
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
  }

  @UseGuards(JwtAuthGuard)
  @Roles(RoleId.Administrator, RoleId.CompanyAdministrator)
  @Put(`${companyMeta.endpoint}/:companyId/configurations`)
  @CacheInvalidate(companyMeta, "companyId")
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
  }

  @UseGuards(JwtAuthGuard)
  @Roles(RoleId.Administrator)
  @Delete(`${companyMeta.endpoint}/:companyId`)
  @HttpCode(HttpStatus.NO_CONTENT)
  @CacheInvalidate(companyMeta, "companyId")
  async delete(
    @Req() request: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("companyId") companyId: string,
  ) {
    await this.companyService.deleteImmediate({ companyId });
    reply.send();
  }

  @UseGuards(JwtAuthGuard)
  @Roles(RoleId.CompanyAdministrator)
  @Delete(`${companyMeta.endpoint}/:companyId/self-delete`)
  @HttpCode(HttpStatus.NO_CONTENT)
  @CacheInvalidate(companyMeta, "companyId")
  async selfDelete(
    @Req() request: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("companyId") companyId: string,
  ) {
    // Verify user belongs to this company
    if (request.user.companyId !== companyId) {
      throw new HttpException("Unauthorised", 401);
    }

    // Fetch company for audit logging
    const company = await this.companyService.findRaw({ companyId });

    // Delete company using immediate full deletion
    await this.companyService.deleteImmediate({ companyId, companyName: company.name });
    reply.send();
  }
}
