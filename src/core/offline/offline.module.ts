import { DynamicModule, Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { OfflineRequestContext } from "./offline-request.context";
import { OfflineRequestInterceptor } from "./offline-request.interceptor";
import { OFFLINE_OPTIONS, OfflineOptions } from "./offline.constants";
import { OfflineChangeSetModule } from "../../foundations/offline-change-set/offline-change-set.module";

/**
 * Offline support (opt-in through `bootstrap({ offline })`). Global: provides
 * `OfflineRequestContext`, the `OFFLINE_OPTIONS` token, and the interceptor that marks
 * offline replays in CLS. With `changeSets: true` it also loads and re-exports
 * `OfflineChangeSetModule`, so the app's receiving route can inject `OfflineChangeSetService`.
 */
@Module({})
export class OfflineModule {
  static forRoot(options: OfflineOptions): DynamicModule {
    return {
      module: OfflineModule,
      global: true,
      imports: options.changeSets ? [OfflineChangeSetModule] : [],
      providers: [
        { provide: OFFLINE_OPTIONS, useValue: options },
        OfflineRequestContext,
        { provide: APP_INTERCEPTOR, useClass: OfflineRequestInterceptor },
      ],
      exports: [OFFLINE_OPTIONS, OfflineRequestContext, ...(options.changeSets ? [OfflineChangeSetModule] : [])],
    };
  }
}
