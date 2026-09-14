import { DynamicModule, Type } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { AppMode, AppModeConfig } from "../../common/decorators/conditional-service.decorator";
import { FoundationsModule } from "../../foundations/foundations.modules";
import { HowToPublicController } from "../../foundations/how-to/controllers/how-to.public.controller";
import { HowToModule } from "../../foundations/how-to/how-to.module";
import { BootstrapOptions } from "../bootstrap.options";
import { createAppModule } from "../app.module.factory";

/**
 * The bootstrap → FoundationsModule seam.
 *
 * Every app in the fleet boots through `bootstrap()`, so a `FoundationsModuleConfig`
 * field with no matching top-level `BootstrapOptions` field is unreachable in
 * practice: `FoundationsModule.forRoot({ howTo })` can only be configured by an
 * app if `createAppModule` forwards `options.howTo` into it. These tests walk
 * the generated module's import tree rather than booting Nest.
 */
const API_MODE: AppModeConfig = {
  mode: AppMode.API,
  enableControllers: true,
  enableWorkers: false,
  enableCronJobs: false,
};

const generatedImports = (options: Partial<BootstrapOptions> = {}): any[] => {
  const moduleClass = createAppModule({ appModules: [], ...options } as BootstrapOptions) as any;
  return (moduleClass.forRoot(API_MODE) as DynamicModule).imports ?? [];
};

/** The `FoundationsModule.forRoot(...)` entry the factory produced, if any. */
const foundations = (options: Partial<BootstrapOptions> = {}): DynamicModule | undefined =>
  generatedImports(options).find((entry: any) => entry?.module === FoundationsModule);

/** The controllers a foundation contributes on top of its own decorator metadata. */
const foundationControllers = (foundationsModule: DynamicModule | undefined, classRef: Type<any>): any[] =>
  (foundationsModule?.imports ?? [])
    .filter((entry: any) => entry?.module === classRef)
    .flatMap((entry: any) => entry.controllers ?? []);

const foundationClasses = (foundationsModule: DynamicModule | undefined): Array<Type<any>> =>
  (foundationsModule?.imports ?? []).map((entry: any) => entry?.module ?? entry);

describe("createAppModule — how-to public routes seam", () => {
  it("mounts FoundationsModule with the how-to foundation by default", () => {
    const foundationsModule = foundations();

    expect(foundationsModule).toBeDefined();
    expect(foundationClasses(foundationsModule)).toContain(HowToModule);
  });

  it("does NOT register HowToPublicController when no howTo option is given", () => {
    expect(foundationControllers(foundations(), HowToModule)).not.toContain(HowToPublicController);
  });

  it("does NOT register HowToPublicController when publicRoutes is explicitly false", () => {
    const foundationsModule = foundations({ howTo: { publicRoutes: false } });

    expect(foundationControllers(foundationsModule, HowToModule)).not.toContain(HowToPublicController);
  });

  it("registers HowToPublicController when howTo.publicRoutes is true", () => {
    const foundationsModule = foundations({ howTo: { publicRoutes: true } });

    expect(foundationControllers(foundationsModule, HowToModule)).toContain(HowToPublicController);
  });

  it("lets foundations.exclude win over a supplied howTo config", () => {
    const foundationsModule = foundations({
      howTo: { publicRoutes: true },
      foundations: { exclude: [HowToModule] },
    });

    expect(foundationClasses(foundationsModule)).not.toContain(HowToModule);
    expect(foundationControllers(foundationsModule, HowToModule)).toEqual([]);
  });

  it("registers no FoundationsModule at all when foundations are disabled", () => {
    expect(foundations({ howTo: { publicRoutes: true }, foundations: { disabled: true } })).toBeUndefined();
  });
});
