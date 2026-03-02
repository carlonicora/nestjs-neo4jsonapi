import { DynamicModule, Module } from "@nestjs/common";
import { RbacController } from "./controllers/rbac.controller";
import { RbacModulePathsController } from "./controllers/rbac-module-paths.controller";
import { RbacRepository } from "./repositories/rbac.repository";
import { RbacService } from "./services/rbac.service";
import { PermissionMappingSerialiser } from "./serialisers/permission-mapping.serialiser";
import { ModulePathsSerialiser } from "./serialisers/module-paths.serialiser";
import { MODULE_USER_PATHS_TOKEN } from "./rbac.constants";

@Module({})
export class RbacModule {
  static register(options: { moduleUserPaths: Record<string, string[]> }): DynamicModule {
    return {
      module: RbacModule,
      controllers: [RbacController, RbacModulePathsController],
      providers: [
        RbacRepository,
        RbacService,
        PermissionMappingSerialiser,
        ModulePathsSerialiser,
        {
          provide: MODULE_USER_PATHS_TOKEN,
          useValue: options.moduleUserPaths,
        },
      ],
      exports: [RbacService],
    };
  }
}
