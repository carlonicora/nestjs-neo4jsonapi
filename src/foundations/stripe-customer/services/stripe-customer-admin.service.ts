import { Injectable, BadRequestException } from "@nestjs/common";
import { JsonApiDataInterface, JsonApiService } from "../../../core/jsonapi";
import { CompanyRepository } from "../../company/repositories/company.repository";
import { UserRepository } from "../../user/repositories/user.repository";
import { StripeCustomerRepository } from "../repositories/stripe-customer.repository";
import { StripeCustomerApiService } from "./stripe-customer-api.service";
import { StripeCustomerModel } from "../entities/stripe-customer.model";
import { StripeCustomerPostDTO, StripeCustomerPutDTO } from "../dtos/stripe-customer.dto";

/**
 * Stripe Customer Admin Service
 *
 * Provides business logic for customer management, orchestrating between
 * Stripe API calls and Neo4j persistence. Returns JSON:API formatted responses.
 *
 * @example
 * ```typescript
 * const result = await stripeCustomerAdminService.createCustomer(companyId, dto);
 * ```
 */
@Injectable()
export class StripeCustomerAdminService {
  constructor(
    private readonly stripeCustomerApiService: StripeCustomerApiService,
    private readonly stripeCustomerRepository: StripeCustomerRepository,
    private readonly companyRepository: CompanyRepository,
    private readonly userRepository: UserRepository,
    private readonly jsonApiService: JsonApiService,
  ) {}

  /**
   * Get customer for a company
   *
   * @param companyId - The company ID
   * @returns JSON:API formatted customer or null if not found
   */
  async getCustomerByCompanyId(companyId: string): Promise<JsonApiDataInterface | null> {
    const customer = await this.stripeCustomerRepository.findByCompanyId({ companyId });
    if (!customer) {
      return null;
    }
    return this.jsonApiService.buildSingle(StripeCustomerModel, customer);
  }

  /**
   * Get customer by ID
   *
   * @param id - The internal customer ID
   * @returns JSON:API formatted customer or null if not found
   */
  async getCustomerById(id: string): Promise<JsonApiDataInterface | null> {
    const customer = await this.stripeCustomerRepository.findById({ id });
    if (!customer) {
      return null;
    }
    return this.jsonApiService.buildSingle(StripeCustomerModel, customer);
  }

  /**
   * Get customer by Stripe customer ID
   *
   * @param stripeCustomerId - The Stripe customer ID
   * @returns JSON:API formatted customer or null if not found
   */
  async getCustomerByStripeId(stripeCustomerId: string): Promise<JsonApiDataInterface | null> {
    const customer = await this.stripeCustomerRepository.findByStripeCustomerId({ stripeCustomerId });
    if (!customer) {
      return null;
    }
    return this.jsonApiService.buildSingle(StripeCustomerModel, customer);
  }

  /**
   * Create a new customer
   *
   * Creates customer in both Stripe and Neo4j, establishing company relationship.
   * If no attributes provided, auto-fetches company name and user email as defaults.
   *
   * @param companyId - The company ID to associate with the customer
   * @param userId - The user ID of the authenticated user (for email fallback)
   * @param dto - The JSON:API formatted customer creation data (optional)
   * @returns JSON:API formatted created customer
   */
  async createCustomer(companyId: string, userId: string, dto?: StripeCustomerPostDTO): Promise<JsonApiDataInterface> {
    // Extract attributes from DTO if provided
    let name = dto?.data?.attributes?.name;
    let email = dto?.data?.attributes?.email;
    let currency = dto?.data?.attributes?.currency;

    // If name is missing, fetch from company
    if (!name) {
      const company = await this.companyRepository.findByCompanyId({ companyId });
      if (!company) {
        throw new BadRequestException("Company not found");
      }
      name = company.name;
    }

    // If email is missing, fetch from the authenticated user
    if (!email) {
      const user = await this.userRepository.findByUserId({ userId });
      if (!user) {
        throw new BadRequestException("User not found");
      }
      email = user.email;
    }

    // Default currency to USD if not provided
    currency = currency || "usd";

    // Create customer in Stripe first
    const stripeCustomer = await this.stripeCustomerApiService.createCustomer({
      companyId,
      email,
      name,
    });

    // Persist to Neo4j with relationship to company
    const customer = await this.stripeCustomerRepository.create({
      companyId,
      stripeCustomerId: stripeCustomer.id,
      email,
      name,
      currency,
    });

    return this.jsonApiService.buildSingle(StripeCustomerModel, customer);
  }

  /**
   * Update an existing customer
   *
   * Updates customer in both Stripe and Neo4j.
   *
   * @param id - The internal customer ID
   * @param dto - The JSON:API formatted customer update data
   * @returns JSON:API formatted updated customer
   */
  async updateCustomer(id: string, dto: StripeCustomerPutDTO): Promise<JsonApiDataInterface | null> {
    const existingCustomer = await this.stripeCustomerRepository.findById({ id });
    if (!existingCustomer) {
      return null;
    }

    const { name, email, defaultPaymentMethodId } = dto.data.attributes || {};

    // Update in Stripe if there are changes
    if (name || email || defaultPaymentMethodId) {
      await this.stripeCustomerApiService.updateCustomer({
        stripeCustomerId: existingCustomer.stripeCustomerId,
        name,
        email,
        defaultPaymentMethodId,
      });
    }

    // Update in Neo4j
    const customer = await this.stripeCustomerRepository.update({
      id,
      name,
      email,
      defaultPaymentMethodId,
    });

    return this.jsonApiService.buildSingle(StripeCustomerModel, customer);
  }

  /**
   * Sync customer data from Stripe webhook
   *
   * Updates local Neo4j record to match Stripe's data.
   *
   * @param stripeCustomerId - The Stripe customer ID
   * @param data - The data from Stripe webhook
   * @returns Updated customer or null if not found
   */
  async syncFromStripe(
    stripeCustomerId: string,
    data: {
      email?: string;
      name?: string;
      defaultPaymentMethodId?: string;
      balance?: number;
      delinquent?: boolean;
    },
  ): Promise<JsonApiDataInterface | null> {
    const existingCustomer = await this.stripeCustomerRepository.findByStripeCustomerId({ stripeCustomerId });
    if (!existingCustomer) {
      return null;
    }

    const customer = await this.stripeCustomerRepository.updateByStripeCustomerId({
      stripeCustomerId,
      ...data,
    });

    return this.jsonApiService.buildSingle(StripeCustomerModel, customer);
  }

  /**
   * Delete a customer
   *
   * Deletes customer from both Stripe and Neo4j.
   *
   * @param id - The internal customer ID
   */
  async deleteCustomer(id: string): Promise<void> {
    const customer = await this.stripeCustomerRepository.findById({ id });
    if (!customer) {
      return;
    }

    // Delete from Stripe first
    await this.stripeCustomerApiService.deleteCustomer(customer.stripeCustomerId);

    // Then remove from Neo4j
    await this.stripeCustomerRepository.delete({ id });
  }
}
