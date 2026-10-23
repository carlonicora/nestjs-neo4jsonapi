/**
 * Configuration interface for the BlogModule.
 *
 * Every option is optional and defaults to the inert value, so
 * `BlogModule.forRoot()` with no arguments mounts the authenticated admin
 * controllers and nothing else.
 */
export interface BlogModuleConfig {
  /**
   * When true, the module additionally mounts `BlogPublicController`, which
   * serves DELIBERATELY UNAUTHENTICATED read routes under `public/blog-*`.
   * They return published posts only, and never the author's User node.
   *
   * @default false
   */
  publicRoutes?: boolean;
}

/**
 * Default configuration values.
 */
export const DEFAULT_BLOG_CONFIG: Required<BlogModuleConfig> = {
  publicRoutes: false,
};
