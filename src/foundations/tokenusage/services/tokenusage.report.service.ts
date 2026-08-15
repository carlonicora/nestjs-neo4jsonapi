import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AbstractService } from "../../../core/neo4j/abstracts/abstract.service";
import { TokenUsageReportDimension, TokenUsageReportMetric } from "../common/tokenusage.target-labels";
import { TokenUsage, TokenUsageDescriptor } from "../entities/tokenusage";
import { TokenUsageReportBreakdownDescriptor } from "../entities/tokenusage-report-breakdown";
import { TokenUsageReportSummaryDescriptor } from "../entities/tokenusage-report-summary";
import { TokenUsageReportTimelineDescriptor } from "../entities/tokenusage-report-timeline";
import { TokenUsageReportRepository } from "../repositories/tokenusage.report.repository";

/**
 * Serialises the self-service reporting rollups as JSON:API documents.
 *
 * Same generics, descriptor and super() argument order as its two siblings in
 * this folder, so all three tokenusage services are wired identically.
 * `descriptor` and the inherited `model` are the TokenUsage entity — that is
 * what the repository reads and what the base class needs to be coherent — while
 * the three methods below serialise with the AGGREGATE descriptors' models,
 * because their return shapes are rollups, not TokenUsage nodes.
 *
 * JSON:API documents are built exclusively by the framework; nothing here
 * hand-assembles a { data: { type, attributes } } object.
 */
@Injectable()
export class TokenUsageReportService extends AbstractService<TokenUsage, typeof TokenUsageDescriptor.relationships> {
  protected readonly descriptor = TokenUsageDescriptor;

  constructor(
    jsonApiService: JsonApiService,
    protected readonly tokenUsageReportRepository: TokenUsageReportRepository,
    clsService: ClsService,
  ) {
    super(jsonApiService, tokenUsageReportRepository, clsService, TokenUsageDescriptor.model);
  }

  async getSummary(params: { from: string; to: string }): Promise<any> {
    const rows = await this.tokenUsageReportRepository.findSummary({ from: params.from, to: params.to });

    return this.jsonApiService.buildList(TokenUsageReportSummaryDescriptor.model, rows);
  }

  async getTimeline(params: {
    from: string;
    to: string;
    granularity: "day" | "week" | "month";
    stackBy: "type";
  }): Promise<any> {
    const rows = await this.tokenUsageReportRepository.findTimeline({
      from: params.from,
      to: params.to,
      granularity: params.granularity,
      stackBy: params.stackBy,
    });

    return this.jsonApiService.buildList(TokenUsageReportTimelineDescriptor.model, rows);
  }

  async getBreakdown(params: {
    from: string;
    to: string;
    dimension: TokenUsageReportDimension;
    targetLabel?: string;
    metric: TokenUsageReportMetric;
    limit: number;
  }): Promise<any> {
    const rows = await this.tokenUsageReportRepository.findBreakdown({
      from: params.from,
      to: params.to,
      dimension: params.dimension,
      targetLabel: params.targetLabel,
      metric: params.metric,
      limit: params.limit,
    });

    return this.jsonApiService.buildList(TokenUsageReportBreakdownDescriptor.model, rows);
  }
}
