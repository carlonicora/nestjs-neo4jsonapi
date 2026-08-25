import { Module, OnModuleInit } from "@nestjs/common";
import { modelRegistry } from "../../common/registries/registry";
import { S3Controller } from "./controllers/s3.controller";
import { S3Model } from "./entities/s3.model";
import { S3Serialiser } from "./serialisers/s3.serialiser";
import { S3ServiceModule } from "./s3.service.module";

@Module({
  // S3Service is provided by S3ServiceModule (single registration — see the
  // comment there); this module adds the /s3 controller and the serialiser.
  imports: [S3ServiceModule],
  controllers: [S3Controller],
  providers: [S3Serialiser],
  exports: [S3ServiceModule, S3Serialiser],
})
export class S3Module implements OnModuleInit {
  onModuleInit() {
    modelRegistry.register(S3Model);
  }
}
