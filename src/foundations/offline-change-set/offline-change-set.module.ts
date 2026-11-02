import { Module, OnModuleInit } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import { modelRegistry } from "../../common/registries/registry";
import { OfflineChangeSetDescriptor } from "./entities/offline-change-set";
import { OfflineChangeSetRepository } from "./repositories/offline-change-set.repository";
import { OfflineChangeSetService } from "./services/offline-change-set.service";
import { OfflineRouteRunner } from "./services/offline-route-runner.service";

/**
 * Offline change sets: opens a package of every change a device queued while offline and runs
 * each one through the app's own routes. Loaded by `OfflineModule` when
 * `bootstrap({ offline: { changeSets: true } })`. Declares no controller: the receiving route
 * (`POST /offline-change-sets`) belongs to the app, which calls `OfflineChangeSetService.apply`.
 */
@Module({
  imports: [DiscoveryModule],
  providers: [
    OfflineChangeSetDescriptor.model.serialiser,
    OfflineChangeSetRepository,
    OfflineChangeSetService,
    OfflineRouteRunner,
  ],
  exports: [OfflineChangeSetService],
})
export class OfflineChangeSetModule implements OnModuleInit {
  onModuleInit() {
    modelRegistry.register(OfflineChangeSetDescriptor.model);
  }
}
