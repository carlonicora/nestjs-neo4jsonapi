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
}));

// Mock S3 service
vi.mock("../services/s3.service", () => ({
  S3Service: vi.fn().mockImplementation(() => ({
    generatePresignedUrl: vi.fn(),
    findSignedUrl: vi.fn(),
    deleteFileFromS3: vi.fn(),
  })),
}));

import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { ClsService } from "nestjs-cls";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { S3_KEY_ACCESS_POLICY, S3KeyAccessPolicy } from "../../../common/interfaces/s3.key-access.policy.interface";
import { S3Service } from "../services/s3.service";
import { S3Controller } from "./s3.controller";

const CLS_VALUES: Record<string, unknown> = {
  userId: "user-1",
  companyId: "company-1",
  roles: ["role-1"],
};

const mockClsService = { get: vi.fn((key: string) => CLS_VALUES[key]) };

describe("S3Controller", () => {
  let controller: S3Controller;
  let s3Service: Mocked<S3Service>;

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
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [S3Controller],
      providers: [
        { provide: S3Service, useValue: mockS3Service },
        { provide: ClsService, useValue: mockClsService },
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

  describe("dependency injection", () => {
    it("should have s3Service injected", () => {
      expect(controller["service"]).toBeDefined();
    });
  });
});
