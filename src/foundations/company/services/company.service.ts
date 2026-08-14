import { InjectQueue } from "@nestjs/bullmq";
import { HttpException, HttpStatus, Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ModuleRef } from "@nestjs/core";
import { OnEvent } from "@nestjs/event-emitter";
import { TOKEN_USAGE_RECORDED_EVENT, TokenUsageRecordedPayload } from "../../tokenusage/events/tokenusage.events";
import { Queue } from "bullmq";
import { ClsService } from "nestjs-cls";
import { BaseConfigInterface, ConfigCreditsInterface } from "../../../config/interfaces";
import { QueueId } from "../../../config/enums/queue.id";
import { JsonApiDataInterface } from "../../../core/jsonapi/interfaces/jsonapi.data.interface";
import { JsonApiPaginator } from "../../../core/jsonapi/serialisers/jsonapi.paginator";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AbstractService } from "../../../core/neo4j/abstracts/abstract.service";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { VersionService } from "../../../core/version/services/version.service";
import { CompanyPostDataDTO } from "../../company/dtos/company.post.dto";
import { CompanyPutDataDTO } from "../../company/dtos/company.put.dto";
import { CompanyDescriptor, Company } from "../../company/entities/company";
import { CompanyRepository } from "../../company/repositories/company.repository";
import { CompanyConfigurationsPutDataDTO } from "../dtos/company.configurations.put.dto";
import { WebSocketService } from "../../../core/websocket/services/websocket.service";
import { CompanyDeletionHandler, COMPANY_DELETION_HANDLER } from "../interfaces/company-deletion-handler.interface";

/**
 * Company service.
 *
 * Extends `AbstractService` so a consuming application can subclass it (see
 * `ExtendedCompanyService`) and inherit both the generic descriptor-driven CRUD
 * and every domain method declared here.
 */
@Injectable()
export class CompanyService extends AbstractService<Company, typeof CompanyDescriptor.relationships> {
  protected readonly descriptor = CompanyDescriptor;

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
    private readonly configService: ConfigService<BaseConfigInterface>,
    @Optional()
    @Inject(COMPANY_DELETION_HANDLER)
    private readonly deletionHandler?: CompanyDeletionHandler,
  ) {
    super(builder, companyRepository, cls, CompanyDescriptor.model);
  }

  async validate(params: { companyId: string }) {
    const company = await this.companyRepository.findByCompanyId({
      companyId: params.companyId,
    });

    if (!company) throw new HttpException("Company not found", HttpStatus.UNAUTHORIZED);
  }

  /** creditCost <= 0 disables credits entirely (spec §5; mirrors tokenusage.service.ts:120-124). */
  private get creditsEnabled(): boolean {
    const credits = this.configService.get<ConfigCreditsInterface>("credits");
    return !!credits && credits.creditCost > 0;
  }

  async validateCompanyCredits(params: { companyId: string }) {
    if (!this.creditsEnabled) return;

    const company = await this.companyRepository.findByCompanyId({
      companyId: params.companyId,
    });

    if (
      (!company.availableMonthlyCredits || company.availableMonthlyCredits <= 0) &&
      (!company.availableExtraCredits || company.availableExtraCredits <= 0)
    )
      throw new HttpException("NO_CREDITS", HttpStatus.PAYMENT_REQUIRED);
  }

  async hasAvailableCredits(params: { companyId: string }): Promise<boolean> {
    if (!this.creditsEnabled) return true;

    const company = await this.companyRepository.findByCompanyId({ companyId: params.companyId });
    return (
      (!!company.availableMonthlyCredits && company.availableMonthlyCredits > 0) ||
      (!!company.availableExtraCredits && company.availableExtraCredits > 0)
    );
  }

  async useCredits(params: { credits: number }) {
    const balances = await this.companyRepository.useCredits({ credits: params.credits });

    // Nothing consumed — no balance change worth broadcasting.
    if (!balances) return;

    // Broadcast the new balances to all company users. Consumers patch these in
    // directly; they must never need to refetch the user to read a credit count.
    const companyId = this.cls.get("companyId");
    if (companyId) {
      await this.webSocketService.sendMessageToCompany(companyId, "company:credits_updated", {
        type: "company:credits_updated",
        companyId,
        availableMonthlyCredits: balances.availableMonthlyCredits,
        availableExtraCredits: balances.availableExtraCredits,
      });
    }
  }

  /**
   * Reacts to LLM usage recorded by TokenUsageService and decrements the
   * company's running credit balance. Decoupled via the event bus so the
   * tokenusage module never imports CompanyModule. Best-effort: must never throw
   * back into the emitter (the LLM call that triggered it must not break).
   */
  @OnEvent(TOKEN_USAGE_RECORDED_EVENT)
  async handleTokenUsageRecorded(payload: TokenUsageRecordedPayload): Promise<void> {
    try {
      await this.useCredits({ credits: payload.credits });
    } catch (error) {
      this.logger.warn(`Failed to deduct company credits: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Create a company from a DTO.
   *
   * RENAMED from `create` to `createCompanyFromDTO` (TS2416): the inherited
   * `AbstractService.create()` takes descriptor-driven params and returns
   * `Promise<JsonApiDataInterface>`, so this DTO-shaped creator cannot override it.
   * The name mirrors the shipped a360ai reference implementation.
   */
  async createCompanyFromDTO(params: { data: CompanyPostDataDTO }): Promise<Company> {
    return this.companyRepository.createCompanyNode({
      companyId: params.data.id,
      name: params.data.attributes.name,
      configurations: params.data.attributes.configurations,
      monthlyCredits: params.data.attributes.monthlyCredits,
      availableMonthlyCredits: params.data.attributes.availableMonthlyCredits,
      availableExtraCredits: params.data.attributes.availableExtraCredits,
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
    await this.companyRepository.createCompanyNode({
      companyId: params.data.id,
      name: params.data.attributes.name,
      configurations: params.data.attributes.configurations,
      monthlyCredits: params.data.attributes.monthlyCredits,
      availableMonthlyCredits: params.data.attributes.availableMonthlyCredits,
      availableExtraCredits: params.data.attributes.availableExtraCredits,
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
      monthlyCredits: params.data.attributes.monthlyCredits,
      availableMonthlyCredits: params.data.attributes.availableMonthlyCredits,
      availableExtraCredits: params.data.attributes.availableExtraCredits,
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

  /**
   * Queue-based async deletion. KEPT under the name `delete` (overriding
   * `AbstractService.delete()`) because it has real extra logic — it queues a BullMQ
   * job instead of deleting synchronously. The param was renamed from `companyId` to
   * `id` to match `AbstractService.delete()`'s exact `{ id: string }` shape (required
   * to satisfy `extends AbstractService`); this mirrors the shipped a360ai reference
   * implementation.
   */
  async delete(params: { id: string }): Promise<void> {
    const queueElement: any = {
      companyId: params.id,
    };
    await this.queue.add("deleteCompany", queueElement);
  }

  async deleteFullCompany(params: { companyId: string }): Promise<void> {
    await this.companyRepository.delete({ id: params.companyId });
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
      await this.companyRepository.delete({ id: params.companyId });
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
