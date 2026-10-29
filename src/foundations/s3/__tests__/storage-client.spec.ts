import { describe, expect, it, vi } from "vitest";
import { ConfigS3Interface } from "../../../config/interfaces/config.s3.interface";
import { createS3Client } from "../storage-client";

const { mockS3ClientArgs } = vi.hoisted(() => ({
  mockS3ClientArgs: [] as Array<Record<string, unknown>>,
}));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    constructor(config: Record<string, unknown>) {
      mockS3ClientArgs.push(config);
    }
  },
}));

const baseConfig = {
  endpoint: "https://fsn1.your-objectstorage.com",
  bucket: "bucket",
  key: "key",
  secret: "secret",
  region: "eu-central",
} as ConfigS3Interface;

describe("createS3Client", () => {
  it.each(["s3", "aws", "hetzner", "digitalocean", "minio"])(
    "builds the %s client with connection, socket and request timeouts that throw",
    (type) => {
      mockS3ClientArgs.length = 0;

      createS3Client({ ...baseConfig, type } as ConfigS3Interface);

      expect(mockS3ClientArgs).toHaveLength(1);
      expect(mockS3ClientArgs[0].requestHandler).toEqual({
        connectionTimeout: 10_000,
        socketTimeout: 30_000,
        requestTimeout: 300_000,
        throwOnRequestTimeout: true,
      });
    },
  );

  it("rejects an unsupported storage type", () => {
    expect(() => createS3Client({ ...baseConfig, type: "ftp" } as ConfigS3Interface)).toThrow(
      "Unsupported storage type: ftp",
    );
  });
});
