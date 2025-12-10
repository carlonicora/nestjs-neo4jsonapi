import { DynamicModule, Module } from "@nestjs/common";
import { VersionController } from "./controllers/version.controller";
import { VersionService } from "./services/version.service";

@Module({})
export class VersionModule {
  static forRoot(): DynamicModule {
    return {
      module: VersionModule,
      controllers: [VersionController],
      providers: [VersionService],
      exports: [VersionService],
      global: true,
    };
  }
}
