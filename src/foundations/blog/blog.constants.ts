export const BLOG_POST_STATUSES = ["draft", "published", "unpublished"] as const;
export type BlogPostStatus = (typeof BLOG_POST_STATUSES)[number];

export const BLOG_TRANSLATION_SOURCES = ["original", "ai", "manual"] as const;
export type BlogTranslationSource = (typeof BLOG_TRANSLATION_SOURCES)[number];

export const BLOG_LIST_LAYOUTS = ["featured", "column", "rail"] as const;
export type BlogListLayout = (typeof BLOG_LIST_LAYOUTS)[number];

/** Path segment in front of every unauthenticated blog route (BlogPublicController). */
export const BLOG_PUBLIC_PREFIX = "public";

/** Id of the single BlogSettings node. NEVER change it: the stored node is merged on it. */
export const BLOG_SETTINGS_ID = "5f3c2a9e-8d41-4b7a-9c2e-1a6b0d4e7f13";

export const BlogJobName = {
  ProcessPost: "blog_process_post",
  TranslatePost: "blog_translate_post",
  ProcessCategory: "blog_process_category",
  TranslateCategory: "blog_translate_category",
} as const;
