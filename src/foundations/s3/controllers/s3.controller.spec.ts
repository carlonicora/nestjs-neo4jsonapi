import { vi, describe, it, expect, beforeEach, afterEach, type Mocked } from "vitest";

// Mock guards before imports
vi.mock("../../../common/guards/jwt.auth.guard", () => ({
  JwtAuthGuard: class MockJwtAuthGuard {
    canActivate = vi.fn().mockReturnValue(true);
  },
}));

// Mock s3Meta
vi.mock("../entities/s3.meta", () => ({
  s3Meta: {
    type: "s3",
    endpoint: "s3",
    nodeName: "s3",
    labelName: "S3",
  },
  S3_OBJECTS_SEGMENT: "objects",
}));

// Mock S3 service
vi.mock("../services/s3.service", () => ({
  S3Service: vi.fn().mockImplementation(() => ({
    generatePresignedUrl: vi.fn(),
    findSignedUrl: vi.fn(),
    deleteFileFromS3: vi.fn(),
    uploadStream: vi.fn(),
    downloadObject: vi.fn(),
    contentDispositionAttachment: vi.fn(),
    contentDispositionInline: vi.fn(),
    contentDispositionInlineFilename: vi.fn(),
  })),
}));

// Mock S3 cipher service
vi.mock("../services/s3-cipher.service", () => ({
  S3CipherService: class MockS3CipherService {},
}));

import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  PayloadTooLargeException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { ClsService } from "nestjs-cls";
import { Readable } from "stream";
import { S3CipherKeyMissingError, S3ObjectTokenError } from "../cipher/s3-cipher.core";
import { S3CipherService } from "../services/s3-cipher.service";
import { S3ClientKeyService } from "../services/s3-client-key.service";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { S3_KEY_ACCESS_POLICY, S3KeyAccessPolicy } from "../../../common/interfaces/s3.key-access.policy.interface";
import { S3Service } from "../services/s3.service";
import { S3Controller } from "./s3.controller";
import {
  TRUSTED_ORIGINS_RESOLVER,
  TrustedOriginsResolver,
} from "../../../core/cors/interfaces/trusted-origins.resolver.interface";

const CLS_VALUES: Record<string, unknown> = {
  userId: "user-1",
  companyId: "company-1",
  roles: ["role-1"],
};

const mockClsService = { get: vi.fn((key: string) => CLS_VALUES[key]) };

let appUrl = "";
const mockConfigService = { get: vi.fn((key: string) => (key === "app" ? { url: appUrl } : undefined)) };

