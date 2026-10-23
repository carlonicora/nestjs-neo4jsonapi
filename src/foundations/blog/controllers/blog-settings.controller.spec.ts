import { describe, expect, it } from "vitest";
import { CoreModuleId } from "../../../common/constants/core-module.ids";
import { RoleId } from "../../../common/constants/system.roles";
import { MODULE_ACL_METADATA } from "../../../common/decorators/module.decorator";
import { BlogSettingsController } from "./blog-settings.controller";

describe("BlogSettingsController authorisation metadata", () => {
  const rolesOf = (method: keyof BlogSettingsController) =>
    Reflect.getMetadata("roles", BlogSettingsController.prototype[method]) as string[] | undefined;

  it("restricts update to the platform Administrator", () => {
    expect(rolesOf("update")).toEqual([RoleId.Administrator]);
  });

  it("declares the Blog permission section", () => {
    expect(Reflect.getMetadata(MODULE_ACL_METADATA, BlogSettingsController)).toEqual({ module: CoreModuleId.Blog });
  });
});
