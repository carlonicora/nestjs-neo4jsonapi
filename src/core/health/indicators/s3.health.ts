import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from "@nestjs/terminus";
import { HeadBucketCommand } from "@aws-sdk/client-s3";
import { BlobServiceClient } from "@azure/storage-blob";
import { BaseConfigInterface, ConfigS3Interface } from "../../../config/interfaces";
import { parseS3CipherOptions } from "../../../foundations/s3/cipher/s3-cipher.core";
import { createS3Client } from "../../../foundations/s3/storage-client";

@Injectable()
export class S3HealthIndicator extends HealthIndicator {
  private readonly TIMEOUT_MS = 5000;

  constructor(private readonly config: ConfigService<BaseConfigInterface>) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const s3Config = this.config.get<ConfigS3Interface>("s3");

      if (!s3Config || !s3Config.bucket) {
        return this.getStatus(key, true, {
          message: "S3 not configured - skipping check",
        });
      }

      const storageType = s3Config.type;

      // Fails the check when encryption is enabled with an unparseable key configuration
      const encryption = s3Config.encryption?.enabled ? "on" : "off";
      if (s3Config.encryption?.enabled) parseS3CipherOptions(s3Config.encryption);

      // Create a timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Health check timeout")), this.TIMEOUT_MS);
      });

      let checkPromise: Promise<void>;

      if (storageType === "azure") {
        checkPromise = this.checkAzure(s3Config);
      } else {
        checkPromise = this.checkS3Compatible(s3Config);
      }

      await Promise.race([checkPromise, timeoutPromise]);

      return this.getStatus(key, true, {
        message: `${storageType} storage connection healthy`,
        storageType,
        encryption,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      throw new HealthCheckError(
        "S3/Storage health check failed",
        this.getStatus(key, false, {
          message: errorMessage,
        }),
      );
    }
  }

  private async checkS3Compatible(s3Config: ConfigS3Interface): Promise<void> {
    const s3Client = createS3Client(s3Config);

    // HeadBucket is a lightweight operation to check bucket access
    const command = new HeadBucketCommand({ Bucket: s3Config.bucket });
    await s3Client.send(command);
    s3Client.destroy();
  }

  private async checkAzure(s3Config: ConfigS3Interface): Promise<void> {
    const connectionString = s3Config.key;
    const containerName = s3Config.bucket;

    const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    const containerClient = blobServiceClient.getContainerClient(containerName);

    // Check if container exists - lightweight operation
    const exists = await containerClient.exists();
    if (!exists) {
      throw new Error(`Azure container '${containerName}' does not exist`);
    }
  }
}
