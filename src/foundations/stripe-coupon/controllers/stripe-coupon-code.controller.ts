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
import { createRelationshipHandlers } from "../../../common/handlers/relationship.handlers";
import { CacheService } from "../../../core/cache/services/cache.service";
import { AuditService } from "../../audit/services/audit.service";
import { StripeCouponCodePatchDTO } from "../dtos/stripe-coupon-code.patch.dto";
import { StripeCouponCodePostDTO } from "../dtos/stripe-coupon-code.post.dto";
import { StripeCouponCodeDescriptor } from "../entities/stripe-coupon-code";
import { stripeCouponCodeMeta } from "../entities/stripe-coupon-code.meta";
import { stripeCouponMeta } from "../entities/stripe-coupon.meta";
import { StripeCouponCodeService } from "../services/stripe-coupon-code.service";

/**
 * StripeCouponCodeController
 *
 * Administrative API for a coupon's customer-facing codes: list a coupon's
 * codes, read one, add one, switch active / "Apply automatically".
 * The checkout lookup (`stripe-coupon-codes/automatic`) lives in its own
 * controller, registered before this one so it wins over `:codeId`.
 */
@UseGuards(AdminJwtAuthGuard)
@ModuleACL({ module: CoreModuleId.Billing })
@Controller()
export class StripeCouponCodeController {
  private readonly crud = createCrudHandlers(() => this.stripeCouponCodeService);
  private readonly relationships = createRelationshipHandlers(() => this.stripeCouponCodeService);

  constructor(
    private readonly stripeCouponCodeService: StripeCouponCodeService,
    private readonly cacheService: CacheService,
    private readonly auditService: AuditService,
  ) {}

  @Get(`${stripeCouponMeta.endpoint}/:couponId/${stripeCouponCodeMeta.endpoint}`)
  @Roles(RoleId.Administrator)
  async findByCoupon(
    @Res() reply: FastifyReply,
    @Param("couponId") couponId: string,
    @Query() query: any,
    @Query("search") search?: string,
    @Query("fetchAll") fetchAll?: boolean,
  ) {
    return this.relationships.findByRelated(reply, {
      relationship: StripeCouponCodeDescriptor.relationshipKeys.coupon,
      id: couponId,
      query,
      search,
      fetchAll,
      orderBy: "createdAt",
    });
  }

  @Get(`${stripeCouponCodeMeta.endpoint}/:codeId`)
  @Roles(RoleId.Administrator)
  @Audit(stripeCouponCodeMeta, "codeId")
  async findById(@Res() reply: FastifyReply, @Param("codeId") codeId: string) {
    return this.crud.findById(reply, codeId);
  }

  @Post(stripeCouponCodeMeta.endpoint)
  @Roles(RoleId.Administrator)
  @CacheInvalidate(stripeCouponCodeMeta)
  async create(@Res() reply: FastifyReply, @Body() body: StripeCouponCodePostDTO) {
    const response = await this.stripeCouponCodeService.createForCoupon({ data: body.data });

    // The parent coupon's codes changed with the new code
    await this.cacheService.invalidateByElement(stripeCouponMeta.endpoint, body.data.relationships.coupon.data.id);

    reply.status(HttpStatus.CREATED).send(response);
  }

  @Patch(`${stripeCouponCodeMeta.endpoint}/:codeId`)
  @Roles(RoleId.Administrator)
  @ValidateId("codeId")
  @CacheInvalidate(stripeCouponCodeMeta, "codeId")
  async updateFlags(
    // The request carries the route params @ValidateId and @CacheInvalidate read
    @Req() _req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("codeId") codeId: string,
    @Body() body: StripeCouponCodePatchDTO,
  ) {
    const response = await this.stripeCouponCodeService.updateFlags({ data: body.data });

    // "Apply automatically" clears every other code, so every cached code entry is stale
    if (body.data.attributes.automatic !== undefined)
      await this.cacheService.invalidateByType(stripeCouponCodeMeta.endpoint);

    // The parent coupon's codes changed with the new flags
    const couponId = await this.stripeCouponCodeService.findCouponId({ codeId });
    if (couponId) await this.cacheService.invalidateByElement(stripeCouponMeta.endpoint, couponId);

    reply.send(response);
  }
}
