import { describe, expect, it } from "vitest";
import { CoreModuleId } from "../../../common/constants/core-module.ids";
import { RoleId } from "../../../common/constants/system.roles";
import { MODULE_ACL_METADATA } from "../../../common/decorators/module.decorator";
import { BlogPostTranslationController } from "./blog-post-translation.controller";

describe("BlogPostTranslationController authorisation metadata", () => {
  const rolesOf = (method: keyof BlogPostTranslationController) =>
    Reflect.getMetadata("roles", BlogPostTranslationController.prototype[method]) as string[] | undefined;

  it.each(["update", "retranslate"] as const)("restricts %s to the platform Administrator", (method) => {
    expect(rolesOf(method)).toEqual([RoleId.Administrator]);
  });

  it("declares the Blog permission section", () => {
    expect(Reflect.getMetadata(MODULE_ACL_METADATA, BlogPostTranslationController)).toEqual({
      module: CoreModuleId.Blog,
    });
  });
});
