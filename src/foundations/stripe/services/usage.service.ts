import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { JsonApiDataInterface } from "../../../core/jsonapi";
import { JsonApiPaginator } from "../../../core/jsonapi";
import { JsonApiService } from "../../../core/jsonapi";
import { StripeUsageService } from "./stripe.usage.service";
import { BillingCustomerRepository } from "../repositories/billing-customer.repository";
import { StripeSubscriptionRepository } from "../../stripe-subscription/repositories/stripe-subscription.repository";
import { UsageRecordRepository } from "../repositories/usage-record.repository";
import { UsageRecordModel } from "../entities/usage-record.model";

/**
 * UsageService
 *
 * Manages usage-based billing for subscriptions using Stripe's V2 Billing Meters API.
 * Tracks usage events, provides usage summaries, and integrates with metered billing.
 *
 * Key Features:
 * - Report usage events to Stripe meters
 * - Store usage records locally for tracking
 * - List usage records with time filtering
 * - Generate usage summaries for billing periods
 * - Retrieve meter event summaries from Stripe
 * - List available billing meters
 *
 * Usage-based billing allows charging customers based on actual consumption
 * (e.g., API calls, storage, compute time) rather than fixed subscription fees.
 */
@Injectable()
export class UsageService {
  constructor(
    private readonly usageRecordRepository: UsageRecordRepository,
    private readonly subscriptionRepository: StripeSubscriptionRepository,
    private readonly billingCustomerRepository: BillingCustomerRepository,
    private readonly stripeUsageService: StripeUsageService,
    private readonly jsonApiService: JsonApiService,
  ) {}

  /**
   * Report usage for a subscription
   *
   * Records a usage event to Stripe's V2 Billing Meters and stores it locally for tracking.
   *
   * @param params - Usage parameters
   * @param params.companyId - Company identifier
   * @param params.subscriptionId - Subscription ID
   * @param params.meterId - Meter ID for local tracking
   * @param params.meterEventName - Stripe meter event name
   * @param params.quantity - Usage quantity to report
   * @param params.timestamp - Optional timestamp (defaults to now)
   * @returns JSON:API formatted usage record
   * @throws {HttpException} NOT_FOUND if subscription not found
   * @throws {HttpException} FORBIDDEN if subscription doesn't belong to company
   *
   * @example
   * ```typescript
   * const usage = await usageService.reportUsage({
   *   companyId: 'company_123',
   *   subscriptionId: 'sub_456',
   *   meterId: 'meter_789',
   *   meterEventName: 'api_calls',
   *   quantity: 100
   * });
   * ```
   */
  async reportUsage(params: {
    companyId: string;
    subscriptionId: string;
    meterId: string;
    meterEventName: string;
    quantity: number;
    timestamp?: Date;
  }): Promise<JsonApiDataInterface> {
    const subscription = await this.subscriptionRepository.findById({ id: params.subscriptionId });
    if (!subscription) {
      throw new HttpException("Subscription not found", HttpStatus.NOT_FOUND);
    }

    const customer = await this.billingCustomerRepository.findByCompanyId({ companyId: params.companyId });
    if (!customer || subscription.billingCustomer?.id !== customer.id) {
      throw new HttpException("Subscription does not belong to this company", HttpStatus.FORBIDDEN);
    }

    const timestamp = params.timestamp ?? new Date();

    // Report to Stripe using the V2 Billing Meters API
    const stripeEvent = await this.stripeUsageService.reportMeterEvent({
      eventName: params.meterEventName,
      customerId: customer.stripeCustomerId,
      value: params.quantity,
      timestamp: Math.floor(timestamp.getTime() / 1000),
    });

    // Store locally for tracking
    const usageRecord = await this.usageRecordRepository.create({
      subscriptionId: params.subscriptionId,
      meterId: params.meterId,
      meterEventName: params.meterEventName,
      quantity: params.quantity,
      timestamp,
      stripeEventId: stripeEvent.identifier,
    });

    return this.jsonApiService.buildSingle(UsageRecordModel, usageRecord);
  }

