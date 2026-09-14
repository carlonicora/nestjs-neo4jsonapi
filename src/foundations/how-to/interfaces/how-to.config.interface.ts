/**
 * Configuration interface for the HowToModule.
 *
 * Every option is optional and defaults to the inert/library-safe value, so
 * `HowToModule.forRoot()` with no arguments changes nothing about a consuming
 * app's HTTP surface: the authenticated CRUD controller is mounted and nothing
 * else.
 */
export interface HowToModuleConfig {
  /**
   * When true, the module additionally mounts `HowToPublicController`, which
   * serves three DELIBERATELY UNAUTHENTICATED routes:
   * `GET public/howtos`, `GET public/howtos/:howToType/:slug` and
   * `GET public/howtos/:howToType/:slug/related`.
   *
   * Those routes read every guide that is not explicitly drafted — the
   * repository filter is `draft IS NULL OR draft = false`, so a guide created
   * without a `draft` property is world-readable. Publishing a company's
   * internal guides is an app-visible policy decision, so it must be opted
   * into explicitly: mounting `HowToModule` never publishes anything.
   *
   * @default false
   */
  publicRoutes?: boolean;
}

/**
 * Default configuration values.
 */
export const DEFAULT_HOW_TO_CONFIG: Required<HowToModuleConfig> = {
  publicRoutes: false,
};
