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
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { FastifyReply } from "fastify";
import { JwtAuthGuard } from "../../../common/guards";
import { AuthenticatedRequest } from "../../../common/interfaces/authenticated.request.interface";
import { JsonApiService } from "../../../core/jsonapi";
import { StripeCustomerPostDTO, StripeCustomerPutDTO } from "../dtos/stripe-customer.dto";
import { StripePaymentMethodModel } from "../entities/stripe-payment-method.model";
import { StripeCustomerRepository } from "../repositories/stripe-customer.repository";
import { StripeCustomerAdminService } from "../services/stripe-customer-admin.service";
import { StripeCustomerApiService } from "../services/stripe-customer-api.service";
import { ModuleACL } from "../../../common/decorators/module.decorator";
import { CoreModuleId } from "../../../common/constants/core-module.ids";

/**
 * StripeCustomerController
 *
 * REST API endpoints for Stripe customer management.
 * Provides CRUD operations for billing customers with JSON:API compliance.
 *
 * Base path: /stripe-customers
 */
@ModuleACL({ module: CoreModuleId.Billing })
@Controller("stripe-customers")
export class StripeCustomerController {
  constructor(
    private readonly stripeCustomerAdminService: StripeCustomerAdminService,
    private readonly stripeCustomerApiService: StripeCustomerApiService,
    private readonly stripeCustomerRepository: StripeCustomerRepository,
    private readonly jsonApiService: JsonApiService,
  ) {}

  /**
   * Get the stripe customer for the current company
   *
   * @route GET /stripe-customers
   */
  @Get()
  @UseGuards(JwtAuthGuard)
  async getCustomer(@Req() req: AuthenticatedRequest, @Res() reply: FastifyReply) {
    const response = await this.stripeCustomerAdminService.getCustomerByCompanyId(req.user.companyId);

    if (!response) {
      reply.status(HttpStatus.NOT_FOUND).send({ error: "Customer not found" });
      return;
    }

    reply.send(response);
  }

  /**
   * Get a stripe customer by ID
   *
   * @route GET /stripe-customers/:id
   */
  @Get(":id")
  @UseGuards(JwtAuthGuard)
  async getCustomerById(@Req() req: AuthenticatedRequest, @Res() reply: FastifyReply, @Param("id") id: string) {
    const response = await this.stripeCustomerAdminService.getCustomerById(id);

    if (!response) {
      reply.status(HttpStatus.NOT_FOUND).send({ error: "Customer not found" });
      return;
    }

    reply.send(response);
  }

  /**
   * Create a new stripe customer
   *
   * @route POST /stripe-customers
   */
  @Post()
  @UseGuards(JwtAuthGuard)
  async createCustomer(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Body() body: StripeCustomerPostDTO,
  ) {
    // Check if customer already exists for this company
    const existingCustomer = await this.stripeCustomerRepository.findByCompanyId({
      companyId: req.user.companyId,
    });

    if (existingCustomer) {
      reply.status(HttpStatus.CONFLICT).send({ error: "Customer already exists for this company" });
      return;
    }

    const response = await this.stripeCustomerAdminService.createCustomer(req.user.companyId, req.user.userId, body);

    reply.status(HttpStatus.CREATED).send(response);
  }

  /**
   * Update a stripe customer
   *
   * @route PUT /stripe-customers/:id
   */
  @Put(":id")
  @UseGuards(JwtAuthGuard)
  async updateCustomer(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("id") id: string,
    @Body() body: StripeCustomerPutDTO,
  ) {
    const response = await this.stripeCustomerAdminService.updateCustomer(id, body);

    if (!response) {
      reply.status(HttpStatus.NOT_FOUND).send({ error: "Customer not found" });
      return;
    }

    reply.send(response);
  }

  /**
   * Delete a stripe customer
   *
   * @route DELETE /stripe-customers/:id
   */
  @Delete(":id")
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteCustomer(@Req() req: AuthenticatedRequest, @Res() reply: FastifyReply, @Param("id") id: string) {
    await this.stripeCustomerAdminService.deleteCustomer(id);

    reply.send();
  }

  /**
   * List payment methods for the customer
   *
   * @route GET /stripe-customers/payment-methods
   */
  @Get("payment-methods")
  @UseGuards(JwtAuthGuard)
  async listPaymentMethods(@Req() req: AuthenticatedRequest, @Res() reply: FastifyReply) {
    const customer = await this.stripeCustomerRepository.findByCompanyId({
      companyId: req.user.companyId,
    });

    if (!customer) {
      reply.status(HttpStatus.NOT_FOUND).send({ error: "Customer not found" });
      return;
    }

    const stripePaymentMethods = await this.stripeCustomerApiService.listPaymentMethods(customer.stripeCustomerId);

    // Transform Stripe PaymentMethod to StripePaymentMethod entity format
    const paymentMethods = stripePaymentMethods.map((pm) => ({
      id: pm.id,
      type: pm.type,
      brand: pm.card?.brand,
      last4: pm.card?.last4,
      expMonth: pm.card?.exp_month,
      expYear: pm.card?.exp_year,
      billingName: pm.billing_details?.name ?? null,
      billingEmail: pm.billing_details?.email ?? null,
      billingPhone: pm.billing_details?.phone ?? null,
      billingAddressCity: pm.billing_details?.address?.city ?? null,
      billingAddressCountry: pm.billing_details?.address?.country ?? null,
      billingAddressLine1: pm.billing_details?.address?.line1 ?? null,
      billingAddressLine2: pm.billing_details?.address?.line2 ?? null,
      billingAddressPostalCode: pm.billing_details?.address?.postal_code ?? null,
      billingAddressState: pm.billing_details?.address?.state ?? null,
    }));

    // Serialize to JSON:API format
    const response = await this.jsonApiService.buildList(StripePaymentMethodModel, paymentMethods);
    reply.send(response);
  }

  /**
   * Set default payment method for the customer
   *
   * @route POST /stripe-customers/payment-methods/:paymentMethodId/default
   */
  @Post("payment-methods/:paymentMethodId/default")
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async setDefaultPaymentMethod(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("paymentMethodId") paymentMethodId: string,
  ) {
    const customer = await this.stripeCustomerRepository.findByCompanyId({
      companyId: req.user.companyId,
    });

    if (!customer) {
      reply.status(HttpStatus.NOT_FOUND).send({ error: "Customer not found" });
      return;
    }

    await this.stripeCustomerApiService.setDefaultPaymentMethod(customer.stripeCustomerId, paymentMethodId);

    await this.stripeCustomerRepository.update({
      id: customer.id,
      defaultPaymentMethodId: paymentMethodId,
    });

    reply.send();
  }

  /**
   * Detach a payment method from the customer
   *
   * @route DELETE /stripe-customers/payment-methods/:paymentMethodId
   */
  @Delete("payment-methods/:paymentMethodId")
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async detachPaymentMethod(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("paymentMethodId") paymentMethodId: string,
  ) {
    const customer = await this.stripeCustomerRepository.findByCompanyId({
      companyId: req.user.companyId,
    });

    if (!customer) {
      reply.status(HttpStatus.NOT_FOUND).send({ error: "Customer not found" });
      return;
    }

    await this.stripeCustomerApiService.detachPaymentMethod(paymentMethodId);

    // If this was the default payment method, clear it
    if (customer.defaultPaymentMethodId === paymentMethodId) {
      await this.stripeCustomerRepository.update({
        id: customer.id,
        defaultPaymentMethodId: null,
      });
    }

    reply.send();
  }
}
