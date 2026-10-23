import { describe, expect, it } from "vitest";
import { CoreModuleId } from "../../../common/constants/core-module.ids";
import { RoleId } from "../../../common/constants/system.roles";
import { MODULE_ACL_METADATA } from "../../../common/decorators/module.decorator";
import { BlogCategoryController } from "./blog-category.controller";

describe("BlogCategoryController authorisation metadata", () => {
  const rolesOf = (method: keyof BlogCategoryController) =>
    Reflect.getMetadata("roles", BlogCategoryController.prototype[method]) as string[] | undefined;

  it.each(["create", "update", "delete"] as const)("restricts %s to the platform Administrator", (method) => {
    expect(rolesOf(method)).toEqual([RoleId.Administrator]);
  });

  it("restricts the admin reads to Administrators too (drafts are not public)", () => {
    expect(rolesOf("findAll")).toEqual([RoleId.Administrator]);
    expect(rolesOf("findById")).toEqual([RoleId.Administrator]);
  });

  it("declares the Blog permission section", () => {
    expect(Reflect.getMetadata(MODULE_ACL_METADATA, BlogCategoryController)).toEqual({ module: CoreModuleId.Blog });
  });
});
