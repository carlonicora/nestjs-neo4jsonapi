import { Entity } from "../../../common/abstracts/entity";
import { defineEntity } from "../../../common/helpers/define-entity";
import { BlogListLayout } from "../blog.constants";
import { blogSettingsMeta } from "./blog-settings.meta";

/**
 * BlogSettings Entity Type
 *
 * The blog's singleton settings node, stored under `BLOG_SETTINGS_ID`.
 */
export type BlogSettings = Entity & {
  listLayout: BlogListLayout;
};

/**
 * BlogSettings Entity Descriptor
 *
 * Single source of truth for the BlogSettings entity configuration.
 */
export const BlogSettingsDescriptor = defineEntity<BlogSettings>()({
  ...blogSettingsMeta,

  isCompanyScoped: false,
  tenancy: "global",

  description:
    "The settings of the platform's public blog. A single node for the whole app, edited by platform administrators.",

  fields: {
    listLayout: {
      type: "string",
      required: true,
      excludeFromSearch: true,
      description:
        "Which layout the public blog list uses: featured (newest post as a hero, then a card grid), column (a narrow reading column, one row per post) or rail (search and categories in a side rail). Defaults to featured.",
    },
  },

  relationships: {},
});

export type BlogSettingsDescriptorType = typeof BlogSettingsDescriptor;
