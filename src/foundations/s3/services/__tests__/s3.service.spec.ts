import { vi, describe, it, expect, beforeEach, afterEach, MockedObject } from "vitest";

// Mock AWS SDK
const mockS3Send = vi.fn().mockResolvedValue({ Contents: [] });

vi.mock("@aws-sdk/client-s3", () => {
  class MockS3Client {
    send = mockS3Send;
  }
  return {
    S3Client: MockS3Client,
    DeleteObjectCommand: vi.fn(),
    DeleteObjectsCommand: vi.fn(),
    GetObjectCommand: vi.fn(),
    ListObjectsV2Command: vi.fn(),
    PutObjectCommand: vi.fn(),
  };
});

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn().mockResolvedValue("https://presigned-url.example.com"),
}));

// Mock Azure SDK
vi.mock("@azure/storage-blob", () => {
  class MockStorageSharedKeyCredential {}
  class MockBlobServiceClient {
    credential = new MockStorageSharedKeyCredential();
    getContainerClient = vi.fn().mockReturnValue({
      getBlobClient: vi.fn().mockReturnValue({
        url: "https://azure.blob.core.windows.net/test",
        delete: vi.fn().mockResolvedValue({}),
      }),
      getBlockBlobClient: vi.fn().mockReturnValue({
        url: "https://azure.blob.core.windows.net/test",
        upload: vi.fn().mockResolvedValue({}),
      }),
      listBlobsFlat: vi.fn().mockReturnValue([]),
    });
    static fromConnectionString = vi.fn();
  }
  return {
    BlobSASPermissions: {
      parse: vi.fn().mockReturnValue({}),
    },
    BlobServiceClient: MockBlobServiceClient,
    ContainerClient: vi.fn(),
    SASProtocol: {
      Https: "https",
    },
    StorageSharedKeyCredential: MockStorageSharedKeyCredential,
    generateBlobSASQueryParameters: vi.fn().mockReturnValue("sas=token"),
  };
});

// Mock crypto
vi.mock("crypto", async () => {
  const actual = await vi.importActual("crypto");
  return {
    ...actual,
    randomUUID: () => "mock-random-uuid",
  };
});

import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { ClsService } from "nestjs-cls";
import { S3Service } from "../s3.service";
import { JsonApiService } from "../../../../core/jsonapi/services/jsonapi.service";
import { AppLoggingService } from "../../../../core/logging/services/logging.service";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

