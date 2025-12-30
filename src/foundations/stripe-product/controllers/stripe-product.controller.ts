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
import { RoleId } from "../../../common/constants/system.roles";
import { Roles } from "../../../common/decorators";
import { AdminJwtAuthGuard, JwtAuthGuard } from "../../../common/guards";
import { StripeProductPostDTO, StripeProductPutDTO } from "../dtos/stripe-product.dto";
import { stripeProductMeta } from "../entities/stripe-product.meta";
import { StripeProductAdminService } from "../services/stripe-product-admin.service";

/**
 * StripeProductController
 *
 * Administrative REST API controller for managing Stripe products.
 * All endpoints require administrator authentication.
 *
 * Provides CRUD operations for products:
 * - List products with optional active filter
 * - Get individual product by ID
 * - Create new products (creates both Stripe product and local DB record)
 * - Update existing products (updates both Stripe and local DB)
 * - Archive products (sets active=false in both systems)
 *
 * All responses follow JSON:API specification format.
 *
 * @example
 * ```
 * GET /billing/products?active=true
 * GET /billing/products/:id
 * POST /billing/products
 * PUT /billing/products/:id
 * POST /billing/products/:id/archive
 * ```
 */
@Controller()
export class StripeProductController {
  constructor(private readonly stripeProductAdminService: StripeProductAdminService) {}

  // Admin: Product endpoints

  @Get(stripeProductMeta.endpoint)
  @UseGuards(JwtAuthGuard)
  @Roles(RoleId.Administrator, RoleId.CompanyAdministrator)
  async listProducts(@Res() reply: FastifyReply, @Query() query: any, @Query("active") active?: string) {
    const response = await this.stripeProductAdminService.listProducts({
      query,
      active: active !== undefined ? active === "true" : undefined,
    });

    reply.send(response);
  }

  @Get(`${stripeProductMeta.endpoint}/:id`)
  @UseGuards(JwtAuthGuard)
  @Roles(RoleId.Administrator, RoleId.CompanyAdministrator)
  async getProduct(@Res() reply: FastifyReply, @Param("id") id: string) {
    const response = await this.stripeProductAdminService.getProduct({ id });
    reply.send(response);
  }

  @Post(stripeProductMeta.endpoint)
  @UseGuards(AdminJwtAuthGuard)
  @Roles(RoleId.Administrator)
  async createProduct(@Res() reply: FastifyReply, @Body() body: StripeProductPostDTO) {
    const response = await this.stripeProductAdminService.createProduct(body);

    reply.status(HttpStatus.CREATED).send(response);
  }

  @Put(`${stripeProductMeta.endpoint}/:id`)
  @UseGuards(AdminJwtAuthGuard)
  @Roles(RoleId.Administrator)
  async updateProduct(@Res() reply: FastifyReply, @Param("id") id: string, @Body() body: StripeProductPutDTO) {
    // JSONAPI validation: URL ID must match body ID
    if (id !== body.data.id) {
      reply.status(HttpStatus.PRECONDITION_FAILED).send({
        error: "Product id does not match the {json:api} id",
      });
      return;
    }

    const response = await this.stripeProductAdminService.updateProduct(body);

    reply.send(response);
  }

  @Post(`${stripeProductMeta.endpoint}/:id/archive`)
  @UseGuards(AdminJwtAuthGuard)
  @Roles(RoleId.Administrator)
  @HttpCode(HttpStatus.NO_CONTENT)
  async archiveProduct(@Res() reply: FastifyReply, @Param("id") id: string) {
    await this.stripeProductAdminService.archiveProduct({ id });
    reply.send();
  }

  @Delete(`${stripeProductMeta.endpoint}/:id/archive`)
  @UseGuards(AdminJwtAuthGuard)
  @Roles(RoleId.Administrator)
  @HttpCode(HttpStatus.NO_CONTENT)
  async reactivateProduct(@Res() reply: FastifyReply, @Param("id") id: string) {
    await this.stripeProductAdminService.reactivateProduct({ id });
    reply.send();
  }
}
