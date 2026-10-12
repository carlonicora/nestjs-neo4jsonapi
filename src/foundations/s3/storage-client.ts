import { S3Client } from "@aws-sdk/client-s3";
import { ConfigS3Interface } from "../../config/interfaces/config.s3.interface";

/**
 * Builds an S3-compatible client for the configured storage type.
 * Shared by the storage health check and the encrypt-existing sweep CLI.
 */
export function createS3Client(config: ConfigS3Interface): S3Client {
  const type = config.type;

  switch (type) {
    case "s3":
    case "aws":
      return new S3Client({
        region: config.region,
        credentials: {
          accessKeyId: config.key,
          secretAccessKey: config.secret,
        },
      });
    case "digitalocean":
    case "hetzner":
      return new S3Client({
        region: config.region,
        endpoint: config.endpoint,
        credentials: {
          accessKeyId: config.key,
          secretAccessKey: config.secret,
        },
      });
    case "minio":
      return new S3Client({
        endpoint: config.endpoint,
        region: "local",
        credentials: {
          accessKeyId: config.key,
          secretAccessKey: config.secret,
        },
        forcePathStyle: true,
      });
    default:
      throw new Error(`Unsupported storage type: ${type}`);
  }
}