describe("S3Controller", () => {
  let controller: S3Controller;
  let s3Service: Mocked<S3Service>;
  let cipher: { uploadMaxBytes: number; verifyObjectToken: ReturnType<typeof vi.fn> };

  // Test data constants
  const MOCK_KEY = "uploads/user-123/image.png";
  const MOCK_CONTENT_TYPE = "image/png";
  const MOCK_PRESIGNED_URL = "https://s3.amazonaws.com/bucket/uploads/user-123/image.png?X-Amz-Signature=abc123";
  const MOCK_SIGNED_URL = "https://cdn.example.com/uploads/user-123/image.png?token=xyz789";

  const mockPresignedResponse = {
    data: {
      type: "s3-presigned-urls",
      id: "1",
      attributes: {
        url: MOCK_PRESIGNED_URL,
        key: MOCK_KEY,
        expiresAt: new Date().toISOString(),
      },
    },
  } as unknown as Awaited<ReturnType<S3Service["generatePresignedUrl"]>>;

  const mockSignedResponse = {
    data: {
      type: "s3-signed-urls",
      id: "1",
      attributes: {
        url: MOCK_SIGNED_URL,
        key: MOCK_KEY,
      },
    },
  } as unknown as Awaited<ReturnType<S3Service["findSignedUrl"]>>;

  beforeEach(async () => {
    const mockS3Service = {
      generatePresignedUrl: vi.fn(),
      findSignedUrl: vi.fn(),
      deleteFileFromS3: vi.fn(),
      uploadStream: vi.fn(),
      downloadObject: vi.fn(),
      contentDispositionAttachment: vi.fn(),
      contentDispositionInline: vi.fn(),
      contentDispositionInlineFilename: vi.fn(),
    };
    cipher = { uploadMaxBytes: 1024, verifyObjectToken: vi.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [S3Controller],
      providers: [
        { provide: S3Service, useValue: mockS3Service },
        { provide: ClsService, useValue: mockClsService },
        S3ClientKeyService,
        { provide: S3CipherService, useValue: cipher },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<S3Controller>(S3Controller);
    s3Service = module.get(S3Service);
  });

  afterEach(() => {
    vi.clearAllMocks();
    appUrl = "";
  });

  describe("getPresignedUrl", () => {
    it("should generate presigned URL for public file", async () => {
      s3Service.generatePresignedUrl.mockResolvedValue(mockPresignedResponse);

      const result = await controller.getPresignedUrl(MOCK_KEY, MOCK_CONTENT_TYPE, true);

      expect(s3Service.generatePresignedUrl).toHaveBeenCalledWith({
        key: MOCK_KEY,
        contentType: MOCK_CONTENT_TYPE,
        isPublic: true,
      });
      expect(result).toEqual(mockPresignedResponse);
    });

    it("should generate presigned URL for private file", async () => {
      s3Service.generatePresignedUrl.mockResolvedValue(mockPresignedResponse);

      const result = await controller.getPresignedUrl(MOCK_KEY, MOCK_CONTENT_TYPE, false);

      expect(s3Service.generatePresignedUrl).toHaveBeenCalledWith({
        key: MOCK_KEY,
        contentType: MOCK_CONTENT_TYPE,
        isPublic: false,
      });
      expect(result).toEqual(mockPresignedResponse);
    });

    it("should handle different content types", async () => {
      s3Service.generatePresignedUrl.mockResolvedValue(mockPresignedResponse);

      await controller.getPresignedUrl("document.pdf", "application/pdf", false);

      expect(s3Service.generatePresignedUrl).toHaveBeenCalledWith({
        key: "document.pdf",
        contentType: "application/pdf",
        isPublic: false,
      });
    });

    it("should handle service errors", async () => {
      s3Service.generatePresignedUrl.mockRejectedValue(new Error("S3 configuration error"));

      await expect(controller.getPresignedUrl(MOCK_KEY, MOCK_CONTENT_TYPE, true)).rejects.toThrow(
        "S3 configuration error",
      );
    });

    it("should reject an empty key before calling the service", async () => {
      await expect(controller.getPresignedUrl("", MOCK_CONTENT_TYPE, true)).rejects.toThrow(BadRequestException);
      expect(s3Service.generatePresignedUrl).not.toHaveBeenCalled();
    });
  });

  describe("getSignedUrl", () => {
    it("should get signed URL for public file", async () => {
      s3Service.findSignedUrl.mockResolvedValue(mockSignedResponse);

      const result = await controller.getSignedUrl(MOCK_KEY, true);

      expect(s3Service.findSignedUrl).toHaveBeenCalledWith({
        key: MOCK_KEY,
        isPublic: true,
      });
      expect(result).toEqual(mockSignedResponse);
    });

    it("should get signed URL for private file", async () => {
      s3Service.findSignedUrl.mockResolvedValue(mockSignedResponse);

      const result = await controller.getSignedUrl(MOCK_KEY, false);

      expect(s3Service.findSignedUrl).toHaveBeenCalledWith({
        key: MOCK_KEY,
        isPublic: false,
      });
      expect(result).toEqual(mockSignedResponse);
    });

    it("should handle service errors", async () => {
      s3Service.findSignedUrl.mockRejectedValue(new Error("File not found"));

      await expect(controller.getSignedUrl(MOCK_KEY, false)).rejects.toThrow("File not found");
    });

    it("should handle expired URLs", async () => {
      s3Service.findSignedUrl.mockRejectedValue(new Error("URL expired"));

      await expect(controller.getSignedUrl(MOCK_KEY, true)).rejects.toThrow("URL expired");
    });
  });

  describe("deleteFile", () => {
    it("should delete file from S3", async () => {
      s3Service.deleteFileFromS3.mockResolvedValue(undefined);

      await controller.deleteFile(MOCK_KEY);

      expect(s3Service.deleteFileFromS3).toHaveBeenCalledWith({
        key: MOCK_KEY,
      });
    });

    it("should handle deletion errors", async () => {
      s3Service.deleteFileFromS3.mockRejectedValue(new Error("Access denied"));

      await expect(controller.deleteFile(MOCK_KEY)).rejects.toThrow("Access denied");
    });

    it("should handle non-existent file deletion", async () => {
      s3Service.deleteFileFromS3.mockRejectedValue(new Error("File not found"));

      await expect(controller.deleteFile("non-existent-file.png")).rejects.toThrow("File not found");
    });

    it("should handle different file paths", async () => {
      s3Service.deleteFileFromS3.mockResolvedValue(undefined);

      await controller.deleteFile("uploads/company-456/documents/report.pdf");

      expect(s3Service.deleteFileFromS3).toHaveBeenCalledWith({
        key: "uploads/company-456/documents/report.pdf",
      });
    });
  });

  describe("malformed keys (always rejected, no policy bound)", () => {
    const MALFORMED = ["", "   ", "/companies/c1/a.pdf", "companies/c1/../c2/a.pdf", "..", "companies/../x"];

    it.each(MALFORMED)("getPresignedUrl rejects %j with 400", async (key) => {
      await expect(controller.getPresignedUrl(key, MOCK_CONTENT_TYPE, false)).rejects.toThrow(BadRequestException);
      expect(s3Service.generatePresignedUrl).not.toHaveBeenCalled();
    });

    it.each(MALFORMED)("getSignedUrl rejects %j with 400", async (key) => {
      await expect(controller.getSignedUrl(key, false)).rejects.toThrow(BadRequestException);
      expect(s3Service.findSignedUrl).not.toHaveBeenCalled();
    });

    it.each(MALFORMED)("deleteFile rejects %j with 400", async (key) => {
      await expect(controller.deleteFile(key)).rejects.toThrow(BadRequestException);
      expect(s3Service.deleteFileFromS3).not.toHaveBeenCalled();
    });

    it("rejects a missing key (undefined query param) with 400", async () => {
      await expect(controller.getSignedUrl(undefined as unknown as string, false)).rejects.toThrow(BadRequestException);
      expect(s3Service.findSignedUrl).not.toHaveBeenCalled();
    });

    it("accepts a key whose segment merely contains dots", async () => {
      s3Service.findSignedUrl.mockResolvedValue(mockSignedResponse);

      await controller.getSignedUrl("companies/c1/report..v2.pdf", false);

      expect(s3Service.findSignedUrl).toHaveBeenCalled();
    });
  });

  describe("with a bound S3_KEY_ACCESS_POLICY", () => {
    let policy: { canAccess: ReturnType<typeof vi.fn> };
    let guarded: S3Controller;
    let guardedService: Mocked<S3Service>;

    beforeEach(async () => {
      policy = { canAccess: vi.fn() };
      const module: TestingModule = await Test.createTestingModule({
        controllers: [S3Controller],
        providers: [
          {
            provide: S3Service,
            useValue: { generatePresignedUrl: vi.fn(), findSignedUrl: vi.fn(), deleteFileFromS3: vi.fn() },
          },
          { provide: ClsService, useValue: mockClsService },
          S3ClientKeyService,
          { provide: S3CipherService, useValue: { uploadMaxBytes: 1024, verifyObjectToken: vi.fn() } },
          { provide: ConfigService, useValue: mockConfigService },
          { provide: S3_KEY_ACCESS_POLICY, useValue: policy as S3KeyAccessPolicy },
        ],
      })
        .overrideGuard(JwtAuthGuard)
        .useValue({ canActivate: () => true })
        .compile();

      guarded = module.get<S3Controller>(S3Controller);
      guardedService = module.get(S3Service);
    });

    it("getPresignedUrl: policy refusal -> 403 and the service is not called", async () => {
      policy.canAccess.mockResolvedValue(false);

      await expect(guarded.getPresignedUrl(MOCK_KEY, MOCK_CONTENT_TYPE, true)).rejects.toThrow(ForbiddenException);
      expect(guardedService.generatePresignedUrl).not.toHaveBeenCalled();
    });

    it("getSignedUrl: policy refusal -> 403 and the service is not called", async () => {
      policy.canAccess.mockReturnValue(false);

      await expect(guarded.getSignedUrl(MOCK_KEY, false)).rejects.toThrow(ForbiddenException);
      expect(guardedService.findSignedUrl).not.toHaveBeenCalled();
    });

    it("deleteFile: policy refusal -> 403 and the service is not called", async () => {
      policy.canAccess.mockResolvedValue(false);

      await expect(guarded.deleteFile(MOCK_KEY)).rejects.toThrow(ForbiddenException);
      expect(guardedService.deleteFileFromS3).not.toHaveBeenCalled();
    });

    it("hands the policy the key, the action and the CLS caller (upload)", async () => {
      policy.canAccess.mockResolvedValue(true);
      guardedService.generatePresignedUrl.mockResolvedValue(mockPresignedResponse);

      await guarded.getPresignedUrl(MOCK_KEY, MOCK_CONTENT_TYPE, "true" as unknown as boolean);

      expect(policy.canAccess).toHaveBeenCalledWith({
        key: MOCK_KEY,
        action: "upload",
        isPublic: true,
        userId: "user-1",
        companyId: "company-1",
        roles: ["role-1"],
      });
      expect(guardedService.generatePresignedUrl).toHaveBeenCalled();
    });

    it("asks for download on sign and delete on delete", async () => {
      policy.canAccess.mockResolvedValue(true);

      await guarded.getSignedUrl(MOCK_KEY, undefined as unknown as boolean);
      await guarded.deleteFile(MOCK_KEY);

      expect(policy.canAccess.mock.calls[0][0]).toMatchObject({ action: "download", isPublic: false });
      expect(policy.canAccess.mock.calls[1][0]).toMatchObject({ action: "delete", isPublic: false });
      expect(guardedService.findSignedUrl).toHaveBeenCalled();
      expect(guardedService.deleteFileFromS3).toHaveBeenCalledWith({ key: MOCK_KEY });
    });

    it("rejects a malformed key with 400 without consulting the policy", async () => {
      await expect(guarded.getSignedUrl("companies/c1/../c2/a.pdf", false)).rejects.toThrow(BadRequestException);
      expect(policy.canAccess).not.toHaveBeenCalled();
    });
  });

  describe("permanent get tokens and the bound policy", () => {
    const ID_DOC_KEY = "companies/c/id-documents/x/front.jpg";
    const makeReply = () => ({
      status: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
      removeHeader: vi.fn().mockReturnThis(),
      send: vi.fn(),
    });

    const build = async (policy?: Partial<S3KeyAccessPolicy>) => {
      const verifyObjectToken = vi.fn();
      const service = {
        downloadObject: vi.fn().mockResolvedValue({ stream: Readable.from(["data"]), contentType: "image/jpeg" }),
        contentDispositionAttachment: vi.fn(),
        contentDispositionInline: vi.fn(),
        contentDispositionInlineFilename: vi.fn(),
      };
      const module: TestingModule = await Test.createTestingModule({
        controllers: [S3Controller],
        providers: [
          { provide: S3Service, useValue: service },
          { provide: ClsService, useValue: mockClsService },
          S3ClientKeyService,
          { provide: S3CipherService, useValue: { uploadMaxBytes: 1024, verifyObjectToken } },
          { provide: ConfigService, useValue: mockConfigService },
          ...(policy ? [{ provide: S3_KEY_ACCESS_POLICY, useValue: policy }] : []),
        ],
      })
        .overrideGuard(JwtAuthGuard)
        .useValue({ canActivate: () => true })
        .compile();
      return { ctrl: module.get<S3Controller>(S3Controller), verifyObjectToken, service };
    };

    it("refuses a token without expiry whose key the policy rejects (401)", async () => {
      const policy = { canAccess: vi.fn(), isPermanentKey: vi.fn().mockReturnValue(false) };
      const { ctrl, verifyObjectToken, service } = await build(policy);
      verifyObjectToken.mockReturnValue({ o: "get", k: ID_DOC_KEY });
      const reply = makeReply();

      await expect(ctrl.getObject(reply as any, "token")).rejects.toThrow(
        new UnauthorizedException("Permanent object token not allowed for this key"),
      );
      expect(policy.isPermanentKey).toHaveBeenCalledWith(ID_DOC_KEY);
      expect(service.downloadObject).not.toHaveBeenCalled();
      expect(reply.send).not.toHaveBeenCalled();
    });

    it("streams a token without expiry when no policy is bound (unchanged)", async () => {
      const { ctrl, verifyObjectToken, service } = await build();
      verifyObjectToken.mockReturnValue({ o: "get", k: ID_DOC_KEY });
      const reply = makeReply();

      await ctrl.getObject(reply as any, "token");

      expect(service.downloadObject).toHaveBeenCalledWith({ key: ID_DOC_KEY });
      expect(reply.send).toHaveBeenCalled();
    });

    it("streams a token without expiry when the policy has no isPermanentKey (unchanged)", async () => {
      const { ctrl, verifyObjectToken, service } = await build({ canAccess: vi.fn() });
      verifyObjectToken.mockReturnValue({ o: "get", k: ID_DOC_KEY });
      const reply = makeReply();

      await ctrl.getObject(reply as any, "token");

      expect(service.downloadObject).toHaveBeenCalledWith({ key: ID_DOC_KEY });
    });

    it("streams a token without expiry whose key the policy allows", async () => {
      const policy = { canAccess: vi.fn(), isPermanentKey: vi.fn().mockReturnValue(true) };
      const { ctrl, verifyObjectToken, service } = await build(policy);
      verifyObjectToken.mockReturnValue({ o: "get", k: "howtos/slug/01.png" });
      const reply = makeReply();

      await ctrl.getObject(reply as any, "token");

      expect(service.downloadObject).toHaveBeenCalledWith({ key: "howtos/slug/01.png" });
    });

    it("streams an expiring token even when the policy rejects the key as permanent", async () => {
      const policy = { canAccess: vi.fn(), isPermanentKey: vi.fn().mockReturnValue(false) };
      const { ctrl, verifyObjectToken, service } = await build(policy);
      verifyObjectToken.mockReturnValue({ o: "get", k: ID_DOC_KEY, e: Math.floor(Date.now() / 1000) + 3600 });
      const reply = makeReply();

      await ctrl.getObject(reply as any, "token");

      expect(service.downloadObject).toHaveBeenCalledWith({ key: ID_DOC_KEY });
      expect(reply.send).toHaveBeenCalled();
    });
  });

  describe("isServableKey", () => {
    const CORPUS_KEY = "judgements/2026/abc.pdf";
    const EXPIRY = () => Math.floor(Date.now() / 1000) + 3600;
    const makeReply = () => ({
      status: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
      removeHeader: vi.fn().mockReturnThis(),
      send: vi.fn(),
    });

    const build = async (policy: Partial<S3KeyAccessPolicy>) => {
      const verifyObjectToken = vi.fn();
      const service = {
        uploadStream: vi.fn(),
        downloadObject: vi.fn().mockResolvedValue({ stream: Readable.from(["data"]), contentType: "application/pdf" }),
        contentDispositionAttachment: vi.fn(),
        contentDispositionInline: vi.fn(),
        contentDispositionInlineFilename: vi.fn(),
      };
      const module: TestingModule = await Test.createTestingModule({
        controllers: [S3Controller],
        providers: [
          { provide: S3Service, useValue: service },
          { provide: ClsService, useValue: mockClsService },
          S3ClientKeyService,
          { provide: S3CipherService, useValue: { uploadMaxBytes: 1024, verifyObjectToken } },
          { provide: ConfigService, useValue: mockConfigService },
          { provide: S3_KEY_ACCESS_POLICY, useValue: policy },
        ],
      })
        .overrideGuard(JwtAuthGuard)
        .useValue({ canActivate: () => true })
        .compile();
      return { ctrl: module.get<S3Controller>(S3Controller), verifyObjectToken, service };
    };

    it("GET /s3/objects/:token answers 403 and never reads storage when the policy refuses the key", async () => {
      const { ctrl, verifyObjectToken, service } = await build({ canAccess: vi.fn(), isServableKey: () => false });
      verifyObjectToken.mockReturnValue({ o: "get", k: CORPUS_KEY, e: EXPIRY() });
      const reply = makeReply();

      await expect(ctrl.getObject(reply as any, "token")).rejects.toThrow(ForbiddenException);
      expect(service.downloadObject).not.toHaveBeenCalled();
      expect(reply.send).not.toHaveBeenCalled();
    });

    it("PUT /s3/objects/:token answers 403 and never writes when the policy refuses the key", async () => {
      const { ctrl, verifyObjectToken, service } = await build({ canAccess: vi.fn(), isServableKey: () => false });
      verifyObjectToken.mockReturnValue({ o: "put", k: CORPUS_KEY, c: "application/pdf", e: EXPIRY() });
      const reply = makeReply();
      const req = { body: Readable.from([Buffer.alloc(5, 1)]) } as any;

      await expect(ctrl.putObject(req, reply as any, "token")).rejects.toThrow(ForbiddenException);
      expect(service.uploadStream).not.toHaveBeenCalled();
      expect(reply.send).not.toHaveBeenCalled();
    });

    it("serves the key when isServableKey returns true", async () => {
      const isServableKey = vi.fn().mockReturnValue(true);
      const { ctrl, verifyObjectToken, service } = await build({ canAccess: vi.fn(), isServableKey });
      verifyObjectToken.mockReturnValue({ o: "get", k: MOCK_KEY, e: EXPIRY() });
      const reply = makeReply();

      await ctrl.getObject(reply as any, "token");

      expect(isServableKey).toHaveBeenCalledWith(MOCK_KEY);
      expect(service.downloadObject).toHaveBeenCalledWith({ key: MOCK_KEY });
      expect(reply.send).toHaveBeenCalled();
    });

    it("serves the key when the policy does not implement isServableKey", async () => {
      const { ctrl, verifyObjectToken, service } = await build({ canAccess: vi.fn() });
      verifyObjectToken.mockReturnValue({ o: "get", k: CORPUS_KEY, e: EXPIRY() });
      const reply = makeReply();

      await ctrl.getObject(reply as any, "token");

      expect(service.downloadObject).toHaveBeenCalledWith({ key: CORPUS_KEY });
      expect(reply.send).toHaveBeenCalled();
    });
  });

  describe("object token routes", () => {
    const makeReply = () => ({
      status: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
      removeHeader: vi.fn().mockReturnThis(),
      send: vi.fn(),
    });
    const makeRequest = (bytes: number) => ({ body: Readable.from([Buffer.alloc(bytes, 1)]) }) as any;
    const consume = async ({ stream }: { stream: Readable }) => {
      for await (const _chunk of stream) {
        // drain
      }
    };

    it("PUT /s3/objects/:token verifies a put token and uploads the body stream with the token's content type", async () => {
      cipher.verifyObjectToken.mockReturnValue({ o: "put", k: "k", c: "application/pdf" });
      s3Service.uploadStream.mockImplementation(consume);
      const reply = makeReply();

      await controller.putObject(makeRequest(5), reply as any, "token");

      expect(cipher.verifyObjectToken).toHaveBeenCalledWith("token", "put");
      expect(s3Service.uploadStream).toHaveBeenCalledWith(
        expect.objectContaining({ key: "k", contentType: "application/pdf" }),
      );
      expect(reply.status).toHaveBeenCalledWith(204);
      expect(reply.send).toHaveBeenCalled();
    });

    it("PUT /s3/objects/:token answers 401 for a bad token", async () => {
      cipher.verifyObjectToken.mockImplementation(() => {
        throw new S3ObjectTokenError("signature", "Invalid signature");
      });
      const reply = makeReply();

      await expect(controller.putObject(makeRequest(5), reply as any, "token")).rejects.toThrow(UnauthorizedException);
      expect(s3Service.uploadStream).not.toHaveBeenCalled();
      expect(reply.send).not.toHaveBeenCalled();
    });

    it("PUT /s3/objects rejects a body over the cap with 413", async () => {
      cipher.uploadMaxBytes = 10;
      cipher.verifyObjectToken.mockReturnValue({ o: "put", k: "k", c: "application/pdf" });
      let streamErrored = false;
      s3Service.uploadStream.mockImplementation(async ({ stream }: { stream: Readable }) => {
        stream.on("error", () => {
          streamErrored = true;
        });
        await consume({ stream });
      });
      const reply = makeReply();

      await expect(controller.putObject(makeRequest(11), reply as any, "token")).rejects.toThrow(
        PayloadTooLargeException,
      );
      expect(streamErrored).toBe(true);
      expect(reply.status).not.toHaveBeenCalledWith(204);
    });

    it("PUT /s3/objects enforces the token's own limit when it is below the global cap", async () => {
      cipher.uploadMaxBytes = 1024;
      cipher.verifyObjectToken.mockReturnValue({ o: "put", k: "k", c: "image/png", m: 4 });
      let streamErrored = false;
      s3Service.uploadStream.mockImplementation(async ({ stream }: { stream: Readable }) => {
        stream.on("error", () => {
          streamErrored = true;
        });
        await consume({ stream });
      });
      const reply = makeReply();

      const error = await controller.putObject(makeRequest(5), reply as any, "token").catch((e) => e);

      expect(error).toBeInstanceOf(PayloadTooLargeException);
      expect(error.message).toBe("Upload exceeds 4 bytes");
      expect(streamErrored).toBe(true);
      expect(reply.status).not.toHaveBeenCalledWith(204);
    });

    it("GET /s3/objects/:token streams the object, keeping a permanent link's file for one hour", async () => {
      cipher.verifyObjectToken.mockReturnValue({ o: "get", k: "k" });
      const stream = Readable.from(["data"]);
      s3Service.downloadObject.mockResolvedValue({ stream, contentType: "application/pdf" });
      const reply = makeReply();

      await controller.getObject(reply as any, "token");

      expect(cipher.verifyObjectToken).toHaveBeenCalledWith("token", "get");
      expect(s3Service.downloadObject).toHaveBeenCalledWith({ key: "k" });
      expect(reply.header).toHaveBeenCalledWith("Content-Type", "application/pdf");
      expect(reply.header).toHaveBeenCalledWith("Cache-Control", "private, max-age=3600");
      expect(reply.header).toHaveBeenCalledWith("Accept-Ranges", "none");
      expect(reply.send).toHaveBeenCalledWith(stream);
    });

    it("GET /s3/objects names an inline object after its key, so saving it keeps the file name", async () => {
      cipher.verifyObjectToken.mockReturnValue({ o: "get", k: "companies/c/documents/d/1/atto è.pdf" });
      s3Service.downloadObject.mockResolvedValue({ stream: Readable.from(["data"]), contentType: "application/pdf" });
      s3Service.contentDispositionInline.mockReturnValue(
        `inline; filename="atto _.pdf"; filename*=UTF-8''atto%20%C3%A8.pdf`,
      );
      const reply = makeReply();

      await controller.getObject(reply as any, "token");

      expect(s3Service.contentDispositionInline).toHaveBeenCalledWith("companies/c/documents/d/1/atto è.pdf");
      expect(s3Service.contentDispositionAttachment).not.toHaveBeenCalled();
      expect(reply.header).toHaveBeenCalledWith(
        "Content-Disposition",
        `inline; filename="atto _.pdf"; filename*=UTF-8''atto%20%C3%A8.pdf`,
      );
    });

    it("GET /s3/objects lets the browser keep an expiring link's file until the link expires", async () => {
      vi.useFakeTimers({ now: new Date("2026-10-13T10:00:00Z") });
      try {
        const now = Math.floor(Date.now() / 1000);
        cipher.verifyObjectToken.mockReturnValue({ o: "get", k: "k", e: now + 5400 });
        s3Service.downloadObject.mockResolvedValue({ stream: Readable.from(["data"]), contentType: "image/png" });
        const reply = makeReply();

        await controller.getObject(reply as any, "token");

        expect(reply.header).toHaveBeenCalledWith("Cache-Control", "private, max-age=5400");
      } finally {
        vi.useRealTimers();
      }
    });

    it.each(["get", "put"] as const)("%s /s3/objects answers 400 for a signed key containing ..", async (op) => {
      cipher.verifyObjectToken.mockReturnValue({ o: op, k: "companies/../b", c: "image/png" });
      const reply = makeReply();

      const call =
        op === "get"
          ? controller.getObject(reply as any, "token")
          : controller.putObject(makeRequest(5), reply as any, "token");

      await expect(call).rejects.toThrow(BadRequestException);
      expect(s3Service.downloadObject).not.toHaveBeenCalled();
      expect(s3Service.uploadStream).not.toHaveBeenCalled();
    });

    it("GET /s3/objects answers 500 naming the key when the object's key is not configured", async () => {
      cipher.verifyObjectToken.mockReturnValue({ o: "get", k: "docs/a.pdf" });
      s3Service.downloadObject.mockRejectedValue(new S3CipherKeyMissingError(["k1"], "docs/a.pdf"));
      const reply = makeReply();

      const error = await controller.getObject(reply as any, "token").catch((e) => e);

      expect(error).toBeInstanceOf(InternalServerErrorException);
      expect(error.message).toContain("encrypted with key k1");
      expect(reply.send).not.toHaveBeenCalled();
    });

    it("GET /s3/objects falls back to application/octet-stream", async () => {
      cipher.verifyObjectToken.mockReturnValue({ o: "get", k: "k" });
      s3Service.downloadObject.mockResolvedValue({ stream: Readable.from(["data"]), contentType: undefined });
      const reply = makeReply();

      await controller.getObject(reply as any, "token");

      expect(reply.header).toHaveBeenCalledWith("Content-Type", "application/octet-stream");
    });

    it("GET /s3/objects sets an RFC 6266 attachment disposition", async () => {
      cipher.verifyObjectToken.mockReturnValue({ o: "get", k: "k", f: "preventivo è.pdf" });
      s3Service.downloadObject.mockResolvedValue({ stream: Readable.from(["data"]), contentType: "application/pdf" });
      s3Service.contentDispositionAttachment.mockReturnValue(
        `attachment; filename="preventivo _.pdf"; filename*=UTF-8''preventivo%20%C3%A8.pdf`,
      );
      const reply = makeReply();

      await controller.getObject(reply as any, "token");

      expect(s3Service.contentDispositionAttachment).toHaveBeenCalledWith("preventivo è.pdf");
      expect(s3Service.contentDispositionInlineFilename).not.toHaveBeenCalled();
      expect(reply.header).toHaveBeenCalledWith(
        "Content-Disposition",
        `attachment; filename="preventivo _.pdf"; filename*=UTF-8''preventivo%20%C3%A8.pdf`,
      );
    });

    it("GET /s3/objects serves inline under the token's file name when the token says inline", async () => {
      cipher.verifyObjectToken.mockReturnValue({ o: "get", k: "companies/c/documents/d/1.pdf", f: "Doc.pdf", i: 1 });
      s3Service.downloadObject.mockResolvedValue({ stream: Readable.from(["data"]), contentType: "application/pdf" });
      s3Service.contentDispositionInlineFilename.mockReturnValue(
        `inline; filename="Doc.pdf"; filename*=UTF-8''Doc.pdf`,
      );
      const reply = makeReply();

      await controller.getObject(reply as any, "token");

      expect(s3Service.contentDispositionInlineFilename).toHaveBeenCalledWith("Doc.pdf");
      expect(s3Service.contentDispositionAttachment).not.toHaveBeenCalled();
      expect(s3Service.contentDispositionInline).not.toHaveBeenCalled();
      expect(reply.header).toHaveBeenCalledWith(
        "Content-Disposition",
        `inline; filename="Doc.pdf"; filename*=UTF-8''Doc.pdf`,
      );
    });

    it("lets the web app frame a downloaded object", async () => {
      appUrl = "http://app.test/";
      cipher.verifyObjectToken.mockReturnValue({ o: "get", k: "k" });
      s3Service.downloadObject.mockResolvedValue({ stream: Readable.from(["data"]), contentType: "application/pdf" });
      const reply = makeReply();

      await controller.getObject(reply as any, "token");

      expect(reply.header).toHaveBeenCalledWith("Content-Security-Policy", "frame-ancestors http://app.test");
      expect(reply.removeHeader).toHaveBeenCalledWith("X-Frame-Options");
    });

    it("leaves framing headers alone without an app url", async () => {
      appUrl = "";
      cipher.verifyObjectToken.mockReturnValue({ o: "get", k: "k" });
      s3Service.downloadObject.mockResolvedValue({ stream: Readable.from(["data"]), contentType: "application/pdf" });
      const reply = makeReply();

      await controller.getObject(reply as any, "token");

      expect(reply.header).not.toHaveBeenCalledWith("Content-Security-Policy", expect.anything());
      expect(reply.removeHeader).not.toHaveBeenCalled();
      expect(reply.send).toHaveBeenCalled();
    });

    describe("with a bound TRUSTED_ORIGINS_RESOLVER", () => {
      const buildWithResolver = async (resolver: TrustedOriginsResolver) => {
        const module: TestingModule = await Test.createTestingModule({
          controllers: [S3Controller],
          providers: [
            { provide: S3Service, useValue: s3Service },
            { provide: ClsService, useValue: mockClsService },
            S3ClientKeyService,
            { provide: S3CipherService, useValue: cipher },
            { provide: ConfigService, useValue: mockConfigService },
            { provide: TRUSTED_ORIGINS_RESOLVER, useValue: resolver },
          ],
        })
          .overrideGuard(JwtAuthGuard)
          .useValue({ canActivate: () => true })
          .compile();
        return module.get<S3Controller>(S3Controller);
      };

      const frameAncestorsFor = async (ctrl: S3Controller) => {
        cipher.verifyObjectToken.mockReturnValue({ o: "get", k: "k" });
        s3Service.downloadObject.mockResolvedValue({
          stream: Readable.from(["data"]),
          contentType: "application/pdf",
        });
        const reply = makeReply();
        await ctrl.getObject(reply as any, "token");
        const headers = Object.fromEntries((reply.header as any).mock.calls as [string, string][]);
        return { headers, reply };
      };

      it("lists the app origin and every resolver origin in frame-ancestors", async () => {
        appUrl = "https://studioai.avvocato360.it/";
        const ctrl = await buildWithResolver({
          isTrusted: vi.fn(),
          listOrigins: vi.fn().mockResolvedValue(["https://clienti.rossi.it"]),
        });

        const { headers, reply } = await frameAncestorsFor(ctrl);

        expect(headers["Content-Security-Policy"]).toBe(
          "frame-ancestors https://studioai.avvocato360.it https://clienti.rossi.it",
        );
        expect(reply.removeHeader).toHaveBeenCalledWith("X-Frame-Options");
      });

      it("drops duplicate origins", async () => {
        appUrl = "https://studioai.avvocato360.it/";
        const ctrl = await buildWithResolver({
          isTrusted: vi.fn(),
          listOrigins: vi
            .fn()
            .mockResolvedValue([
              "https://clienti.rossi.it",
              "https://studioai.avvocato360.it",
              "https://clienti.rossi.it",
            ]),
        });

        const { headers } = await frameAncestorsFor(ctrl);

        expect(headers["Content-Security-Policy"]).toBe(
          "frame-ancestors https://studioai.avvocato360.it https://clienti.rossi.it",
        );
      });

      it("falls back to the app origin alone when the resolver throws", async () => {
        appUrl = "https://studioai.avvocato360.it/";
        const ctrl = await buildWithResolver({
          isTrusted: vi.fn(),
          listOrigins: vi.fn().mockRejectedValue(new Error("boom")),
        });

        const { headers } = await frameAncestorsFor(ctrl);

        expect(headers["Content-Security-Policy"]).toBe("frame-ancestors https://studioai.avvocato360.it");
      });
    });

    it("falls back to the app origin alone without a resolver", async () => {
      appUrl = "https://studioai.avvocato360.it/";
      cipher.verifyObjectToken.mockReturnValue({ o: "get", k: "k" });
      s3Service.downloadObject.mockResolvedValue({ stream: Readable.from(["data"]), contentType: "application/pdf" });
      const reply = makeReply();

      await controller.getObject(reply as any, "token");

      expect(reply.header).toHaveBeenCalledWith(
        "Content-Security-Policy",
        "frame-ancestors https://studioai.avvocato360.it",
      );
    });

    it("GET /s3/objects answers 404 when downloadObject returns null", async () => {
      cipher.verifyObjectToken.mockReturnValue({ o: "get", k: "k" });
      s3Service.downloadObject.mockResolvedValue(null);
      const reply = makeReply();

      await controller.getObject(reply as any, "token");

      expect(reply.status).toHaveBeenCalledWith(404);
      expect(reply.send).toHaveBeenCalledWith({ errors: [{ status: "404", title: "Not Found" }] });
    });

    it("GET /s3/objects answers 401 for an expired token", async () => {
      cipher.verifyObjectToken.mockImplementation(() => {
        throw new S3ObjectTokenError("expired", "Token expired");
      });
      const reply = makeReply();

      await expect(controller.getObject(reply as any, "token")).rejects.toThrow(UnauthorizedException);
      expect(s3Service.downloadObject).not.toHaveBeenCalled();
      expect(reply.send).not.toHaveBeenCalled();
    });
  });

  describe("served content type and disposition (uploaded objects never render as active content)", () => {
    const makeReply = () => ({
      status: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
      removeHeader: vi.fn().mockReturnThis(),
      send: vi.fn(),
    });
    const headerOf = (reply: ReturnType<typeof makeReply>, name: string) =>
      reply.header.mock.calls.filter(([key]) => key === name).map(([, value]) => value);

    beforeEach(() => {
      s3Service.contentDispositionAttachment.mockImplementation((name: string) => `attachment; filename="${name}"`);
      s3Service.contentDispositionInline.mockImplementation((key: string) => `inline; key="${key}"`);
      s3Service.contentDispositionInlineFilename.mockImplementation((name: string) => `inline; filename="${name}"`);
    });

    it.each(["application/pdf", "image/png", "image/jpeg", "text/html", "image/svg+xml", undefined])(
      "always sends X-Content-Type-Options: nosniff (stored type %s)",
      async (contentType) => {
        cipher.verifyObjectToken.mockReturnValue({ o: "get", k: "companies/c/x" });
        s3Service.downloadObject.mockResolvedValue({ stream: Readable.from(["data"]), contentType });
        const reply = makeReply();

        await controller.getObject(reply as any, "token");

        expect(headerOf(reply, "X-Content-Type-Options")).toEqual(["nosniff"]);
      },
    );

    it.each([
      "text/html",
      "text/html; charset=utf-8",
      "image/svg+xml",
      "application/xhtml+xml",
      "text/xml",
      "application/javascript",
    ])(
      "serves a stored %s object as an octet-stream attachment, even when the token asks for inline",
      async (contentType) => {
        cipher.verifyObjectToken.mockReturnValue({ o: "get", k: "companies/c/page.html", f: "page.html", i: 1 });
        s3Service.downloadObject.mockResolvedValue({ stream: Readable.from(["data"]), contentType });
        const reply = makeReply();

        await controller.getObject(reply as any, "token");

        expect(headerOf(reply, "Content-Type")).toEqual(["application/octet-stream"]);
        expect(headerOf(reply, "Content-Disposition")).toEqual([`attachment; filename="page.html"`]);
        expect(s3Service.contentDispositionInline).not.toHaveBeenCalled();
        expect(s3Service.contentDispositionInlineFilename).not.toHaveBeenCalled();
      },
    );

    it("names an unsafe object without a token file name after the last key segment, as an attachment", async () => {
      cipher.verifyObjectToken.mockReturnValue({ o: "get", k: "companies/c/x/evil%20page.svg" });
      s3Service.downloadObject.mockResolvedValue({ stream: Readable.from(["data"]), contentType: "image/svg+xml" });
      const reply = makeReply();

      await controller.getObject(reply as any, "token");

      expect(headerOf(reply, "Content-Disposition")).toEqual([`attachment; filename="evil page.svg"`]);
      expect(headerOf(reply, "Content-Type")).toEqual(["application/octet-stream"]);
    });

    it.each([
      ["image/png", { o: "get", k: "companies/c/a.png" }, `inline; key="companies/c/a.png"`],
      ["application/pdf", { o: "get", k: "companies/c/a.pdf", f: "Atto.pdf", i: 1 }, `inline; filename="Atto.pdf"`],
      ["IMAGE/JPEG", { o: "get", k: "companies/c/a.jpg" }, `inline; key="companies/c/a.jpg"`],
    ])("keeps a stored %s object inline with its own type", async (contentType, token, disposition) => {
      cipher.verifyObjectToken.mockReturnValue(token);
      s3Service.downloadObject.mockResolvedValue({ stream: Readable.from(["data"]), contentType });
      const reply = makeReply();

      await controller.getObject(reply as any, "token");

      expect(headerOf(reply, "Content-Type")).toEqual([contentType]);
      expect(headerOf(reply, "Content-Disposition")).toEqual([disposition]);
    });

    it.each(["text/html", "TEXT/HTML; charset=utf-8", "image/svg+xml", "application/xhtml+xml"])(
      "presign refuses contentType %s with 400 and never signs a put token",
      async (contentType) => {
        await expect(controller.getPresignedUrl("companies/company-1/x", contentType, false)).rejects.toThrow(
          BadRequestException,
        );
        expect(s3Service.generatePresignedUrl).not.toHaveBeenCalled();
      },
    );

    it.each([
      "application/pdf",
      "image/png",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ])("presign still signs contentType %s", async (contentType) => {
      s3Service.generatePresignedUrl.mockResolvedValue(mockPresignedResponse);

      await controller.getPresignedUrl("companies/company-1/x", contentType, false);

      expect(s3Service.generatePresignedUrl).toHaveBeenCalledWith(expect.objectContaining({ contentType }));
    });
  });

  describe("dependency injection", () => {
    it("should have s3Service injected", () => {
      expect(controller["service"]).toBeDefined();
    });
  });
});
