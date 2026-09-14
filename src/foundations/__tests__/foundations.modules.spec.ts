import { DynamicModule, Type } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { ContentModule } from "../content/content.module";
import { FoundationsModule } from "../foundations.modules";
import { HowToPublicController } from "../how-to/controllers/how-to.public.controller";
import { HowToModule } from "../how-to/how-to.module";
import { ReferralModule } from "../referral/referral.module";
import { UserActivityModule } from "../user-activity/user-activity.module";
import { WaitlistModule } from "../waitlist/waitlist.module";

/** Dynamic modules appear as `{ module: X, … }`; static ones as the class itself. */
const importedClasses = (dynamicModule: DynamicModule): Array<Type<any>> =>
  (dynamicModule.imports ?? []).map((entry: any) => entry?.module ?? entry);

/** The controllers a single imported entry contributes on top of its decorator metadata. */
const dynamicControllersOf = (dynamicModule: DynamicModule, classRef: Type<any>): any[] =>
  (dynamicModule.imports ?? [])
    .filter((entry: any) => entry?.module === classRef)
    .flatMap((entry: any) => entry.controllers ?? []);

describe("FoundationsModule.forRoot", () => {
  it("should register every dynamic foundation module by default", () => {
    const imports = importedClasses(FoundationsModule.forRoot());

    expect(imports).toContain(ContentModule);
    expect(imports).toContain(UserActivityModule);
    expect(imports).toContain(ReferralModule);
  });

  it("should export every dynamic foundation module by default", () => {
    const exports = FoundationsModule.forRoot().exports ?? [];

    expect(exports).toContain(ContentModule);
    expect(exports).toContain(UserActivityModule);
    expect(exports).toContain(ReferralModule);
  });

  it("should exclude ContentModule by class reference", () => {
    const dynamicModule = FoundationsModule.forRoot({ exclude: [ContentModule] });

    expect(importedClasses(dynamicModule)).not.toContain(ContentModule);
    expect(dynamicModule.exports ?? []).not.toContain(ContentModule);
    // the other dynamic modules survive
    expect(importedClasses(dynamicModule)).toContain(UserActivityModule);
    expect(importedClasses(dynamicModule)).toContain(ReferralModule);
  });

  it("should exclude UserActivityModule by class reference", () => {
    const dynamicModule = FoundationsModule.forRoot({ exclude: [UserActivityModule] });

    expect(importedClasses(dynamicModule)).not.toContain(UserActivityModule);
    expect(dynamicModule.exports ?? []).not.toContain(UserActivityModule);
    expect(importedClasses(dynamicModule)).toContain(ContentModule);
  });

  it("should exclude dynamic and static modules together", () => {
    const dynamicModule = FoundationsModule.forRoot({
      exclude: [ContentModule, UserActivityModule, WaitlistModule],
    });
    const imports = importedClasses(dynamicModule);

    expect(imports).not.toContain(ContentModule);
    expect(imports).not.toContain(UserActivityModule);
    expect(imports).not.toContain(WaitlistModule);
    expect(imports).toContain(ReferralModule);
  });
});

describe("FoundationsModule.forRoot — how-to public routes", () => {
  it("should register HowToModule exactly once, as a dynamic entry", () => {
    const dynamicModule = FoundationsModule.forRoot({ howTo: { publicRoutes: true } });
    const rawImports = (dynamicModule.imports ?? []) as any[];

    // Registering the class both statically AND via forRoot() would give it two
    // module tokens, and Fastify would then reject HowToController's duplicated
    // routes — so the bare class must NOT appear alongside the dynamic entry.
    expect(importedClasses(dynamicModule).filter((entry) => entry === HowToModule)).toHaveLength(1);
    expect(rawImports.filter((entry) => entry === HowToModule)).toHaveLength(0);
    expect(rawImports.filter((entry) => entry?.module === HowToModule)).toHaveLength(1);
    expect(dynamicModule.exports ?? []).toContain(HowToModule);
  });

  it("should NOT register HowToPublicController without a howTo config", () => {
    expect(dynamicControllersOf(FoundationsModule.forRoot(), HowToModule)).not.toContain(HowToPublicController);
  });

  it("should NOT register HowToPublicController when publicRoutes is explicitly false", () => {
    const dynamicModule = FoundationsModule.forRoot({ howTo: { publicRoutes: false } });

    expect(dynamicControllersOf(dynamicModule, HowToModule)).not.toContain(HowToPublicController);
  });

  it("should register HowToPublicController when howTo.publicRoutes is true", () => {
    const dynamicModule = FoundationsModule.forRoot({ howTo: { publicRoutes: true } });

    expect(dynamicControllersOf(dynamicModule, HowToModule)).toContain(HowToPublicController);
  });

  it("should exclude HowToModule by class reference", () => {
    const dynamicModule = FoundationsModule.forRoot({ exclude: [HowToModule] });

    expect(importedClasses(dynamicModule)).not.toContain(HowToModule);
    expect(dynamicModule.exports ?? []).not.toContain(HowToModule);
    expect(importedClasses(dynamicModule)).toContain(ContentModule);
  });

  it("should exclude HowToModule even when a howTo config is supplied", () => {
    const dynamicModule = FoundationsModule.forRoot({
      exclude: [HowToModule],
      howTo: { publicRoutes: true },
    });

    expect(importedClasses(dynamicModule)).not.toContain(HowToModule);
    expect(dynamicModule.exports ?? []).not.toContain(HowToModule);
    expect(dynamicControllersOf(dynamicModule, HowToModule)).toEqual([]);
  });
});
