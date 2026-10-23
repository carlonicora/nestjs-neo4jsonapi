import { describe, expect, it } from "vitest";
import { CoreModuleId } from "../../../common/constants/core-module.ids";
import { RoleId } from "../../../common/constants/system.roles";
import { MODULE_ACL_METADATA } from "../../../common/decorators/module.decorator";
import { BlogCategoryTranslationController } from "./blog-category-translation.controller";

describe("BlogCategoryTranslationController authorisation metadata", () => {
  const rolesOf = (method: keyof BlogCategoryTranslationController) =>
    Reflect.getMetadata("roles", BlogCategoryTranslationController.prototype[method]) as string[] | undefined;

  it.each(["update", "retranslate"] as const)("restricts %s to the platform Administrator", (method) => {
    expect(rolesOf(method)).toEqual([RoleId.Administrator]);
  });

  it("declares the Blog permission section", () => {
    expect(Reflect.getMetadata(MODULE_ACL_METADATA, BlogCategoryTranslationController)).toEqual({
      module: CoreModuleId.Blog,
    });
  });
});
