import { Module, OnModuleInit } from "@nestjs/common";

import { modelRegistry } from "../../common/registries/registry";
import { FeatureController } from "./controllers/feature.controller";
import { FeatureDescriptor } from "./entities/feature";
import { FeatureRepository } from "./repositories/feature.repository";
import { FeatureService } from "./services/feature.service";

@Module({
  controllers: [FeatureController],
  providers: [FeatureRepository, FeatureService, FeatureDescriptor.model.serialiser],
  exports: [FeatureService, FeatureRepository, FeatureDescriptor.model.serialiser],
})
export class FeatureModule implements OnModuleInit {
  onModuleInit() {
    modelRegistry.register(FeatureDescriptor.model);
  }
}
