export interface ConfigEnvironmentInterface {
  /**
   * How the process was bootstrapped, from the `environmentType` option passed
   * to `createBaseConfig`. NOT env-driven — the pre-built `baseConfig` export
   * always reports "api" because it is created with no options, so do not use
   * this to detect a worker process. Use {@link appMode} for that.
   */
  type: "worker" | "api";
  /**
   * Worker/API discriminator driven by the APP_MODE env var (default "api").
   * Unlike {@link type} this survives the pre-built `baseConfig` export, so it
   * is what a service should read to label a message with its origin process.
   */
  appMode: "worker" | "api";
  /**
   * Raw NODE_ENV (default ""). Set by Nest/Next rather than by `.env`; read it
   * for behaviour that must differ in a production build (stack-trace
   * sanitising, cookie `secure` flags). For the deployment environment name
   * configured in `.env`, use `api.env` instead.
   */
  nodeEnv: string;
}
