import { InjectionToken, OptionalFactoryDependency, Provider } from "@nestjs/common";
import "reflect-metadata";

/**
 * App mode enumeration for conditional providers
 */
export enum AppMode {
  API = "api",
  WORKER = "worker",
}

/**
 * App mode configuration interface
 */
export interface AppModeConfig {
  mode: AppMode;
  enableControllers: boolean;
  enableWorkers: boolean;
  enableCronJobs: boolean;
}

/**
 * Injection token for app mode
 */
export const APP_MODE_TOKEN = Symbol("APP_MODE_TOKEN");

/**
 * Resolves constructor injection tokens, accounting for @Inject() decorator overrides.
 * NestJS stores custom tokens (from @Inject, @InjectQueue, etc.) in 'self:paramtypes' metadata.
 *
 * `@Optional()` is honoured too. Nest records the optional parameter INDEXES in
 * 'optional:paramtypes' (OPTIONAL_DEPS_METADATA); a factory provider expresses
 * optionality as `{ token, optional: true }` in its `inject` array, so a bare
 * token is ALWAYS required. Without this, a class wrapped by
 * `createWorkerProvider`/`createApiProvider` loses its `@Optional()` markers and
 * the app crashes at boot with `UnknownDependenciesException` whenever an
 * optional seam (e.g. CREDIT_VALIDATOR, TOKEN_USAGE_RECORDER) is unbound — a
 * failure only reproducible in a consumer that does NOT bind that seam.
 */
function resolveInjectionTokens(
  ServiceClass: new (...args: any[]) => any,
): (InjectionToken | OptionalFactoryDependency)[] {
  const paramTypes = Reflect.getMetadata("design:paramtypes", ServiceClass) || [];
  const customTokens: { index: number; param: any }[] = Reflect.getMetadata("self:paramtypes", ServiceClass) || [];
  const optionalIndexes: number[] = Reflect.getMetadata("optional:paramtypes", ServiceClass) || [];

  const tokens = [...paramTypes];
  for (const { index, param } of customTokens) {
    tokens[index] = param;
  }
  return tokens.map((token, index) => (optionalIndexes.includes(index) ? { token, optional: true } : token));
}

/**
 * Helper function to create conditional providers based on app mode
 */
export function createConditionalProvider<T>(ServiceClass: new (...args: any[]) => T, modes: AppMode[]): Provider {
  const tokens = resolveInjectionTokens(ServiceClass);

  return {
    provide: ServiceClass,
    useFactory: (appMode: AppModeConfig, ...args: any[]) => {
      if (!modes.includes(appMode.mode)) return null;

      return new ServiceClass(...args);
    },
    inject: [APP_MODE_TOKEN, ...tokens],
  };
}

/**
 * Helper function to create providers that only run in worker mode
 */
export function createWorkerProvider<T>(ServiceClass: new (...args: any[]) => T): Provider {
  return createConditionalProvider(ServiceClass, [AppMode.WORKER]);
}

/**
 * Helper function to create providers that only run in API mode
 */
export function createApiProvider<T>(ServiceClass: new (...args: any[]) => T): Provider {
  return createConditionalProvider(ServiceClass, [AppMode.API]);
}

/**
 * Helper function to create providers that run in both modes but are mode-aware
 */
export function createModeAwareProvider<T>(ServiceClass: new (...args: any[]) => T): Provider {
  const tokens = resolveInjectionTokens(ServiceClass);

  return {
    provide: ServiceClass,
    useFactory: (appMode: AppModeConfig, ...args: any[]) => {
      const instance = new ServiceClass(...args);

      if (typeof (instance as any).setAppMode === "function") (instance as any).setAppMode(appMode);

      return instance;
    },
    inject: [APP_MODE_TOKEN, ...tokens],
  };
}

/**
 * Base class for services that need to be mode-aware
 */
export abstract class ModeAwareService {
  protected appMode?: AppModeConfig;

  setAppMode(appMode: AppModeConfig) {
    this.appMode = appMode;
  }

  protected isApiMode(): boolean {
    return this.appMode?.mode === AppMode.API;
  }

  protected isWorkerMode(): boolean {
    return this.appMode?.mode === AppMode.WORKER;
  }

  protected shouldRunCronJobs(): boolean {
    return this.appMode?.enableCronJobs === true;
  }

  protected shouldProcessJobs(): boolean {
    return this.appMode?.enableWorkers === true;
  }
}
