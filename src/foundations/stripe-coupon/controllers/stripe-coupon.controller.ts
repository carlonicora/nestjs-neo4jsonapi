import { Body, Controller, Get, HttpStatus, Param, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { FastifyReply } from "fastify";
import { CoreModuleId } from "../../../common/constants/core-module.ids";
import { RoleId } from "../../../common/constants/system.roles";
import { Audit } from "../../../common/decorators/audit.decorator";
import { CacheInvalidate } from "../../../common/decorators/cache-invalidate.decorator";
import { ModuleACL } from "../../../common/decorators/module.decorator";
import { Roles } from "../../../common/decorators/roles.decorator";
import { ValidateId } from "../../../common/decorators/validate-id.decorator";
import { AdminJwtAuthGuard } from "../../../common/guards/jwt.auth.admin.guard";
import { AuthenticatedRequest } from "../../../common/interfaces/authenticated.request.interface";
import { createCrudHandlers } from "../../../common/handlers/crud.handlers";
import { CacheService } from "../../../core/cache/services/cache.service";
import { AuditService } from "../../audit/services/audit.service";
import { StripeCouponPatchDTO } from "../dtos/stripe-coupon.patch.dto";
import { StripeCouponPostDTO } from "../dtos/stripe-coupon.post.dto";
import { STRIPE_COUPON_REFRESH_SEGMENT, stripeCouponMeta } from "../entities/stripe-coupon.meta";
import { stripeCouponCodeMeta } from "../entities/stripe-coupon-code.meta";
import { StripeCouponService } from "../services/stripe-coupon.service";

/**
 * StripeCouponController
 *
 * Administrative API for coupons: list, read, create (with the first code),
 * rename and refresh the redemption counts from Stripe.
 */
@UseGuards(AdminJwtAuthGuard)
@ModuleACL({ module: CoreModuleId.Billing })
@Controller()
export class StripeCouponController {
  private readonly crud = createCrudHandlers(() => this.stripeCouponService);

  constructor(
    private readonly stripeCouponService: StripeCouponService,
    private readonly cacheService: CacheService,
    private readonly auditService: AuditService,
  ) {}

  @Get(stripeCouponMeta.endpoint)
  @Roles(RoleId.Administrator)
  async findAll(
    @Res() reply: FastifyReply,
    @Query() query: any,
    @Query("search") search?: string,
    @Query("fetchAll") fetchAll?: boolean,
    @Query("orderBy") orderBy?: string,
  ) {
    return this.crud.findAll(reply, { query, search, fetchAll, orderBy });
  }

  @Get(`${stripeCouponMeta.endpoint}/:couponId`)
  @Roles(RoleId.Administrator)
  @Audit(stripeCouponMeta, "couponId")
  async findById(@Res() reply: FastifyReply, @Param("couponId") couponId: string) {
    return this.crud.findById(reply, couponId);
  }

  @Post(stripeCouponMeta.endpoint)
  @Roles(RoleId.Administrator)
  @CacheInvalidate(stripeCouponMeta)
  async create(@Res() reply: FastifyReply, @Body() body: StripeCouponPostDTO) {
    const response = await this.stripeCouponService.createWithFirstCode({ data: body.data });

    reply.status(HttpStatus.CREATED).send(response);
  }

  @Patch(`${stripeCouponMeta.endpoint}/:couponId`)
  @Roles(RoleId.Administrator)
  @ValidateId("couponId")
  @CacheInvalidate(stripeCouponMeta, "couponId")
  async rename(
    // The request carries the route params @ValidateId and @CacheInvalidate read
    @Req() _req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Body() body: StripeCouponPatchDTO,
  ) {
    const response = await this.stripeCouponService.rename({ data: body.data });

    reply.send(response);
  }

  @Post(`${stripeCouponMeta.endpoint}/:couponId/${STRIPE_COUPON_REFRESH_SEGMENT}`)
  @Roles(RoleId.Administrator)
  @CacheInvalidate(stripeCouponMeta, "couponId")
  async refreshCounts(
    // The request carries the route params @CacheInvalidate reads
    @Req() _req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("couponId") couponId: string,
  ) {
    const response = await this.stripeCouponService.refreshCounts({ id: couponId });

    // Every code of the coupon got new counts too
    await this.cacheService.invalidateByType(stripeCouponCodeMeta.endpoint);

    reply.send(response);
  }
}
