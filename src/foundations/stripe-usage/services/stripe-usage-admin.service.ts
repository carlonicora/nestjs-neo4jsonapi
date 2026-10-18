import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { JsonApiListDocument, JsonApiSingleDocument } from "../../../core/jsonapi";
import { JsonApiPaginator } from "../../../core/jsonapi";
import { JsonApiService } from "../../../core/jsonapi";
import { StripeUsageApiService } from "./stripe-usage-api.service";
import { StripeCustomerRepository } from "../../stripe-customer/repositories/stripe-customer.repository";
import { StripeSubscriptionRepository } from "../../stripe-subscription/repositories/stripe-subscription.repository";
import { StripeUsageRecordRepository } from "../repositories/stripe-usage-record.repository";
import { StripeUsageRecordModel } from "../entities/stripe-usage-record.model";

/**
 * StripeUsageAdminService
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
 */
@Injectable()
export class StripeUsageAdminService {
  constructor(
    private readonly usageRecordRepository: StripeUsageRecordRepository,
    private readonly subscriptionRepository: StripeSubscriptionRepository,
    private readonly stripeCustomerRepository: StripeCustomerRepository,
    private readonly stripeUsageApiService: StripeUsageApiService,
    private readonly jsonApiService: JsonApiService,
  ) {}

  /**
   * Report usage for a subscription
   */
  async reportUsage(params: {
    companyId: string;
    subscriptionId: string;
    meterId: string;
    meterEventName: string;
    quantity: number;
    timestamp?: Date;
  }): Promise<JsonApiSingleDocument> {
    const subscription = await this.subscriptionRepository.findById({ id: params.subscriptionId });
    if (!subscription) {
      throw new HttpException("Subscription not found", HttpStatus.NOT_FOUND);
    }

    const customer = await this.stripeCustomerRepository.findByCompanyId({ companyId: params.companyId });
    if (!customer || subscription.stripeCustomer?.id !== customer.id) {
      throw new HttpException("Subscription does not belong to this company", HttpStatus.FORBIDDEN);
    }

    const timestamp = params.timestamp ?? new Date();

    // Report to Stripe using the V2 Billing Meters API
    const stripeEvent = await this.stripeUsageApiService.reportMeterEvent({
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

    return this.jsonApiService.buildSingle(StripeUsageRecordModel, usageRecord);
  }

  /**
   * List usage records for a subscription
   */
  async listUsageRecords(params: {
    companyId: string;
    subscriptionId: string;
    query: any;
    startTime?: Date;
    endTime?: Date;
  }): Promise<JsonApiListDocument> {
    const paginator = new JsonApiPaginator(params.query);

    const subscription = await this.subscriptionRepository.findById({ id: params.subscriptionId });
    if (!subscription) {
      throw new HttpException("Subscription not found", HttpStatus.NOT_FOUND);
    }

    const customer = await this.stripeCustomerRepository.findByCompanyId({ companyId: params.companyId });
    if (!customer || subscription.stripeCustomer?.id !== customer.id) {
      throw new HttpException("Subscription does not belong to this company", HttpStatus.FORBIDDEN);
    }

    const usageRecords = await this.usageRecordRepository.findBySubscriptionId({
      subscriptionId: params.subscriptionId,
      startTime: params.startTime,
      endTime: params.endTime,
    });

    return this.jsonApiService.buildList(StripeUsageRecordModel, usageRecords, paginator);
  }

  /**
   * Get usage summary for a subscription
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

    const customer = await this.stripeCustomerRepository.findByCompanyId({ companyId: params.companyId });
    if (!customer || subscription.stripeCustomer?.id !== customer.id) {
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
   */
  async getMeterEventSummaries(params: {
    companyId: string;
    meterId: string;
    startTime: Date;
    endTime: Date;
  }): Promise<any> {
    const customer = await this.stripeCustomerRepository.findByCompanyId({ companyId: params.companyId });
    if (!customer) {
      throw new HttpException("Stripe customer not found", HttpStatus.NOT_FOUND);
    }

    const summaries = await this.stripeUsageApiService.getMeterEventSummaries({
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
   */
  async listMeters(): Promise<any> {
    const meters = await this.stripeUsageApiService.listMeters();

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
