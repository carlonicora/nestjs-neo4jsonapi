import { vi, describe, it, expect, beforeEach, afterEach, type Mocked } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { HealthCheckError } from "@nestjs/terminus";
import { S3HealthIndicator } from "../indicators/s3.health";

// Mock AWS SDK
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class MockS3Client {
    send = vi.fn().mockResolvedValue({});
    destroy = vi.fn();
  },
  HeadBucketCommand: class MockHeadBucketCommand {
    constructor(public params: any) {}
  },
}));

describe("S3HealthIndicator", () => {
  let indicator: S3HealthIndicator;
  let configService: Mocked<ConfigService>;

  beforeEach(async () => {
    const mockConfigService = {
      get: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        S3HealthIndicator,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    indicator = module.get<S3HealthIndicator>(S3HealthIndicator);
    configService = module.get(ConfigService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("isHealthy", () => {
    it("should return healthy status when S3 is not configured", async () => {
      configService.get.mockReturnValue(null);

      const result = await indicator.isHealthy("storage");

      expect(result).toEqual({
        storage: {
          status: "up",
          message: "S3 not configured - skipping check",
        },
      });
    });

    it("should return healthy status when S3 bucket is empty", async () => {
      configService.get.mockReturnValue({ type: "aws", bucket: "" });

      const result = await indicator.isHealthy("storage");

      expect(result).toEqual({
        storage: {
          status: "up",
          message: "S3 not configured - skipping check",
        },
      });
    });

    it("should return healthy status when AWS S3 is connected", async () => {
      configService.get.mockReturnValue({
        type: "aws",
        bucket: "test-bucket",
        region: "us-east-1",
        key: "access-key",
        secret: "secret-key",
      });

      const result = await indicator.isHealthy("storage");

      expect(result).toEqual({
        storage: {
          status: "up",
          message: "aws storage connection healthy",
          storageType: "aws",
          encryption: "off",
        },
      });
    });

    it("should return healthy status when S3 type is configured", async () => {
      configService.get.mockReturnValue({
        type: "s3",
        bucket: "test-bucket",
        region: "us-east-1",
        key: "access-key",
        secret: "secret-key",
      });

      const result = await indicator.isHealthy("storage");

      expect(result).toEqual({
        storage: {
          status: "up",
          message: "s3 storage connection healthy",
          storageType: "s3",
          encryption: "off",
        },
      });
    });

    it("should return healthy status for DigitalOcean Spaces", async () => {
      configService.get.mockReturnValue({
        type: "digitalocean",
        bucket: "test-bucket",
        region: "nyc3",
        endpoint: "https://nyc3.digitaloceanspaces.com",
        key: "access-key",
        secret: "secret-key",
      });

      const result = await indicator.isHealthy("storage");

      expect(result).toEqual({
        storage: {
          status: "up",
          message: "digitalocean storage connection healthy",
          storageType: "digitalocean",
          encryption: "off",
        },
      });
    });

    it("should return healthy status for MinIO", async () => {
      configService.get.mockReturnValue({
        type: "minio",
        bucket: "test-bucket",
        endpoint: "http://localhost:9000",
        key: "minio-key",
        secret: "minio-secret",
      });

      const result = await indicator.isHealthy("storage");

      expect(result).toEqual({
        storage: {
          status: "up",
          message: "minio storage connection healthy",
          storageType: "minio",
          encryption: "off",
        },
      });
    });

    const encryptedConfig = (encryption: { enabled: boolean; key: string }) => ({
      type: "minio",
      bucket: "test-bucket",
      endpoint: "http://localhost:9000",
      key: "minio-key",
      secret: "minio-secret",
      encryption: { ...encryption, retiredKeys: "", plaintextPrefixes: "" },
      uploadMaxBytes: 104857600,
    });

    it('reports encryption "off"', async () => {
      configService.get.mockReturnValue(encryptedConfig({ enabled: false, key: "" }));

      const result = await indicator.isHealthy("storage");

      expect(result.storage.encryption).toBe("off");
    });

    it('reports encryption "on"', async () => {
      configService.get.mockReturnValue(
        encryptedConfig({ enabled: true, key: `k1:${Buffer.alloc(32, 7).toString("base64")}` }),
      );

      const result = await indicator.isHealthy("storage");

      expect(result.storage.status).toBe("up");
      expect(result.storage.encryption).toBe("on");
    });

    it("fails when enabled with a malformed key", async () => {
      configService.get.mockReturnValue(encryptedConfig({ enabled: true, key: "k1:not-32-bytes" }));

      await expect(indicator.isHealthy("storage")).rejects.toThrow(HealthCheckError);
    });
  });
});
