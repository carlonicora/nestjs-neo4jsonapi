import { DynamicModule, Type } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { ContentModule } from "../content/content.module";
import { FoundationsModule } from "../foundations.modules";
import { ReferralModule } from "../referral/referral.module";
import { UserActivityModule } from "../user-activity/user-activity.module";
import { WaitlistModule } from "../waitlist/waitlist.module";

/** Dynamic modules appear as `{ module: X, … }`; static ones as the class itself. */
const importedClasses = (dynamicModule: DynamicModule): Array<Type<any>> =>
  (dynamicModule.imports ?? []).map((entry: any) => entry?.module ?? entry);

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
