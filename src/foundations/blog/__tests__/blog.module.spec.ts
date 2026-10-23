import { MODULE_METADATA } from "@nestjs/common/constants";
import { describe, expect, it } from "vitest";
import { BlogModule } from "../blog.module";
import { BlogCategoryTranslationController } from "../controllers/blog-category-translation.controller";
import { BlogCategoryController } from "../controllers/blog-category.controller";
import { BlogPostTranslationController } from "../controllers/blog-post-translation.controller";
import { BlogPostController } from "../controllers/blog-post.controller";
import { BlogSettingsController } from "../controllers/blog-settings.controller";
import { BlogPublicController } from "../controllers/blog.public.controller";
import { DEFAULT_BLOG_CONFIG } from "../interfaces/blog.config.interface";

/**
 * Nest concatenates the `@Module()` controllers with the ones `forRoot()`
 * returns, so the effective surface is the union of the two (see
 * how-to.module.spec.ts).
 */
const staticControllers = (): any[] => Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, BlogModule) ?? [];

const effectiveControllers = (dynamicControllers: any[] = []): any[] => [...staticControllers(), ...dynamicControllers];

describe("BlogModule public routes", () => {
  it("statically mounts the five admin controllers and not the public one", () => {
    expect(staticControllers()).toEqual(
      expect.arrayContaining([
        BlogPostController,
        BlogPostTranslationController,
        BlogCategoryController,
        BlogCategoryTranslationController,
        BlogSettingsController,
      ]),
    );
    expect(staticControllers()).not.toContain(BlogPublicController);
  });

  it("defaults publicRoutes to false", () => {
    expect(DEFAULT_BLOG_CONFIG).toEqual({ publicRoutes: false });
  });

  it("forRoot() mounts no BlogPublicController", () => {
    const module = BlogModule.forRoot();

    expect(module.controllers ?? []).toEqual([]);
    expect(effectiveControllers(module.controllers)).not.toContain(BlogPublicController);
  });

  it("forRoot({ publicRoutes: false }) mounts no BlogPublicController", () => {
    expect(effectiveControllers(BlogModule.forRoot({ publicRoutes: false }).controllers)).not.toContain(
      BlogPublicController,
    );
  });

  it("forRoot({ publicRoutes: true }) mounts it beside the admin controllers", () => {
    const module = BlogModule.forRoot({ publicRoutes: true });

    expect(module.module).toBe(BlogModule);
    expect(module.controllers).toContain(BlogPublicController);
    expect(effectiveControllers(module.controllers)).toContain(BlogPostController);
  });
});
