import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { JsonApiDataInterface } from "@carlonicora/nestjs-neo4jsonapi";
import { JsonApiPaginator } from "@carlonicora/nestjs-neo4jsonapi";
import { JsonApiService } from "@carlonicora/nestjs-neo4jsonapi";
import { StripeUsageService } from "@carlonicora/nestjs-neo4jsonapi";
import { BillingCustomerRepository } from "../repositories/billing-customer.repository";
import { SubscriptionRepository } from "../repositories/subscription.repository";
import { UsageRecordRepository } from "../repositories/usage-record.repository";
import { UsageRecordModel } from "../entities/usage-record.model";

@Injectable()
export class UsageService {
  constructor(
    private readonly usageRecordRepository: UsageRecordRepository,
    private readonly subscriptionRepository: SubscriptionRepository,
    private readonly billingCustomerRepository: BillingCustomerRepository,
    private readonly stripeUsageService: StripeUsageService,
    private readonly jsonApiService: JsonApiService,
  ) {}

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
