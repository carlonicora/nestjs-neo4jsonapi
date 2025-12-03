import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { ModuleRef } from "@nestjs/core";
import { ClsService } from "nestjs-cls";
import {
  COMPANY_CONFIGURATIONS_FACTORY,
  CompanyConfigurationsFactory,
  CompanyConfigurationsInterface,
} from "../../../common/tokens";
import { CompanyConfigurations } from "../../../config/company.configurations";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { CompanyRepository } from "../../company/repositories/company.repository";

@Processor(`${process.env.QUEUE}_company`, { concurrency: 5, lockDuration: 1000 * 60 })
export class CompanyProcessor extends WorkerHost {
  constructor(
    private readonly companyRepository: CompanyRepository,
    private readonly neo4j: Neo4jService,
    private readonly cls: ClsService,
    private readonly logger: AppLoggingService,
    private readonly moduleRef: ModuleRef,
  ) {
    super();
  }

  /**
   * Get the company configurations factory from the global CoreModule provider.
   * Returns null if not configured.
   */
  private getCompanyConfigFactory(): CompanyConfigurationsFactory | null {
    try {
      return this.moduleRef.get<CompanyConfigurationsFactory>(COMPANY_CONFIGURATIONS_FACTORY, { strict: false });
    } catch {
      return null;
    }
  }

  @OnWorkerEvent("active")
  onActive(job: Job) {
    this.logger.debug(`Processing ${job.name} job`);
  }

  @OnWorkerEvent("failed")
  onError(job: Job) {
    this.logger.error(`Error processing ${job.name} job (ID: ${job.id}). Reason: ${job.failedReason}`);
  }

  @OnWorkerEvent("completed")
  onCompleted(job: Job) {
    this.logger.debug(`Completed ${job.name} job (ID: ${job.id})`);
  }

  async process(job: Job): Promise<void> {
    if (job.name !== "deleteCompany") return;

    await this.cls.run(async () => {
      this.cls.set("companyId", job.data.companyId);
      this.cls.set("userId", job.data.userId);

      let configurations: CompanyConfigurationsInterface;
      const companyConfigFactory = this.getCompanyConfigFactory();
      if (companyConfigFactory) {
        configurations = await companyConfigFactory({
          companyId: job.data.companyId,
          userId: job.data.userId,
          neo4j: this.neo4j,
        });
      } else {
        const config = new CompanyConfigurations({
          companyId: job.data.companyId,
          userId: job.data.userId,
        });
        await config.loadConfigurations({ neo4j: this.neo4j });
        configurations = config;
      }
      this.cls.set<CompanyConfigurationsInterface>("companyConfigurations", configurations);

      await this.deleteFullCompany({ companyId: job.data.companyId });
    });
  }

  async deleteFullCompany(params: { companyId: string }): Promise<void> {
    await this.companyRepository.delete({ companyId: params.companyId });
  }
}