  /**
   * List usage records for a subscription
   *
   * @param params - Parameters
   * @param params.companyId - Company identifier
   * @param params.subscriptionId - Subscription ID
   * @param params.query - JSON:API query parameters for pagination
   * @param params.startTime - Optional filter by start time
   * @param params.endTime - Optional filter by end time
   * @returns JSON:API formatted list of usage records
   * @throws {HttpException} NOT_FOUND if subscription not found
   * @throws {HttpException} FORBIDDEN if subscription doesn't belong to company
   */
  async listUsageRecords(params: {
    companyId: string;
    subscriptionId: string;
    query: any;
    startTime?: Date;
    endTime?: Date;
  }): Promise<JsonApiDataInterface> {
    const paginator = new JsonApiPaginator(params.query);

    const subscription = await this.subscriptionRepository.findById({ id: params.subscriptionId });
    if (!subscription) {
      throw new HttpException("Subscription not found", HttpStatus.NOT_FOUND);
    }

    const customer = await this.billingCustomerRepository.findByCompanyId({ companyId: params.companyId });
    if (!customer || subscription.billingCustomer?.id !== customer.id) {
      throw new HttpException("Subscription does not belong to this company", HttpStatus.FORBIDDEN);
    }

    const usageRecords = await this.usageRecordRepository.findBySubscriptionId({
      subscriptionId: params.subscriptionId,
      startTime: params.startTime,
      endTime: params.endTime,
    });

    return this.jsonApiService.buildList(UsageRecordModel, usageRecords, paginator);
  }

  /**
   * Get usage summary for a subscription
   *
   * Aggregates usage data for a time period from local records.
   *
   * @param params - Parameters
   * @param params.companyId - Company identifier
   * @param params.subscriptionId - Subscription ID
   * @param params.startTime - Summary period start time
   * @param params.endTime - Summary period end time
   * @returns Usage summary with totals and breakdowns by meter
   * @throws {HttpException} NOT_FOUND if subscription not found
   * @throws {HttpException} FORBIDDEN if subscription doesn't belong to company
   */
  async getUsageSummary(params: {
    companyId: string;
    subscriptionId: string;
    startTime: Date;
    endTime: Date;
  }): Promise<any> {
    const subscription = await this.subscriptionRepository.findById({ id: params.subscriptionId });
    if (!subscription) {
      throw new HttpException("Subscription not found", HttpStatus.NOT_FOUND);
    }

    const customer = await this.billingCustomerRepository.findByCompanyId({ companyId: params.companyId });
    if (!customer || subscription.billingCustomer?.id !== customer.id) {
      throw new HttpException("Subscription does not belong to this company", HttpStatus.FORBIDDEN);
    }

    const summary = await this.usageRecordRepository.getUsageSummary({
      subscriptionId: params.subscriptionId,
      startTime: params.startTime,
      endTime: params.endTime,
    });

    return {
      subscriptionId: params.subscriptionId,
      startTime: params.startTime.toISOString(),
      endTime: params.endTime.toISOString(),
      totalUsage: summary.total,
      recordCount: summary.count,
      byMeter: summary.byMeter,
    };
  }

  /**
   * Get meter event summaries from Stripe
   *
   * Retrieves aggregated meter data from Stripe's V2 Billing Meters API.
   *
   * @param params - Parameters
   * @param params.companyId - Company identifier
   * @param params.meterId - Stripe meter ID
   * @param params.startTime - Summary period start time
   * @param params.endTime - Summary period end time
   * @returns Meter event summaries from Stripe
   * @throws {HttpException} NOT_FOUND if billing customer not found
   */
  async getMeterEventSummaries(params: {
    companyId: string;
    meterId: string;
    startTime: Date;
    endTime: Date;
  }): Promise<any> {
    const customer = await this.billingCustomerRepository.findByCompanyId({ companyId: params.companyId });
    if (!customer) {
      throw new HttpException("Billing customer not found", HttpStatus.NOT_FOUND);
    }

    const summaries = await this.stripeUsageService.getMeterEventSummaries({
      meterId: params.meterId,
      customerId: customer.stripeCustomerId,
      startTime: Math.floor(params.startTime.getTime() / 1000),
      endTime: Math.floor(params.endTime.getTime() / 1000),
    });

    return {
      meterId: params.meterId,
      startTime: params.startTime.toISOString(),
      endTime: params.endTime.toISOString(),
      summaries: summaries.map((summary) => ({
        id: summary.id,
        aggregatedValue: summary.aggregated_value,
        startTime: new Date(summary.start_time * 1000).toISOString(),
        endTime: new Date(summary.end_time * 1000).toISOString(),
      })),
    };
  }

  /**
   * List all available billing meters
   *
   * Retrieves all configured meters from Stripe's V2 Billing Meters API.
   *
   * @returns List of available meters with their configurations
   *
   * @example
   * ```typescript
   * const { meters } = await usageService.listMeters();
   * meters.forEach(meter => {
   *   console.log(`${meter.displayName}: ${meter.eventName}`);
   * });
   * ```
   */
  async listMeters(): Promise<any> {
    const meters = await this.stripeUsageService.listMeters();

    return {
      meters: meters.map((meter) => ({
        id: meter.id,
        displayName: meter.display_name,
        eventName: meter.event_name,
        status: meter.status,
        valueSettings: meter.default_aggregation,
      })),
    };
  }
}
