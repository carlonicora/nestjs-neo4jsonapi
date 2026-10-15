import { vi, describe, it, expect, beforeEach, afterEach, MockedObject } from "vitest";
import { PassThrough, Readable, Transform } from "stream";

// Mock AWS SDK
const mockS3Send = vi.fn().mockResolvedValue({ Contents: [] });

const { mockUploadDone, mockAzureBlockBlobClient, mockAzureBlobClient } = vi.hoisted(() => ({
  mockUploadDone: vi.fn(),
  mockAzureBlockBlobClient: {
    url: "https://azure.blob.core.windows.net/test",
    upload: vi.fn(),
    uploadStream: vi.fn(),
  },
  mockAzureBlobClient: {
    url: "https://azure.blob.core.windows.net/test",
    delete: vi.fn(),
    download: vi.fn(),
  },
}));

vi.mock("@aws-sdk/lib-storage", () => ({
  Upload: vi.fn(function () {
    return { done: mockUploadDone };
  }),
}));

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

// Mock Azure SDK
vi.mock("@azure/storage-blob", () => {
  class MockStorageSharedKeyCredential {}
  class MockBlobServiceClient {
    credential = new MockStorageSharedKeyCredential();
    getContainerClient = vi.fn().mockReturnValue({
      getBlobClient: vi.fn().mockReturnValue(mockAzureBlobClient),
      getBlockBlobClient: vi.fn().mockReturnValue(mockAzureBlockBlobClient),
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
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { S3CipherService } from "../s3-cipher.service";
import { S3CipherKeyMissingError } from "../../cipher/s3-cipher.core";

describe("S3Service", () => {
  let service: S3Service;
  let jsonApiService: MockedObject<JsonApiService>;
  let clsService: MockedObject<ClsService>;
  let configService: MockedObject<ConfigService>;
  let cipher: ReturnType<typeof createMockCipherService>;

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

  const MOCK_API_CONFIG = { url: "http://api.test/" };

  const MOCK_AZURE_CONFIG = {
    type: "azure",
    bucket: "test-container",
    region: "",
    key: "DefaultEndpointsProtocol=https;AccountName=acct;AccountKey=a2V5;EndpointSuffix=core.windows.net",
    secret: "",
    endpoint: "",
  };

  const createMockConfigService = (s3Config: Record<string, unknown> = MOCK_S3_CONFIG) => ({
    get: vi.fn().mockImplementation((key: string) => {
      if (key === "s3") return s3Config;
      if (key === "api") return MOCK_API_CONFIG;
      return undefined;
    }),
  });

  const createMockCipherService = () => ({
    uploadMaxBytes: 104857600,
    enabled: false,
    canDecrypt: true,
    shouldEncrypt: vi.fn().mockReturnValue(false),
    encrypt: vi.fn(),
    decrypt: vi.fn(),
    encryptStream: vi.fn(),
    decryptStream: vi.fn(),
    signObjectToken: vi.fn().mockReturnValue("cGF5bG9hZA.c2ln"),
    verifyObjectToken: vi.fn(),
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
    mockS3Send.mockResolvedValue({ Contents: [] });
    mockUploadDone.mockResolvedValue({});
    mockAzureBlockBlobClient.upload.mockResolvedValue({});
    mockAzureBlockBlobClient.uploadStream.mockResolvedValue({});
    mockAzureBlobClient.delete.mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        S3Service,
        { provide: JsonApiService, useValue: createMockJsonApiService() },
        { provide: ClsService, useValue: createMockClsService() },
        { provide: ConfigService, useValue: createMockConfigService() },
        { provide: AppLoggingService, useValue: createMockAppLoggingService() },
        { provide: S3CipherService, useValue: createMockCipherService() },
      ],
    }).compile();

    service = module.get<S3Service>(S3Service);
    jsonApiService = module.get(JsonApiService) as MockedObject<JsonApiService>;
    clsService = module.get(ClsService) as MockedObject<ClsService>;
    configService = module.get(ConfigService) as MockedObject<ConfigService>;
    cipher = module.get(S3CipherService);
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
    it("should build the presign response through the JSON:API builder", async () => {
      // Act
      const result = await service.generatePresignedUrl({
        key: "test-file.pdf",
        contentType: "application/pdf",
        isPublic: false,
      });

      // Assert
      expect(result).toEqual(MOCK_JSON_API_RESPONSE);
      expect(jsonApiService.buildSingle).toHaveBeenCalled();
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
          { provide: S3CipherService, useValue: createMockCipherService() },
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
          { provide: S3CipherService, useValue: createMockCipherService() },
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

  describe("contentDispositionInline", () => {
    it("names the file after the last segment of the key, decoding it", () => {
      expect(service.contentDispositionInline("companies/c/emails/e/attachments/a/atto%20%C3%A8.pdf")).toBe(
        `inline; filename="atto _.pdf"; filename*=UTF-8''atto%20%C3%A8.pdf`,
      );
    });

    it("keeps a segment that is not URI-encoded as it is", () => {
      expect(service.contentDispositionInline("companies/c/files/f/100%.pdf")).toBe(
        `inline; filename="100%.pdf"; filename*=UTF-8''100%25.pdf`,
      );
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
          { provide: S3CipherService, useValue: createMockCipherService() },
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
          { provide: S3CipherService, useValue: createMockCipherService() },
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
  describe("S3 encryption", () => {
    const PLAINTEXT = Buffer.from("hello world");
    const CIPHERTEXT = Buffer.from("ciphertext-bytes");
    const FLAG = { a360enc: "esdk-1" };

    const lastPutArgs = () => {
      const calls = vi.mocked(PutObjectCommand).mock.calls;
      return calls[calls.length - 1][0] as Record<string, any>;
    };

    const s3Body = (bytes: Buffer) => {
      const body: any = Readable.from([bytes]);
      body.transformToByteArray = vi.fn().mockResolvedValue(new Uint8Array(bytes));
      body.transformToString = vi.fn().mockResolvedValue(bytes.toString("utf-8"));
      return body;
    };

    const buildService = async (s3Config: Record<string, unknown>) => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          S3Service,
          { provide: JsonApiService, useValue: createMockJsonApiService() },
          { provide: ClsService, useValue: createMockClsService() },
          { provide: ConfigService, useValue: createMockConfigService(s3Config) },
          { provide: AppLoggingService, useValue: createMockAppLoggingService() },
          { provide: S3CipherService, useValue: cipher },
        ],
      }).compile();
      return {
        service: module.get<S3Service>(S3Service),
        builder: module.get(JsonApiService) as MockedObject<JsonApiService>,
      };
    };

    beforeEach(() => {
      cipher.encrypt.mockResolvedValue(CIPHERTEXT);
      cipher.decrypt.mockResolvedValue(PLAINTEXT);
      cipher.canDecrypt = true;
    });

    describe("encryption on write", () => {
      beforeEach(() => {
        cipher.shouldEncrypt.mockReturnValue(true);
      });

      it.each(["uploadToS3", "uploadBufferWithKey"])(
        "%s sends ciphertext with the a360enc flag when shouldEncrypt",
        async (method) => {
          await (service as any)[method]({ buffer: PLAINTEXT, key: "docs/a.txt", contentType: "text/plain" });

          const putArgs = lastPutArgs();
          expect(cipher.shouldEncrypt).toHaveBeenCalledWith("docs/a.txt");
          expect(cipher.encrypt).toHaveBeenCalledWith(PLAINTEXT);
          expect(putArgs.Body).toEqual(CIPHERTEXT);
          expect(putArgs.Metadata).toEqual(FLAG);
          expect(putArgs.ContentType).toBe("text/plain");
        },
      );

      it("uploadFile sends ciphertext through PutObject (no presigned fetch) and appends the extension", async () => {
        global.fetch = vi.fn();

        const result = await service.uploadFile({ buffer: PLAINTEXT, key: "docs/a", contentType: "application/pdf" });

        const putArgs = lastPutArgs();
        expect(global.fetch).not.toHaveBeenCalled();
        expect(putArgs.Key).toBe("docs/a.pdf");
        expect(putArgs.Body).toEqual(CIPHERTEXT);
        expect(putArgs.Metadata).toEqual(FLAG);
        expect(putArgs.ContentType).toBe("application/pdf");
        expect(mockS3Send).toHaveBeenCalled();
        expect(result.filePath).toBe("docs/a.pdf");
      });

      it("uploadImageBuffer sends ciphertext through PutObject", async () => {
        global.fetch = vi.fn();
        const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

        const result = await service.uploadImageBuffer({ buffer: pngBuffer, key: "images/a" });

        const putArgs = lastPutArgs();
        expect(global.fetch).not.toHaveBeenCalled();
        expect(cipher.encrypt).toHaveBeenCalledWith(pngBuffer);
        expect(putArgs.Key).toBe("images/a.png");
        expect(putArgs.Body).toEqual(CIPHERTEXT);
        expect(putArgs.Metadata).toEqual(FLAG);
        expect(putArgs.ContentType).toBe("image/png");
        expect(result.imagePath).toBe("images/a.png");
      });

      it("uploadStream pipes the stream through encryptStream and sets Metadata on the Upload params", async () => {
        const encrypting = new PassThrough();
        cipher.encryptStream.mockReturnValue(encrypting);
        const source = Readable.from([PLAINTEXT]);

        await service.uploadStream({ key: "docs/big.zip", contentType: "application/zip", stream: source });

        const uploadArgs = vi.mocked(Upload).mock.calls[0][0] as any;
        expect(cipher.encryptStream).toHaveBeenCalled();
        expect(uploadArgs.params.Body).toBe(encrypting);
        expect(uploadArgs.params.Metadata).toEqual(FLAG);
        expect(uploadArgs.params.ContentType).toBe("application/zip");
        expect(mockUploadDone).toHaveBeenCalled();
      });

      it("writes plaintext without Metadata when shouldEncrypt is false", async () => {
        cipher.shouldEncrypt.mockReturnValue(false);

        await service.uploadBufferWithKey({ buffer: PLAINTEXT, key: "judgements/a.txt", contentType: "text/plain" });

        const putArgs = lastPutArgs();
        expect(cipher.encrypt).not.toHaveBeenCalled();
        expect(putArgs.Body).toEqual(PLAINTEXT);
        expect(putArgs.Metadata).toBeUndefined();
      });

      it("the Azure branch writes ciphertext with the a360enc metadata", async () => {
        const { service: azureService } = await buildService(MOCK_AZURE_CONFIG);

        await azureService.uploadToAzureFromBuffer({ buffer: PLAINTEXT, key: "docs/a.txt", contentType: "text/plain" });

        const [body, length, options] = mockAzureBlockBlobClient.upload.mock.calls[0];
        expect(body).toEqual(CIPHERTEXT);
        expect(length).toBe(CIPHERTEXT.length);
        expect(options.metadata).toEqual(FLAG);
        expect(options.blobHTTPHeaders.blobContentType).toBe("text/plain");
      });
    });

    describe("decryption on read", () => {
      it.each(["downloadFileAsBuffer", "downloadFileBuffer", "downloadFileAsString", "getObjectContent"])(
        "%s decrypts a flagged object",
        async (method) => {
          mockS3Send.mockResolvedValue({ Body: s3Body(CIPHERTEXT), Metadata: FLAG, ContentType: "text/plain" });

          const result = await (service as any)[method]({ key: "docs/a.txt" });

          expect(cipher.decrypt).toHaveBeenCalledWith(CIPHERTEXT);
          const value = Buffer.isBuffer(result)
            ? result.toString("utf-8")
            : (result?.buffer?.toString("utf-8") ?? result);
          expect(value).toBe("hello world");
          if (method === "downloadFileBuffer") expect(result.contentType).toBe("text/plain");
        },
      );

      it("passes an unflagged object through without decrypting", async () => {
        mockS3Send.mockResolvedValue({ Body: s3Body(PLAINTEXT), ContentType: "text/plain" });

        const result = await service.downloadFileAsBuffer({ key: "judgements/a.txt" });

        expect(cipher.decrypt).not.toHaveBeenCalled();
        expect(result?.toString("utf-8")).toBe("hello world");
      });

      it("downloadFileAsStream pipes a flagged object through decryptStream", async () => {
        const decrypting = new PassThrough();
        cipher.decryptStream.mockReturnValue(decrypting);
        mockS3Send.mockResolvedValue({ Body: s3Body(CIPHERTEXT), Metadata: FLAG, ContentType: "text/plain" });

        const result = await service.downloadFileAsStream({ key: "docs/a.txt" });

        expect(cipher.decryptStream).toHaveBeenCalled();
        expect(result).toBe(decrypting);
      });

      it("the Azure branch decrypts a flagged blob", async () => {
        const { service: azureService } = await buildService(MOCK_AZURE_CONFIG);
        mockAzureBlobClient.download.mockResolvedValue({
          readableStreamBody: Readable.from([CIPHERTEXT]),
          metadata: FLAG,
          contentType: "text/plain",
        });

        const result = await azureService.downloadFileAsString({ key: "docs/a.txt" });

        expect(cipher.decrypt).toHaveBeenCalledWith(CIPHERTEXT);
        expect(result).toBe("hello world");
      });

      it("downloadObject decrypts a flagged object as a stream", async () => {
        const decrypting = new PassThrough();
        cipher.decryptStream.mockReturnValue(decrypting);
        mockS3Send.mockResolvedValue({ Body: s3Body(CIPHERTEXT), Metadata: FLAG, ContentType: "application/pdf" });

        const result = await service.downloadObject({ key: "docs/a.pdf" });

        expect(result).toEqual({ stream: decrypting, contentType: "application/pdf" });
      });

      // Stands in for the decrypt stream: swallows the stored bytes, emits only what the test pushes.
      const fakeDecryptor = (failWith?: Error) =>
        new Transform({
          transform(_chunk, _encoding, callback) {
            callback(failWith);
          },
        });

      it("downloadObject waits for the first decrypted chunk and keeps it in the stream", async () => {
        const decrypting = fakeDecryptor();
        cipher.decryptStream.mockReturnValue(decrypting);
        mockS3Send.mockResolvedValue({ Body: s3Body(CIPHERTEXT), Metadata: FLAG, ContentType: "application/pdf" });
        decrypting.push("first ");
        decrypting.push("second");

        const result = await service.downloadObject({ key: "docs/a.pdf" });

        const chunks: Buffer[] = [];
        for await (const chunk of result!.stream) chunks.push(Buffer.from(chunk));
        expect(Buffer.concat(chunks).toString()).toBe("first second");
      });

      it("downloadObject rejects, naming the object, when its key is not configured", async () => {
        cipher.decryptStream.mockReturnValue(fakeDecryptor(new S3CipherKeyMissingError(["k1"])));
        mockS3Send.mockResolvedValue({ Body: s3Body(CIPHERTEXT), Metadata: FLAG, ContentType: "application/pdf" });

        const error = await service.downloadObject({ key: "docs/a.pdf" }).catch((e) => e);

        expect(error).toBeInstanceOf(S3CipherKeyMissingError);
        expect(error.message).toBe(
          "S3 object docs/a.pdf is encrypted with key k1, which is not configured in S3_ENCRYPTION_KEY or S3_ENCRYPTION_RETIRED_KEYS",
        );
      });

      it("downloadObject passes through an unflagged object", async () => {
        const body = s3Body(PLAINTEXT);
        mockS3Send.mockResolvedValue({ Body: body, ContentType: "text/plain" });

        const result = await service.downloadObject({ key: "judgements/a.txt" });

        expect(cipher.decrypt).not.toHaveBeenCalled();
        expect(cipher.decryptStream).not.toHaveBeenCalled();
        expect(result).toEqual({ stream: body, contentType: "text/plain" });
      });

      it("downloadObject returns null for NoSuchKey", async () => {
        mockS3Send.mockRejectedValue(
          Object.assign(new Error("The specified key does not exist."), { name: "NoSuchKey" }),
        );

        await expect(service.downloadObject({ key: "missing.txt" })).resolves.toBeNull();
      });

      it("downloadObject returns null for an Azure 404", async () => {
        const { service: azureService } = await buildService(MOCK_AZURE_CONFIG);
        mockAzureBlobClient.download.mockRejectedValue(Object.assign(new Error("BlobNotFound"), { statusCode: 404 }));

        await expect(azureService.downloadObject({ key: "missing.txt" })).resolves.toBeNull();
      });

      it("downloadObject throws a clear error when flagged and canDecrypt is false", async () => {
        cipher.canDecrypt = false;
        mockS3Send.mockResolvedValue({ Body: s3Body(CIPHERTEXT), Metadata: FLAG, ContentType: "text/plain" });

        await expect(service.downloadObject({ key: "docs/a.txt" })).rejects.toThrow(/S3_ENCRYPTION_KEY/);
      });

      it.each(["downloadFileAsBuffer", "downloadFileAsString", "downloadFileAsStream"])(
        "%s throws instead of returning ciphertext when flagged and canDecrypt is false",
        async (method) => {
          cipher.canDecrypt = false;
          mockS3Send.mockResolvedValue({ Body: s3Body(CIPHERTEXT), Metadata: FLAG, ContentType: "text/plain" });

          await expect((service as any)[method]({ key: "docs/a.txt" })).rejects.toThrow(
            "S3 object docs/a.txt is encrypted but no matching S3_ENCRYPTION_KEY/RETIRED key is configured",
          );
        },
      );
    });

    describe("api URLs", () => {
      const API_URL = /^http:\/\/api\.test\/s3\/objects\/[^.]+\.[^.]+$/;
      const NOW = new Date("2026-10-08T10:30:00Z");
      const WINDOW_START = 1791453600; // 2026-10-08T10:00:00Z
      const DAY_START = 1791417600; // 2026-10-08T00:00:00Z
      const HOUR_WINDOW_CONFIG = { ...MOCK_S3_CONFIG, signingWindowSeconds: 3600 };
      const nowSeconds = () => Math.floor(Date.now() / 1000);
      const signInput = (call = 0) => cipher.signObjectToken.mock.calls[call][0] as Record<string, any>;

      let apiService: S3Service;
      let apiBuilder: MockedObject<JsonApiService>;

      beforeEach(async () => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        // Token derived from the signed input, as the real cipher's output is
        cipher.signObjectToken.mockImplementation(
          (input: Record<string, unknown>) => `${Buffer.from(JSON.stringify(input)).toString("base64url")}.c2ln`,
        );
        ({ service: apiService, builder: apiBuilder } = await buildService(HOUR_WINDOW_CONFIG));
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it.each([[true], [false]])("generateSignedUrl returns an api URL with the switch %s", async (on) => {
        cipher.enabled = on;
        cipher.shouldEncrypt.mockReturnValue(on);

        const url = await apiService.generateSignedUrl({ key: "docs/a.pdf" });

        expect(url).toMatch(API_URL);
        expect(signInput()).toMatchObject({ op: "get", key: "docs/a.pdf" });
      });

      it("generateSignedUrl returns an api URL for a plaintext-prefix key", async () => {
        cipher.enabled = true;
        cipher.shouldEncrypt.mockReturnValue(false);

        const url = await apiService.generateSignedUrl({ key: "judgements/j1/a.pdf" });

        expect(url).toMatch(API_URL);
        expect(signInput()).toMatchObject({ op: "get", key: "judgements/j1/a.pdf" });
      });

      it("generateSignedUrl carries the filename into the get token", async () => {
        await apiService.generateSignedUrl({ key: "docs/a.pdf", filename: "Atto.pdf" });

        expect(signInput()).toMatchObject({ op: "get", key: "docs/a.pdf", filename: "Atto.pdf" });
      });

      it("generatePresignedUrl returns storageType 'api' with the switch off", async () => {
        cipher.shouldEncrypt.mockReturnValue(false);

        await apiService.generatePresignedUrl({ key: "docs/a.pdf", contentType: "application/pdf", isPublic: true });

        const data = apiBuilder.buildSingle.mock.calls[0][1] as Record<string, any>;
        expect(data.url).toMatch(API_URL);
        expect(data.storageType).toBe("api");
        expect(data.contentType).toBe("application/pdf");
        expect(data.blobType).toBeUndefined();
        expect(data.acl).toBeUndefined();
      });

      it("findSignedUrl returns the api get URL", async () => {
        await apiService.findSignedUrl({ key: "docs/a.pdf" });

        const data = apiBuilder.buildSingle.mock.calls[0][1] as Record<string, any>;
        expect(data.url).toMatch(API_URL);
      });

      it("the Azure configuration returns api URLs too", async () => {
        cipher.shouldEncrypt.mockReturnValue(false);
        const { service: azureService, builder } = await buildService(MOCK_AZURE_CONFIG);

        const signed = await azureService.generateSignedUrl({ key: "docs/a.pdf" });
        await azureService.generatePresignedUrl({ key: "docs/a.pdf", contentType: "application/pdf", isPublic: false });

        expect(signed).toMatch(API_URL);
        const data = builder.buildSingle.mock.calls[0][1] as Record<string, any>;
        expect(data.url).toMatch(API_URL);
        expect(data.storageType).toBe("api");
        expect(data.blobType).toBeUndefined();
      });

      it("returns the identical get URL within one signing window", async () => {
        const first = await apiService.generateSignedUrl({ key: "photo.jpg" });
        vi.setSystemTime(new Date("2026-10-08T10:40:00Z"));
        const second = await apiService.generateSignedUrl({ key: "photo.jpg" });

        expect(second).toBe(first);
        expect(cipher.signObjectToken).toHaveBeenCalledTimes(2);
        expect(signInput(1).expiresAt).toBe(signInput(0).expiresAt);
      });

      it("returns a different get URL in the next window", async () => {
        const first = await apiService.generateSignedUrl({ key: "photo.jpg" });
        vi.setSystemTime(new Date("2026-10-08T11:30:00Z"));
        const second = await apiService.generateSignedUrl({ key: "photo.jpg" });

        expect(second).not.toBe(first);
        expect(signInput(1).expiresAt).toBe(signInput(0).expiresAt + 3600);
      });

      it("get expiry is at least now + ttl", async () => {
        await apiService.generateSignedUrl({ key: "photo.jpg" });

        expect(signInput().expiresAt).toBe(WINDOW_START + 3600 + 3600);
        expect(signInput().expiresAt).toBeGreaterThanOrEqual(nowSeconds() + 3600);
        expect(signInput().expiresInSeconds).toBeUndefined();

        // Worst case: the last second of the window still leaves the full ttl
        vi.setSystemTime(new Date("2026-10-08T10:59:59Z"));
        await apiService.generateSignedUrl({ key: "photo.jpg", ttl: 600 });
        expect(signInput(1).expiresAt).toBe(WINDOW_START + 600 + 3600);
        expect(signInput(1).expiresAt).toBeGreaterThanOrEqual(nowSeconds() + 600);
      });

      it("a 24-hour window floors to the UTC day", async () => {
        const { service: dayService } = await buildService({ ...MOCK_S3_CONFIG, signingWindowSeconds: 86400 });

        await dayService.generateSignedUrl({ key: "photo.jpg" });

        expect(signInput().expiresAt).toBe(DAY_START + 3600 + 86400);
      });

      it("isPublic get tokens carry no expiry", async () => {
        const url = await apiService.generateSignedUrl({ key: "avatars/a.png", isPublic: true });

        expect(url).toMatch(API_URL);
        expect(signInput()).toMatchObject({ op: "get", key: "avatars/a.png" });
        expect(signInput().expiresAt).toBeUndefined();
        expect(signInput().expiresInSeconds).toBeUndefined();
      });

      it("put tokens expire 3600 s from now, not windowed", async () => {
        await apiService.generatePresignedUrl({ key: "docs/a.pdf", contentType: "application/pdf", isPublic: false });

        expect(cipher.signObjectToken).toHaveBeenCalledWith({
          op: "put",
          key: "docs/a.pdf",
          contentType: "application/pdf",
          expiresInSeconds: 3600,
        });
        expect(signInput().expiresAt).toBeUndefined();
      });
    });
  });
});
