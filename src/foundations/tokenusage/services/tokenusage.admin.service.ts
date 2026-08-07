import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AbstractService } from "../../../core/neo4j/abstracts/abstract.service";
import { TokenUsage, TokenUsageDescriptor } from "../entities/tokenusage";
import { TokenUsageAdminBreakdownDescriptor } from "../entities/tokenusage-admin-breakdown";
import { TokenUsageAdminSummaryDescriptor } from "../entities/tokenusage-admin-summary";
import { TokenUsageAdminTimelineDescriptor } from "../entities/tokenusage-admin-timeline";
import { TokenUsageAdminRepository } from "../repositories/tokenusage.admin.repository";

/**
 * Serialises the cross-tenant reporting rollups as JSON:API documents.
 *
 * Extends AbstractService with the same generics, descriptor and super()
 * argument order as its sibling TokenUsageService in this folder, so both
 * services in the tokenusage foundation are wired identically. The inherited
 * generic CRUD (find / findById / create / put / patch / delete) is not reachable
 * from any route on TokenUsageAdminController — the three reporting endpoints are
 * the whole surface — but is available to a consuming app that mounts its own
 * controller, exactly as the docblock on TokenUsageService already notes.
 *
 * `descriptor` and the inherited `model` are the TokenUsage entity: that is what
 * the repository reads and what the base class needs to be coherent. The three
 * methods below deliberately serialise with the AGGREGATE descriptors' models
 * instead, because their return shapes are rollups, not TokenUsage nodes.
 *
 * JSON:API documents are built exclusively by the framework — nothing here
 * hand-assembles a { data: { type, attributes } } object.
 */
@Injectable()
export class TokenUsageAdminService extends AbstractService<TokenUsage, typeof TokenUsageDescriptor.relationships> {
  protected readonly descriptor = TokenUsageDescriptor;

  constructor(
    jsonApiService: JsonApiService,
    protected readonly tokenUsageAdminRepository: TokenUsageAdminRepository,
    clsService: ClsService,
  ) {
    super(jsonApiService, tokenUsageAdminRepository, clsService, TokenUsageDescriptor.model);
  }

  async getSummary(params: { from: string; to: string; companyId?: string }): Promise<any> {
    const rows = await this.tokenUsageAdminRepository.findSummary({
      from: params.from,
      to: params.to,
      companyId: params.companyId,
    });

    return this.jsonApiService.buildList(TokenUsageAdminSummaryDescriptor.model, rows);
  }

  async getTimeline(params: {
    from: string;
    to: string;
    granularity: "day" | "week" | "month";
    stackBy: "scope" | "type" | "company";
    companyId?: string;
  }): Promise<any> {
    const rows = await this.tokenUsageAdminRepository.findTimeline({
      from: params.from,
      to: params.to,
      granularity: params.granularity,
      stackBy: params.stackBy,
      companyId: params.companyId,
    });

    return this.jsonApiService.buildList(TokenUsageAdminTimelineDescriptor.model, rows);
  }

  async getBreakdown(params: {
    from: string;
    to: string;
    dimension: "company" | "user" | "operation";
    scope: "customer" | "platform";
    companyId?: string;
    limit: number;
  }): Promise<any> {
    const rows = await this.tokenUsageAdminRepository.findBreakdown({
      from: params.from,
      to: params.to,
      dimension: params.dimension,
      scope: params.scope,
      companyId: params.companyId,
      limit: params.limit,
    });

    return this.jsonApiService.buildList(TokenUsageAdminBreakdownDescriptor.model, rows);
  }
}
