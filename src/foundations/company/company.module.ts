import { BullModule } from "@nestjs/bullmq";
import { Module, OnModuleInit } from "@nestjs/common";
import { createWorkerProvider } from "../../common/decorators/conditional-service.decorator";
import { modelRegistry } from "../../common/registries/registry";

import { QueueId } from "../../config";
import { FeatureModule } from "../feature/feature.module";
import { S3Module } from "../s3/s3.module";
import { CompanyController } from "./controllers/company.controller";
import { CompanyDescriptor } from "./entities/company";
import { CompanyProcessor } from "./processors/company.processor";
import { CompanyRepository } from "./repositories/company.repository";
import { CompanyService } from "./services/company.service";

@Module({
  controllers: [CompanyController],
  providers: [
    CompanyRepository,
    CompanyService,
    CompanyDescriptor.model.serialiser,
    createWorkerProvider(CompanyProcessor),
  ],
  exports: [CompanyService, CompanyDescriptor.model.serialiser, CompanyRepository],
  imports: [BullModule.registerQueue({ name: QueueId.COMPANY }), FeatureModule, S3Module],
})
export class CompanyModule implements OnModuleInit {
  onModuleInit() {
    modelRegistry.register(CompanyDescriptor.model);
  }
}
