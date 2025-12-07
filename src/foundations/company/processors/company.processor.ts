import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { ModuleRef } from "@nestjs/core";
import { Job } from "bullmq";
import { ClsService } from "nestjs-cls";
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

      await this.deleteFullCompany({ companyId: job.data.companyId });
    });
  }

  async deleteFullCompany(params: { companyId: string }): Promise<void> {
    await this.companyRepository.delete({ companyId: params.companyId });
  }
}
