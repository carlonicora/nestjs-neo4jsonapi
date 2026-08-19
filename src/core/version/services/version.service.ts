import { Injectable } from "@nestjs/common";
import { baseConfig } from "../../../config/base.config";

@Injectable()
export class VersionService {
  private readonly apiConfig = baseConfig.api;

  getVersion(): string {
    return this.apiConfig.version;
  }

  getApiUrl(): string {
    return this.apiConfig?.url || "http://localhost:3000";
  }
}
