import { DynamicModule, Module, Provider, Type } from "@nestjs/common";
import { RbacController } from "./controllers/rbac.controller";
import { RbacModulePathsController } from "./controllers/rbac-module-paths.controller";
import { RbacRepository } from "./repositories/rbac.repository";
import { RbacService } from "./services/rbac.service";
import { RbacReconcilerService } from "./services/rbac-reconciler.service";
import { PermissionMappingSerialiser } from "./serialisers/permission-mapping.serialiser";
import { ModulePathsSerialiser } from "./serialisers/module-paths.serialiser";
import { MODULE_USER_PATHS_TOKEN } from "./rbac.constants";
import { RBAC_MATRIX_TOKEN } from "./rbac.tokens";
import type { RbacMatrix } from "./dsl/types";
import { RbacDevController } from "./controllers/rbac-dev.controller";
import { createWorkerProvider } from "../../common/decorators/conditional-service.decorator";

@Module({})
export class RbacModule {
  static register(options: {
    moduleUserPaths: Record<string, readonly string[]>;
    rbac?: RbacMatrix;
    devMode?: boolean;
  }): DynamicModule {
    const providers: Provider[] = [
      RbacRepository,
      RbacService,
      PermissionMappingSerialiser,
      ModulePathsSerialiser,
      createWorkerProvider(RbacReconcilerService),
      {
        provide: MODULE_USER_PATHS_TOKEN,
        useValue: options.moduleUserPaths,
      },
      {
        provide: RBAC_MATRIX_TOKEN,
        useValue: options.rbac ?? null,
      },
    ];

    const controllers: Type<any>[] = [RbacController, RbacModulePathsController];
    if (options.devMode) {
      controllers.push(RbacDevController);
    }

    return {
      module: RbacModule,
      controllers,
      providers,
      exports: [RbacService],
    };
  }
}
