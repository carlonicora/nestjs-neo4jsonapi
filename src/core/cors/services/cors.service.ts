import { Inject, Injectable, Optional } from "@nestjs/common";
import { CorsOptions } from "@nestjs/common/interfaces/external/cors-options.interface";
import { ConfigService } from "@nestjs/config";
import { BaseConfigInterface, ConfigCorsInterface } from "../../../config/interfaces";
import { TRUSTED_ORIGINS_RESOLVER, TrustedOriginsResolver } from "../interfaces/trusted-origins.resolver.interface";

@Injectable()
export class CorsService {
  constructor(
    private readonly configService: ConfigService<BaseConfigInterface>,
    // Optional application-provided source of extra trusted origins (e.g. per-tenant custom
    // domains). Asked only for an origin the static lists reject; absent = behaviour unchanged.
    @Optional() @Inject(TRUSTED_ORIGINS_RESOLVER) private readonly resolver?: TrustedOriginsResolver,
  ) {}

  private get corsConfig(): ConfigCorsInterface {
    return this.configService.get<ConfigCorsInterface>("cors");
  }

  getCorsConfiguration(): CorsOptions {
    return {
      origin: this.getOriginValidator(),
      credentials: this.corsConfig.credentials,
      methods: this.corsConfig.methods,
      allowedHeaders: this.corsConfig.allowedHeaders,
      maxAge: this.corsConfig.maxAge,
      preflightContinue: this.corsConfig.preflightContinue,
      optionsSuccessStatus: this.corsConfig.optionsSuccessStatus,
    };
  }

  private getOriginValidator():
    | ((origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => void)
    | boolean
    | string
    | string[] {
    const { origins, originPatterns, logViolations } = this.corsConfig;

    if (origins.length === 0 && originPatterns.length === 0) {
      if (logViolations) {
        console.error("CORS: No origins or patterns configured, allowing all origins (insecure)");
      }
      return true;
    }

    return (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // Allow requests without Origin header (e.g., server-to-server, Postman, curl)
      // This is standard CORS behavior - only browser requests include Origin header
      if (!origin) {
        return callback(null, true);
      }

      if (this.isOriginAllowed(origin)) {
        return callback(null, true);
      }

      if (!this.resolver) {
        if (logViolations) {
          console.error(`CORS: Rejected request from origin: ${origin}`);
        }
        return callback(null, false);
      }

      // The resolver is asynchronous, but this function must NOT return a promise:
      // @fastify/cors treats a returned promise as a second answer and would call back twice.
      void this.isOriginTrustedByResolver(origin, logViolations).then((isAllowed) => {
        if (!isAllowed && logViolations) {
          console.error(`CORS: Rejected request from origin: ${origin}`);
        }

        callback(null, isAllowed);
      });
    };
  }

  private async isOriginTrustedByResolver(origin: string, logViolations: boolean): Promise<boolean> {
    try {
      return (await this.resolver.isTrusted(origin)) === true;
    } catch (error) {
      if (logViolations) {
        console.error(`CORS: Trusted-origins resolver failed for origin: ${origin}`, error);
      }
      return false;
    }
  }

  private isOriginAllowed(origin: string): boolean {
    const { origins, originPatterns } = this.corsConfig;

    if (origins.includes(origin)) {
      return true;
    }

    for (const pattern of originPatterns) {
      try {
        const regex = new RegExp(pattern);
        if (regex.test(origin)) {
          return true;
        }
      } catch (error) {
        console.error(`CORS: Invalid origin pattern: ${pattern}`, error);
      }
    }

    return false;
  }

  validateConfiguration(): void {
    const { origins, originPatterns } = this.corsConfig;

    if (origins.length === 0 && originPatterns.length === 0) {
      console.error(
        "CORS: No origins or patterns configured. This will allow all origins which is insecure for production.",
      );
    }

    for (const origin of origins) {
      if (!this.isValidOrigin(origin)) {
        console.error(`CORS: Invalid origin configured: ${origin}`);
      }
    }

    for (const pattern of originPatterns) {
      try {
        new RegExp(pattern);
      } catch (error) {
        console.error(`CORS: Invalid origin pattern: ${pattern}`, error);
      }
    }
  }

  private isValidOrigin(origin: string): boolean {
    try {
      new URL(origin);
      return true;
    } catch {
      return false;
    }
  }

  getOrigins(): string[] {
    return this.corsConfig.origins;
  }

  getOriginPatterns(): string[] {
    return this.corsConfig.originPatterns;
  }

  getCredentialsPolicy(): boolean {
    return this.corsConfig.credentials;
  }
}
