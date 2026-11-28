import { DynamicModule, Type } from "@nestjs/common";
import { ScheduleExplorer, ScheduleModule } from "@nestjs/schedule";
import { NecordModule } from "necord";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { I18N_OPTIONS, I18N_RESOLVERS, I18nJsonLoader, I18nLoader, I18nModule } from "nestjs-i18n";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearRegisteredI18nDirectories, registerI18nDirectory } from "../i18n.directories";
import { AppMode, AppModeConfig } from "../../common/decorators/conditional-service.decorator";
import { baseConfig } from "../../config";
import { DiscordModule } from "../../foundations/discord/discord.module";
import { FoundationsModule } from "../../foundations/foundations.modules";
import { HowToPublicController } from "../../foundations/how-to/controllers/how-to.public.controller";
import { HowToModule } from "../../foundations/how-to/how-to.module";
import { BootstrapOptions } from "../bootstrap.options";
import { createAppModule } from "../app.module.factory";
import { LockedScheduleExplorer } from "../../core/schedule/locked-schedule.explorer";

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

const WORKER_MODE: AppModeConfig = {
  mode: AppMode.WORKER,
  enableControllers: false,
  enableWorkers: true,
  enableCronJobs: true,
};

const importsFor = (options: Partial<BootstrapOptions>, modeConfig: AppModeConfig): any[] => {
  const moduleClass = createAppModule({ appModules: [], ...options } as BootstrapOptions) as any;
  return (moduleClass.forRoot(modeConfig) as DynamicModule).imports ?? [];
};

const hasNecord = (imports: any[]): boolean => imports.some((entry: any) => entry?.module === NecordModule);
const hasDiscordModule = (imports: any[]): boolean => imports.includes(DiscordModule);

describe("createAppModule — Discord bot login", () => {
  const originalToken = baseConfig.discord.token;

  afterEach(() => {
    baseConfig.discord.token = originalToken;
  });

  const cases: Array<{
    name: string;
    label?: string;
    modeConfig: AppModeConfig;
    token: string;
    expected: boolean;
  }> = [
    { name: "no label option, unlabelled worker, token set", modeConfig: WORKER_MODE, token: "t", expected: true },
    {
      name: 'no label option, worker labelled "x", token set',
      modeConfig: { ...WORKER_MODE, enableCronJobs: false, label: "x" },
      token: "t",
      expected: false,
    },
    { name: "no label option, API, token set", modeConfig: API_MODE, token: "t", expected: false },
    {
      name: 'label "discord", worker labelled "discord", token set',
      label: "discord",
      modeConfig: { ...WORKER_MODE, enableCronJobs: false, label: "discord" },
      token: "t",
      expected: true,
    },
    {
      name: 'label "discord", unlabelled worker, token set',
      label: "discord",
      modeConfig: WORKER_MODE,
      token: "t",
      expected: false,
    },
    {
      name: 'label "discord", worker labelled "discord", empty token',
      label: "discord",
      modeConfig: { ...WORKER_MODE, enableCronJobs: false, label: "discord" },
      token: "",
      expected: false,
    },
  ];

  for (const testCase of cases) {
    it(`${testCase.expected ? "imports" : "does not import"} Necord and DiscordModule: ${testCase.name}`, () => {
      baseConfig.discord.token = testCase.token;
      const options: Partial<BootstrapOptions> = testCase.label ? { discord: { label: testCase.label } } : {};

      const imports = importsFor(options, testCase.modeConfig);

      expect(hasNecord(imports)).toBe(testCase.expected);
      expect(hasDiscordModule(imports)).toBe(testCase.expected);
    });
  }
});

describe("createAppModule — scheduler", () => {
  it("imports the locked schedule module when cron jobs are enabled", () => {
    const imports = importsFor({}, WORKER_MODE);
    const schedule = imports.find((entry: any) => entry?.module === ScheduleModule);

    expect(schedule).toBeDefined();
    expect(schedule.providers).toContainEqual({ provide: ScheduleExplorer, useClass: LockedScheduleExplorer });
  });

  it("does not import the schedule module when cron jobs are disabled", () => {
    const imports = importsFor({}, { ...WORKER_MODE, enableCronJobs: false, label: "x" });

    expect(imports.some((entry: any) => entry?.module === ScheduleModule)).toBe(false);
  });
});

describe("createAppModule — i18n folders", () => {
  let root: string;
  let loaders: I18nLoader[] = [];
  const pkgData = { title: "Package title" };

  const i18nEntry = (options: Partial<BootstrapOptions>) =>
    generatedImports(options).find((entry: any) => entry?.module === I18nModule) as DynamicModule;
  const providerFor = (entry: DynamicModule, token: unknown): any =>
    (entry.providers ?? []).find((p: any) => p?.provide === token);

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "app-i18n-"));
    mkdirSync(join(root, "app", "en"), { recursive: true });
    writeFileSync(join(root, "app", "en", "common.json"), JSON.stringify({ hello: "Hello" }));
    mkdirSync(join(root, "pkg", "en"), { recursive: true });
    writeFileSync(join(root, "pkg", "en", "todos.json"), JSON.stringify(pkgData));
    mkdirSync(join(root, "pkg2"));
    clearRegisteredI18nDirectories();
  });

  afterEach(async () => {
    clearRegisteredI18nDirectories();
    await Promise.all(loaders.map((l: any) => l.onModuleDestroy?.()));
    loaders = [];
    rmSync(root, { recursive: true, force: true });
  });

  it("builds no loader while the module tree is assembled", () => {
    registerI18nDirectory(join(root, "pkg"));

    i18nEntry({ i18n: { path: join(root, "app") } });

    expect(() => registerI18nDirectory(join(root, "pkg2"))).not.toThrow();
  });

  it("hands nestjs-i18n the registered folders and the app folder, app last", async () => {
    registerI18nDirectory(join(root, "pkg"));

    const options = await providerFor(
      i18nEntry({ i18n: { path: join(root, "app"), fallbackLanguage: "it" } }),
      I18N_OPTIONS,
    ).useFactory();
    loaders = options.loaders;

    expect(loaders).toHaveLength(2);
    for (const loader of loaders) expect(loader).toBeInstanceOf(I18nJsonLoader);
    expect(options.fallbackLanguage).toBe("it");
    expect(options.logging).toBe(false);
    expect(await loaders[0].load()).toEqual({ en: { todos: pkgData } });
  });

  it("keeps the three language resolvers", () => {
    const entry = i18nEntry({ i18n: { path: join(root, "app") } });

    expect(providerFor(entry, I18N_RESOLVERS).useValue).toHaveLength(3);
  });
});