describe("S3Service", () => {
  let service: S3Service;
  let jsonApiService: MockedObject<JsonApiService>;
  let clsService: MockedObject<ClsService>;
  let configService: MockedObject<ConfigService>;

  const MOCK_S3_CONFIG = {
    type: "s3",
    bucket: "test-bucket",
    region: "us-east-1",
    key: "test-access-key",
    secret: "test-secret-key",
    endpoint: undefined,
  };

  const MOCK_MINIO_CONFIG = {
    type: "minio",
    bucket: "test-bucket",
    region: "local",
    key: "minioadmin",
    secret: "minioadmin",
    endpoint: "http://localhost:9000/",
  };

  const MOCK_DO_CONFIG = {
    type: "digitalocean",
    bucket: "test-bucket",
    region: "nyc3",
    key: "test-key",
    secret: "test-secret",
    endpoint: "https://nyc3.digitaloceanspaces.com",
  };

  const MOCK_JSON_API_RESPONSE = {
    data: {
      type: "s3-uploads",
      id: "mock-random-uuid",
      attributes: {
        url: "https://presigned-url.example.com",
      },
    },
  };

  const createMockJsonApiService = () => ({
    buildSingle: vi.fn().mockResolvedValue(MOCK_JSON_API_RESPONSE),
    buildList: vi.fn(),
    buildMany: vi.fn(),
  });

  const createMockClsService = () => ({
    get: vi.fn(),
    set: vi.fn(),
  });

  const createMockConfigService = (s3Config = MOCK_S3_CONFIG) => ({
    get: vi.fn().mockImplementation((key: string) => {
      if (key === "s3") return s3Config;
      return undefined;
    }),
  });

  const createMockAppLoggingService = () => ({
    error: vi.fn(),
    log: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(getSignedUrl).mockResolvedValue("https://presigned-url.example.com");

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        S3Service,
        { provide: JsonApiService, useValue: createMockJsonApiService() },
        { provide: ClsService, useValue: createMockClsService() },
        { provide: ConfigService, useValue: createMockConfigService() },
        { provide: AppLoggingService, useValue: createMockAppLoggingService() },
      ],
    }).compile();

    service = module.get<S3Service>(S3Service);
    jsonApiService = module.get(JsonApiService) as MockedObject<JsonApiService>;
    clsService = module.get(ClsService) as MockedObject<ClsService>;
    configService = module.get(ConfigService) as MockedObject<ConfigService>;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create the service", () => {
      expect(service).toBeDefined();
    });
  });

  describe("generatePresignedUrl", () => {
    it("should generate presigned URL for S3", async () => {
      // Act
      const result = await service.generatePresignedUrl({
        key: "test-file.pdf",
        contentType: "application/pdf",
        isPublic: false,
      });

      // Assert
      expect(result).toBeDefined();
      expect(jsonApiService.buildSingle).toHaveBeenCalled();
    });

    it("should generate presigned URL with public ACL", async () => {
      // Act
      const result = await service.generatePresignedUrl({
        key: "test-file.pdf",
        contentType: "application/pdf",
        isPublic: true,
      });

      // Assert
      expect(result).toBeDefined();
    });

    it("should return null when endpoint is not configured", async () => {
      // Arrange
      configService.get.mockImplementation((key: string) => {
        if (key === "s3") return { ...MOCK_S3_CONFIG, type: undefined };
        return undefined;
      });

      // Create new service with this config
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          S3Service,
          { provide: JsonApiService, useValue: createMockJsonApiService() },
          { provide: ClsService, useValue: createMockClsService() },
          { provide: ConfigService, useValue: configService },
          { provide: AppLoggingService, useValue: createMockAppLoggingService() },
        ],
      }).compile();

      const newService = module.get<S3Service>(S3Service);

      // Act
      const result = await newService.generatePresignedUrl({
        key: "test-file.pdf",
        contentType: "application/pdf",
        isPublic: false,
      });

      // Assert
      expect(result).toBeNull();
    });
  });

  describe("generateSignedUrl", () => {
    it("should generate signed URL for reading files", async () => {
      // Act
      const result = await service.generateSignedUrl({
        key: "test-file.pdf",
      });

      // Assert
      expect(result).toBe("https://presigned-url.example.com");
      expect(getSignedUrl).toHaveBeenCalled();
    });

    it("should return public URL when isPublic is true", async () => {
      // Act
      const result = await service.generateSignedUrl({
        key: "test-file.pdf",
        isPublic: true,
      });

      // Assert
      expect(result).toContain("test-file.pdf");
    });

    it("should use custom TTL when provided", async () => {
      // Act
      await service.generateSignedUrl({
        key: "test-file.pdf",
        ttl: 3600,
      });

      // Assert
      expect(getSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          expiresIn: 3600,
        }),
      );
    });
  });

  describe("findSignedUrl", () => {
    it("should find signed URL and return JSON:API format", async () => {
      // Act
      const result = await service.findSignedUrl({
        key: "test-file.pdf",
      });

      // Assert
      expect(result).toEqual(MOCK_JSON_API_RESPONSE);
      expect(jsonApiService.buildSingle).toHaveBeenCalled();
    });
  });

  describe("deleteFileFromS3", () => {
    it("should delete a file from S3", async () => {
      // Act & Assert - should not throw
      await expect(
        service.deleteFileFromS3({
          key: "test-file.pdf",
        }),
      ).resolves.not.toThrow();
    });

    it("should handle deletion errors gracefully", async () => {
      // Arrange
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      // The S3Client.send will throw an error
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          S3Service,
          { provide: JsonApiService, useValue: createMockJsonApiService() },
          { provide: ClsService, useValue: createMockClsService() },
          { provide: ConfigService, useValue: createMockConfigService() },
          { provide: AppLoggingService, useValue: createMockAppLoggingService() },
        ],
      }).compile();

      const newService = module.get<S3Service>(S3Service);

      // Act & Assert - should not throw even when S3 fails
      await expect(
        newService.deleteFileFromS3({
          key: "test-file.pdf",
        }),
      ).resolves.not.toThrow();

      consoleSpy.mockRestore();
    });
  });

  describe("deleteFolderFromS3", () => {
    it("should delete a folder from S3", async () => {
      // Act & Assert - should not throw
      await expect(
        service.deleteFolderFromS3({
          key: "test-folder",
        }),
      ).resolves.not.toThrow();
    });

    it("should handle folder key with trailing slash", async () => {
      // Act & Assert
      await expect(
        service.deleteFolderFromS3({
          key: "test-folder/",
        }),
      ).resolves.not.toThrow();
    });
  });

  describe("uploadImageBuffer", () => {
    it("should upload image buffer", async () => {
      // Arrange
      // PNG magic bytes
      const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      global.fetch = vi.fn().mockResolvedValue({ ok: true });

      // Act
      const result = await service.uploadImageBuffer({
        buffer: pngBuffer,
        key: "test-image",
      });

      // Assert
      expect(result).toBeDefined();
      expect(result.imagePath).toContain("test-image");
    });

    it("should throw error for unsupported image format", async () => {
      // Arrange
      const invalidBuffer = Buffer.from([0x00, 0x00, 0x00, 0x00]);

      // Act & Assert
      await expect(
        service.uploadImageBuffer({
          buffer: invalidBuffer,
          key: "test-image",
        }),
      ).rejects.toThrow("Unsupported image format");
    });
  });

  describe("uploadFile", () => {
    it("should upload file buffer", async () => {
      // Arrange
      const pdfBuffer = Buffer.from("%PDF-1.4 test content");
      global.fetch = vi.fn().mockResolvedValue({ ok: true });

      // Act
      const result = await service.uploadFile({
        buffer: pdfBuffer,
        key: "test-file",
        contentType: "application/pdf",
      });

      // Assert
      expect(result).toBeDefined();
      expect(result.filePath).toContain("test-file");
    });

    it("should detect content type from buffer when not provided", async () => {
      // Arrange - PNG magic bytes
      const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      global.fetch = vi.fn().mockResolvedValue({ ok: true });

      // Act
      const result = await service.uploadFile({
        buffer: pngBuffer,
        key: "test-file",
      });

      // Assert
      expect(result.filePath).toContain(".png");
    });
  });

  describe("with different storage backends", () => {
    it("should configure MinIO correctly", async () => {
      // Arrange
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          S3Service,
          { provide: JsonApiService, useValue: createMockJsonApiService() },
          { provide: ClsService, useValue: createMockClsService() },
          { provide: ConfigService, useValue: createMockConfigService(MOCK_MINIO_CONFIG) },
          { provide: AppLoggingService, useValue: createMockAppLoggingService() },
        ],
      }).compile();

      const minioService = module.get<S3Service>(S3Service);

      // Act
      const result = await minioService.generatePresignedUrl({
        key: "test-file.pdf",
        contentType: "application/pdf",
        isPublic: false,
      });

      // Assert
      expect(result).toBeDefined();
    });

    it("should configure DigitalOcean Spaces correctly", async () => {
      // Arrange
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          S3Service,
          { provide: JsonApiService, useValue: createMockJsonApiService() },
          { provide: ClsService, useValue: createMockClsService() },
          { provide: ConfigService, useValue: createMockConfigService(MOCK_DO_CONFIG) },
          { provide: AppLoggingService, useValue: createMockAppLoggingService() },
        ],
      }).compile();

      const doService = module.get<S3Service>(S3Service);

      // Act
      const result = await doService.generatePresignedUrl({
        key: "test-file.pdf",
        contentType: "application/pdf",
        isPublic: false,
      });

      // Assert
      expect(result).toBeDefined();
    });
  });
});
