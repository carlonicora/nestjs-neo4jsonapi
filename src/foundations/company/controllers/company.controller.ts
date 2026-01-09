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
    await this.companyService.delete({ companyId: companyId });
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
    @Body() body: { confirmation: string },
  ) {
    // Verify user belongs to this company
    if (request.user.companyId !== companyId) throw new HttpException("Unauthorised", 401);

    // Fetch company to verify confirmation
    const company = await this.companyService.findRaw({ companyId });
    if (body.confirmation !== company.name)
      throw new HttpException("Confirmation does not match company name", HttpStatus.BAD_REQUEST);

    // Delete company
    await this.companyService.delete({ companyId });
    reply.send();

    await this.cacheService.invalidateByElement(companyMeta.endpoint, companyId);
  }
}
