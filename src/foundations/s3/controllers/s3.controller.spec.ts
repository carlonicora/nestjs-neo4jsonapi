import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

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

import { Test, TestingModule } from "@nestjs/testing";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { S3Service } from "../services/s3.service";
import { S3Controller } from "./s3.controller";

describe("S3Controller", () => {
  let controller: S3Controller;
  let s3Service: vi.Mocked<S3Service>;

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
  };

  const mockSignedResponse = {
    data: {
      type: "s3-signed-urls",
      id: "1",
      attributes: {
        url: MOCK_SIGNED_URL,
        key: MOCK_KEY,
      },
    },
  };

  beforeEach(async () => {
    const mockS3Service = {
      generatePresignedUrl: vi.fn(),
      findSignedUrl: vi.fn(),
      deleteFileFromS3: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [S3Controller],
      providers: [{ provide: S3Service, useValue: mockS3Service }],
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

    it("should handle invalid key", async () => {
      s3Service.generatePresignedUrl.mockRejectedValue(new Error("Invalid key"));

      await expect(controller.getPresignedUrl("", MOCK_CONTENT_TYPE, true)).rejects.toThrow("Invalid key");
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

  describe("dependency injection", () => {
    it("should have s3Service injected", () => {
      expect(controller["service"]).toBeDefined();
    });
  });
});
