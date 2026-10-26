import { DynamicModule, Type } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

// Task 2 (library engine) owns these files; stub them so this spec only tests the wiring.
const engine = vi.hoisted(() => ({
  AccountWipeService: class AccountWipeService {},
  FullCompanyDeletionService: class FullCompanyDeletionService {},
  AccountDeletionWipeRepository: class AccountDeletionWipeRepository {},
  AccountDeletionCron: class AccountDeletionCron {},
  AccountDeletionProcessor: class AccountDeletionProcessor {},
}));

vi.mock("../services/account-wipe.service", () => ({ AccountWipeService: engine.AccountWipeService }));
vi.mock("../services/full-company-deletion.service", () => ({
  FullCompanyDeletionService: engine.FullCompanyDeletionService,
}));
vi.mock("../repositories/account-deletion.wipe.repository", () => ({
  AccountDeletionWipeRepository: engine.AccountDeletionWipeRepository,
}));
vi.mock("../cron/account-deletion.cron", () => ({ AccountDeletionCron: engine.AccountDeletionCron }));
vi.mock("../processors/account-deletion.processor", () => ({
  AccountDeletionProcessor: engine.AccountDeletionProcessor,
}));

import { FoundationsModule } from "../../foundations.modules";
import { ACCOUNT_DELETION_CONFIG } from "../account-deletion.config";
import { AccountDeletionModule } from "../account-deletion.module";

const importedClasses = (dynamicModule: DynamicModule): Array<Type<any>> =>
  (dynamicModule.imports ?? []).map((entry: any) => entry?.module ?? entry);

describe("AccountDeletionModule opt-in wiring", () => {
  it("FoundationsModule.forRoot({}) does not import AccountDeletionModule", () => {
    const dynamicModule = FoundationsModule.forRoot({});

    expect(importedClasses(dynamicModule)).not.toContain(AccountDeletionModule);
    expect(dynamicModule.exports ?? []).not.toContain(AccountDeletionModule);
  });

  it("FoundationsModule.forRoot() with no config does not import it either", () => {
    expect(importedClasses(FoundationsModule.forRoot())).not.toContain(AccountDeletionModule);
  });

  it("forRoot({ accountDeletion: {} }) imports it", () => {
    const dynamicModule = FoundationsModule.forRoot({ accountDeletion: {} });

    expect(importedClasses(dynamicModule)).toContain(AccountDeletionModule);
  });

  it("can still be excluded by class reference", () => {
    const dynamicModule = FoundationsModule.forRoot({ accountDeletion: {}, exclude: [AccountDeletionModule] });

    expect(importedClasses(dynamicModule)).not.toContain(AccountDeletionModule);
  });

  it("AccountDeletionModule.forRoot merges the config over the 7-day default", () => {
    const configOf = (module: DynamicModule) =>
      (module.providers as any[]).find((p) => p?.provide === ACCOUNT_DELETION_CONFIG)?.useValue;

    expect(configOf(AccountDeletionModule.forRoot())).toEqual({ graceDays: 7 });
    expect(configOf(AccountDeletionModule.forRoot({ graceDays: 14 }))).toEqual({ graceDays: 14 });
    expect(AccountDeletionModule.forRoot().global).toBe(true);
  });
});
