export interface ConfigApiInterface {
  url: string;
  port: number;
  /** Deployment environment name from the ENV var (default "development"). */
  env: string;
  /**
   * Application version reported by `/version`, from npm_package_version
   * (default "1.0.0"). pnpm sets that var for every script it runs, so it is
   * the package.json version of whichever app started the process.
   */
  version: string;
}
