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
import { AdminJwtAuthGuard } from "../../../common/guards";
import { StripePricePostDTO, StripePricePutDTO } from "../dtos/stripe-price.dto";
import { stripePriceMeta } from "../entities/stripe-price.meta";
import { StripePriceAdminService } from "../services/stripe-price-admin.service";

/**
 * StripePriceController
 *
 * REST API controller for Stripe price management.
 * Provides admin endpoints for CRUD operations on prices.
 *
 * All endpoints require admin authentication.
 */
@Controller()
export class StripePriceController {
  constructor(private readonly stripePriceAdminService: StripePriceAdminService) {}

  /**
   * List all prices
   *
   * GET /billing/prices
   *
   * Query parameters:
   * - productId: Filter by product ID
   * - active: Filter by active status (true/false)
   *
   * Requires: Admin authentication
   */
  @Get(stripePriceMeta.endpoint)
  @UseGuards(AdminJwtAuthGuard)
  @Roles(RoleId.Administrator)
  async listPrices(
    @Res() reply: FastifyReply,
    @Query() query: any,
    @Query("productId") productId?: string,
    @Query("active") active?: string,
  ) {
    const response = await this.stripePriceAdminService.listPrices({
      query,
      productId,
      active: active !== undefined ? active === "true" : undefined,
    });

    reply.send(response);
  }

  /**
   * Get single price by ID
   *
   * GET /billing/prices/:id
   *
   * Requires: Admin authentication
   */
  @Get(`${stripePriceMeta.endpoint}/:id`)
  @UseGuards(AdminJwtAuthGuard)
  @Roles(RoleId.Administrator)
  async getPrice(@Res() reply: FastifyReply, @Param("id") id: string) {
    const response = await this.stripePriceAdminService.getPrice({ id });
    reply.send(response);
  }

  /**
   * Create new price
   *
   * POST /billing/prices
   *
   * Requires: Admin authentication
   */
  @Post(stripePriceMeta.endpoint)
  @UseGuards(AdminJwtAuthGuard)
  @Roles(RoleId.Administrator)
  async createPrice(@Res() reply: FastifyReply, @Body() body: StripePricePostDTO) {
    const response = await this.stripePriceAdminService.createPrice(body);
    reply.status(HttpStatus.CREATED).send(response);
  }

  /**
   * Update existing price
   *
   * PUT /billing/prices/:id
   *
   * Note: Only nickname and metadata can be updated (Stripe limitation)
   *
   * Requires: Admin authentication
   */
  @Put(`${stripePriceMeta.endpoint}/:id`)
  @UseGuards(AdminJwtAuthGuard)
  @Roles(RoleId.Administrator)
  async updatePrice(@Res() reply: FastifyReply, @Param("id") id: string, @Body() body: StripePricePutDTO) {
    // JSONAPI validation: URL ID must match body ID
    if (id !== body.data.id) {
      reply.status(HttpStatus.PRECONDITION_FAILED).send({
        error: "Price id does not match the {json:api} id",
      });
      return;
    }

    const response = await this.stripePriceAdminService.updatePrice(body);
    reply.send(response);
  }

  /**
   * Archive price
   *
   * POST /billing/prices/:id/archive
   *
   * Sets the price as inactive in both Stripe and the local database.
   * Archived prices cannot be used for new subscriptions.
   *
   * Requires: Admin authentication
   */
  @Post(`${stripePriceMeta.endpoint}/:id/archive`)
  @UseGuards(AdminJwtAuthGuard)
  @Roles(RoleId.Administrator)
  @HttpCode(HttpStatus.NO_CONTENT)
  async archivePrice(@Res() reply: FastifyReply, @Param("id") id: string) {
    await this.stripePriceAdminService.archivePrice({ id });
    reply.send();
  }

  /**
   * Reactivate price
   *
   * DELETE /billing/prices/:id/archive
   *
   * Sets the price as active in both Stripe and the local database.
   * Active prices can be used for new subscriptions.
   *
   * Requires: Admin authentication
   */
  @Delete(`${stripePriceMeta.endpoint}/:id/archive`)
  @UseGuards(AdminJwtAuthGuard)
  @Roles(RoleId.Administrator)
  @HttpCode(HttpStatus.NO_CONTENT)
  async reactivatePrice(@Res() reply: FastifyReply, @Param("id") id: string) {
    await this.stripePriceAdminService.reactivatePrice({ id });
    reply.send();
  }
}
