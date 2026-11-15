import { Controller, Get, Param, Query, Req, Res, UseGuards } from "@nestjs/common";
import { FastifyReply } from "fastify";
import { RoleId } from "../../../common/constants/system.roles";
import { Roles } from "../../../common/decorators/roles.decorator";
import { JwtAuthGuard } from "../../../common/guards";
import { AdminJwtAuthGuard } from "../../../common/guards/jwt.auth.admin.guard";
import { AuthenticatedRequest } from "../../../common/interfaces/authenticated.request.interface";
import { NoCache } from "../../../core/cache/interceptors/cache.interceptor";
import { companyMeta } from "../../company/entities/company.meta";
import { StripeInvoiceStatus } from "../entities/stripe-invoice.entity";
import { stripeInvoiceMeta } from "../entities/stripe-invoice.meta";
import { StripeInvoiceAdminService } from "../services/stripe-invoice-admin.service";
import { ModuleACL } from "../../../common/decorators/module.decorator";
import { CoreModuleId } from "../../../common/constants/core-module.ids";

@ModuleACL({ module: CoreModuleId.Billing })
@Controller()
export class StripeInvoiceController {
  constructor(private readonly stripeInvoiceAdminService: StripeInvoiceAdminService) {}

  /**
   * List invoices for the authenticated user's company
   *
   * @param req - Authenticated request
   * @param reply - Fastify reply
   * @param query - JSON:API query parameters for pagination
   * @param status - Optional filter by invoice status
   */
  @Get(stripeInvoiceMeta.endpoint)
  @UseGuards(JwtAuthGuard)
  async listInvoices(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Query() query: any,
    @Query("status") status?: StripeInvoiceStatus,
  ) {
    const response = await this.stripeInvoiceAdminService.listInvoices({
      companyId: req.user.companyId,
      query,
      status,
    });

    reply.send(response);
  }

  /**
   * List every non-draft invoice of a company, for the platform administrator (WYR-98).
   * The company comes from the URL: the administrator belongs to no company.
   *
   * @param reply - Fastify reply
   * @param companyId - Company id
   * @param query - JSON:API query parameters
   */
  @Get(`${companyMeta.endpoint}/:companyId/${stripeInvoiceMeta.endpoint}`)
  @UseGuards(AdminJwtAuthGuard)
  @Roles(RoleId.Administrator)
  @NoCache()
  async listForCompanyAdmin(@Res() reply: FastifyReply, @Param("companyId") companyId: string, @Query() query: any) {
    const response = await this.stripeInvoiceAdminService.listForCompanyAdmin({ companyId, query });

    reply.send(response);
  }

  /**
   * Get the upcoming invoice preview for the authenticated user's company
   *
   * @param req - Authenticated request
   * @param reply - Fastify reply
   * @param subscriptionId - Optional subscription ID to preview
   */
  @Get(`${stripeInvoiceMeta.endpoint}/upcoming`)
  @UseGuards(JwtAuthGuard)
  async getUpcomingInvoice(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Query("subscriptionId") subscriptionId?: string,
  ) {
    const response = await this.stripeInvoiceAdminService.getUpcomingInvoice({
      companyId: req.user.companyId,
      subscriptionId,
    });

    reply.send(response);
  }

  /**
   * Get a single invoice by ID
   *
   * @param req - Authenticated request
   * @param reply - Fastify reply
   * @param invoiceId - Invoice ID
   */
  @Get(`${stripeInvoiceMeta.endpoint}/:invoiceId`)
  @UseGuards(JwtAuthGuard)
  async getInvoice(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("invoiceId") invoiceId: string,
  ) {
    const response = await this.stripeInvoiceAdminService.getInvoice({
      id: invoiceId,
      companyId: req.user.companyId,
    });

    reply.send(response);
  }
}
