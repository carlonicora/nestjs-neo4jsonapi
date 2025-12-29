import {
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
  Res,
  UseGuards,
} from "@nestjs/common";
import { FastifyReply } from "fastify";
import { Roles, AdminJwtAuthGuard, RoleId } from "@carlonicora/nestjs-neo4jsonapi";
import { CreatePriceDTO, UpdatePriceDTO } from "../dtos/create-price.dto";
import { CreateProductDTO, UpdateProductDTO } from "../dtos/create-product.dto";
import { BillingAdminService } from "../services/billing-admin.service";

@UseGuards(AdminJwtAuthGuard)
@Roles(RoleId.Administrator)
@Controller("billing/admin")
export class BillingAdminController {
  constructor(private readonly billingAdminService: BillingAdminService) {}

  // Products

  @Get("products")
  async listProducts(@Res() reply: FastifyReply, @Query() query: any, @Query("active") active?: string) {
    const response = await this.billingAdminService.listProducts({
      query,
      active: active !== undefined ? active === "true" : undefined,
    });

    reply.send(response);
  }

  @Get("products/:productId")
  async getProduct(@Res() reply: FastifyReply, @Param("productId") productId: string) {
    const response = await this.billingAdminService.getProduct({ id: productId });
    reply.send(response);
  }

  @Post("products")
  async createProduct(@Res() reply: FastifyReply, @Body() body: CreateProductDTO) {
    const response = await this.billingAdminService.createProduct({
      name: body.name,
      description: body.description,
      metadata: body.metadata,
    });

    reply.status(HttpStatus.CREATED).send(response);
  }

  @Put("products/:productId")
  async updateProduct(
    @Res() reply: FastifyReply,
    @Param("productId") productId: string,
    @Body() body: UpdateProductDTO,
  ) {
    const response = await this.billingAdminService.updateProduct({
      id: productId,
      name: body.name,
      description: body.description,
      metadata: body.metadata,
    });

    reply.send(response);
  }

  @Delete("products/:productId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async archiveProduct(@Res() reply: FastifyReply, @Param("productId") productId: string) {
    await this.billingAdminService.archiveProduct({ id: productId });
    reply.send();
  }

  // Prices

  @Get("prices")
  async listPrices(
    @Res() reply: FastifyReply,
    @Query() query: any,
    @Query("productId") productId?: string,
    @Query("active") active?: string,
  ) {
    const response = await this.billingAdminService.listPrices({
      query,
      productId,
      active: active !== undefined ? active === "true" : undefined,
    });

    reply.send(response);
  }

  @Get("prices/:priceId")
  async getPrice(@Res() reply: FastifyReply, @Param("priceId") priceId: string) {
    const response = await this.billingAdminService.getPrice({ id: priceId });
    reply.send(response);
  }

  @Post("prices")
  async createPrice(@Res() reply: FastifyReply, @Body() body: CreatePriceDTO) {
    const response = await this.billingAdminService.createPrice({
      productId: body.productId,
      unitAmount: body.unitAmount,
      currency: body.currency,
      nickname: body.nickname,
      lookupKey: body.lookupKey,
      recurring: body.recurring,
      metadata: body.metadata,
    });

    reply.status(HttpStatus.CREATED).send(response);
  }

  @Put("prices/:priceId")
  async updatePrice(@Res() reply: FastifyReply, @Param("priceId") priceId: string, @Body() body: UpdatePriceDTO) {
    const response = await this.billingAdminService.updatePrice({
      id: priceId,
      nickname: body.nickname,
      metadata: body.metadata,
    });

    reply.send(response);
  }
}
