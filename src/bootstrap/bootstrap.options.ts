import { DynamicModule, Type } from "@nestjs/common";

/**
 * i18n configuration options
 */
export interface I18nOptions {
  /**
   * Fallback language when translation is not available
   * @default "en"
   */
  fallbackLanguage?: string;

  /**
   * Path to the i18n translation files (relative to process.cwd() or absolute)
   * @default "./i18n"
   */
  path?: string;
}

/**
 * Options for the bootstrap function
 *
 * This interface defines all the configuration needed to bootstrap
 * a NestJS application with the library's infrastructure.
 */
export interface BootstrapOptions {
  /**
   * App-specific feature modules to import.
   * These are your application's domain modules.
   */
  appModules: (Type<any> | DynamicModule)[];

  /**
   * i18n configuration for internationalization.
   * If not provided, defaults to English with "./i18n" path.
   */
  i18n?: I18nOptions;

  /**
   * Custom configuration loader that extends baseConfig.
   * Return an object that will be merged with the library's baseConfig.
   */
  config?: () => Record<string, any>;
}
