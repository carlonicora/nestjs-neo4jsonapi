import { Controller, Get, Param, Query, Req, Res, UseGuards } from "@nestjs/common";
import { FastifyReply } from "fastify";
import { JwtAuthGuard } from "../../../common/guards";
import { AuthenticatedRequest } from "../../../common/interfaces/authenticated.request.interface";
import { StripeInvoiceStatus } from "../entities/stripe-invoice.entity";
import { stripeInvoiceMeta } from "../entities/stripe-invoice.meta";
import { StripeInvoiceAdminService } from "../services/stripe-invoice-admin.service";

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
