import { InjectQueue } from "@nestjs/bullmq";
import { HttpException, HttpStatus, Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { OnEvent } from "@nestjs/event-emitter";
import { TOKEN_USAGE_RECORDED_EVENT, TokenUsageRecordedPayload } from "../../tokenusage/events/tokenusage.events";
import { Queue } from "bullmq";
import { ClsService } from "nestjs-cls";
import { QueueId } from "../../../config/enums/queue.id";
import { JsonApiDataInterface } from "../../../core/jsonapi/interfaces/jsonapi.data.interface";
import { JsonApiPaginator } from "../../../core/jsonapi/serialisers/jsonapi.paginator";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { VersionService } from "../../../core/version/services/version.service";
import { CompanyPostDataDTO } from "../../company/dtos/company.post.dto";
import { CompanyPutDataDTO } from "../../company/dtos/company.put.dto";
import { CompanyDescriptor, Company } from "../../company/entities/company";
import { CompanyRepository } from "../../company/repositories/company.repository";
import { CompanyConfigurationsPutDataDTO } from "../dtos/company.configurations.put.dto";
import { WebSocketService } from "../../../core/websocket/services/websocket.service";
import { CompanyDeletionHandler, COMPANY_DELETION_HANDLER } from "../interfaces/company-deletion-handler.interface";

@Injectable()
export class CompanyService {
  private readonly logger = new Logger(CompanyService.name);

  constructor(
    private readonly builder: JsonApiService,
    private readonly companyRepository: CompanyRepository,
    @InjectQueue(QueueId.COMPANY) private readonly queue: Queue,
    private readonly cls: ClsService,
    private readonly neo4j: Neo4jService,
    private readonly versionService: VersionService,
    private readonly moduleRef: ModuleRef,
    private readonly webSocketService: WebSocketService,
    @Optional()
    @Inject(COMPANY_DELETION_HANDLER)
    private readonly deletionHandler?: CompanyDeletionHandler,
  ) {}

  async validate(params: { companyId: string }) {
    const company = await this.companyRepository.findByCompanyId({
      companyId: params.companyId,
    });

    if (!company) throw new HttpException("Company not found", HttpStatus.UNAUTHORIZED);
  }

  async validateCompanyTokens(params: { companyId: string }) {
    const company = await this.companyRepository.findByCompanyId({
      companyId: params.companyId,
    });

    if (
      (!company.availableMonthlyTokens || company.availableMonthlyTokens <= 0) &&
      (!company.availableExtraTokens || company.availableExtraTokens <= 0)
    )
      throw new HttpException("NO_TOKENS", HttpStatus.PAYMENT_REQUIRED);
  }

  async hasAvailableTokens(params: { companyId: string }): Promise<boolean> {
    const company = await this.companyRepository.findByCompanyId({ companyId: params.companyId });
    return (
      (company.availableMonthlyTokens && company.availableMonthlyTokens > 0) ||
      (company.availableExtraTokens && company.availableExtraTokens > 0)
    );
  }

  async useTokens(params: { inputTokens: number; outputTokens: number }) {
    await this.companyRepository.useTokens({
      input: params.inputTokens,
      output: params.outputTokens,
    });

    // Broadcast token update to all company users
    const companyId = this.cls.get("companyId");
    if (companyId) {
      await this.webSocketService.sendMessageToCompany(companyId, "company:tokens_updated", {
        type: "company:tokens_updated",
        companyId,
      });
    }
  }

  /**
   * Reacts to LLM token consumption recorded by TokenUsageService and decrements
   * the company's running balance. Decoupled via the event bus so the tokenusage
   * module never imports CompanyModule. Best-effort: must never throw back into
   * the emitter (the LLM call that triggered it must not break).
   */
  @OnEvent(TOKEN_USAGE_RECORDED_EVENT)
  async handleTokenUsageRecorded(payload: TokenUsageRecordedPayload): Promise<void> {
    try {
      await this.useTokens({ inputTokens: payload.input, outputTokens: payload.output });
    } catch (error) {
      this.logger.warn(`Failed to deduct company tokens: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async create(params: { data: CompanyPostDataDTO }): Promise<Company> {
    return this.companyRepository.create({
      companyId: params.data.id,
      name: params.data.attributes.name,
      configurations: params.data.attributes.configurations,
      monthlyTokens: params.data.attributes.monthlyTokens,
      availableMonthlyTokens: params.data.attributes.availableMonthlyTokens,
      availableExtraTokens: params.data.attributes.availableExtraTokens,
      featureIds: params.data.relationships?.features?.data.map((feature) => feature.id),
      legal_address: params.data.attributes.legal_address,
      street_number: params.data.attributes.street_number,
      street: params.data.attributes.street,
      city: params.data.attributes.city,
      province: params.data.attributes.province,
      region: params.data.attributes.region,
      postcode: params.data.attributes.postcode,
      country: params.data.attributes.country,
      country_code: params.data.attributes.country_code,
      fiscal_data: params.data.attributes.fiscal_data,
    });
  }

  async createForController(params: { data: CompanyPostDataDTO }): Promise<JsonApiDataInterface> {
    await this.companyRepository.create({
      companyId: params.data.id,
      name: params.data.attributes.name,
      configurations: params.data.attributes.configurations,
      monthlyTokens: params.data.attributes.monthlyTokens,
      availableMonthlyTokens: params.data.attributes.availableMonthlyTokens,
      availableExtraTokens: params.data.attributes.availableExtraTokens,
      featureIds: params.data.relationships?.features?.data.map((feature) => feature.id),
      moduleIds: params.data.relationships?.modules?.data.map((module) => module.id),
      legal_address: params.data.attributes.legal_address,
      street_number: params.data.attributes.street_number,
      street: params.data.attributes.street,
      city: params.data.attributes.city,
      province: params.data.attributes.province,
      region: params.data.attributes.region,
      postcode: params.data.attributes.postcode,
      country: params.data.attributes.country,
      country_code: params.data.attributes.country_code,
      fiscal_data: params.data.attributes.fiscal_data,
    });

    return this.builder.buildSingle(
      CompanyDescriptor.model,
      await this.companyRepository.findByCompanyId({ companyId: params.data.id }),
    );
  }

  async update(params: { data: CompanyPutDataDTO }): Promise<JsonApiDataInterface> {
    await this.companyRepository.update({
      companyId: params.data.id,
      name: params.data.attributes.name,
      configurations: params.data.attributes.configurations,
      logo: params.data.attributes.logo,
      monthlyTokens: params.data.attributes.monthlyTokens,
      availableMonthlyTokens: params.data.attributes.availableMonthlyTokens,
      availableExtraTokens: params.data.attributes.availableExtraTokens,
      featureIds: params.data.relationships?.features?.data.map((feature) => feature.id),
      moduleIds: params.data.relationships?.modules?.data.map((module) => module.id),
      legal_address: params.data.attributes.legal_address,
      street_number: params.data.attributes.street_number,
      street: params.data.attributes.street,
      city: params.data.attributes.city,
      province: params.data.attributes.province,
      region: params.data.attributes.region,
      postcode: params.data.attributes.postcode,
      country: params.data.attributes.country,
      country_code: params.data.attributes.country_code,
      fiscal_data: params.data.attributes.fiscal_data,
    });

    return this.builder.buildSingle(
      CompanyDescriptor.model,
      await this.companyRepository.findByCompanyId({ companyId: params.data.id }),
    );
  }

  async updateConfigurations(params: { data: CompanyConfigurationsPutDataDTO }): Promise<JsonApiDataInterface> {
    await this.companyRepository.updateConfigurations({
      companyId: params.data.id,
      configurations: params.data.attributes.configurations,
    });

    return this.builder.buildSingle(
      CompanyDescriptor.model,
      await this.companyRepository.findByCompanyId({ companyId: params.data.id }),
    );
  }

  async find(params: { term?: string; query: any }): Promise<JsonApiDataInterface> {
    const paginator: JsonApiPaginator = new JsonApiPaginator(params.query);

    return this.builder.buildList(
      CompanyDescriptor.model,
      await this.companyRepository.find({ term: params.term, cursor: paginator.generateCursor() }),
      paginator,
    );
  }

  async findOne(params: { companyId: string }): Promise<JsonApiDataInterface> {
    return this.builder.buildSingle(
      CompanyDescriptor.model,
      await this.companyRepository.findByCompanyId({ companyId: params.companyId }),
    );
  }

  async findRaw(params: { companyId: string }): Promise<Company> {
    return this.companyRepository.findByCompanyId({ companyId: params.companyId });
  }

  async delete(params: { companyId: string }): Promise<void> {
    const queueElement: any = {
      companyId: params.companyId,
    };
    await this.queue.add("deleteCompany", queueElement);
  }

  async deleteFullCompany(params: { companyId: string }): Promise<void> {
    await this.companyRepository.delete({ companyId: params.companyId });
  }

  /**
   * Synchronous immediate company deletion.
   * Uses comprehensive deletion handler if available,
   * otherwise falls back to simple repository delete.
   *
   * Cancels any active Stripe subscriptions and sends a deletion confirmation email.
   *
   * @param companyId - Company to delete
   * @param companyName - Company name for audit logging (optional)
   */
  async deleteImmediate(params: { companyId: string; companyName?: string }): Promise<void> {
    if (this.deletionHandler) {
      const name =
        params.companyName ??
        (await this.companyRepository.findByCompanyId({ companyId: params.companyId }))?.name ??
        "Unknown";
      await this.deletionHandler.deleteCompany(params.companyId, name, {
        sendEmail: true,
        reason: "immediate_deletion",
      });
    } else {
      await this.companyRepository.delete({ companyId: params.companyId });
    }
  }

  async setDefaultCompanyRequestConfigurationForContactRequests(): Promise<void> {
    const companyId = this.cls.get("companyId");

    if (!companyId) {
      const company = await this.companyRepository.findSingle();
      if (!company) throw new HttpException(`Forbidden`, HttpStatus.FORBIDDEN);
      this.cls.set("companyId", company.id);
    }
  }
}
