import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { Client, RepliableInteraction } from "discord.js";
import { DiscordService } from "../discord.service";

describe("DiscordService", () => {
  let service: DiscordService;
  let mockClient: ReturnType<typeof createMockClient>;

  const createMockClient = (isReady: boolean = true) => ({
    isReady: vi.fn().mockReturnValue(isReady),
    login: vi.fn(),
    destroy: vi.fn(),
  });

  const createMockInteraction = (
    options: {
      replied?: boolean;
      deferred?: boolean;
      replyFails?: boolean;
      editReplyFails?: boolean;
    } = {},
  ) => ({
    replied: options.replied ?? false,
    deferred: options.deferred ?? false,
    reply: options.replyFails
      ? vi.fn().mockRejectedValue(new Error("Reply failed"))
      : vi.fn().mockResolvedValue(undefined),
    editReply: options.editReplyFails
      ? vi.fn().mockRejectedValue(new Error("Edit reply failed"))
      : vi.fn().mockResolvedValue(undefined),
  });

  describe("with client injected", () => {
    beforeEach(async () => {
      vi.clearAllMocks();

      mockClient = createMockClient(true);

      const module: TestingModule = await Test.createTestingModule({
        providers: [DiscordService, { provide: Client, useValue: mockClient }],
      }).compile();

      service = module.get<DiscordService>(DiscordService);
    });

    afterEach(() => {
      vi.clearAllMocks();
    });

    describe("constructor", () => {
      it("should create the service", () => {
        expect(service).toBeDefined();
      });
    });

    describe("getClient", () => {
      it("should return the client", () => {
        // Act
        const result = service.getClient();

        // Assert
        expect(result).toBe(mockClient);
      });
    });

    describe("isReady", () => {
      it("should return true when client is ready", () => {
        // Act
        const result = service.isReady();

        // Assert
        expect(mockClient.isReady).toHaveBeenCalled();
        expect(result).toBe(true);
      });

      it("should return false when client is not ready", async () => {
        // Arrange
        mockClient = createMockClient(false);
        const module: TestingModule = await Test.createTestingModule({
          providers: [DiscordService, { provide: Client, useValue: mockClient }],
        }).compile();
        service = module.get<DiscordService>(DiscordService);

        // Act
        const result = service.isReady();

        // Assert
        expect(result).toBe(false);
      });
    });

    describe("isEnabled", () => {
      it("should return true when client is injected", () => {
        // Act
        const result = service.isEnabled();

        // Assert
        expect(result).toBe(true);
      });
    });

    describe("handleInteractionError", () => {
      it("should reply when interaction is not replied or deferred", async () => {
        // Arrange
        const mockInteraction = createMockInteraction();
        const error = new Error("Test error");

        // Act
        await service.handleInteractionError(mockInteraction as unknown as RepliableInteraction, error);

        // Assert
        expect(mockInteraction.reply).toHaveBeenCalledWith({
          content: "An error occurred while processing your command.",
          flags: 64,
        });
      });

      it("should use custom message when provided", async () => {
        // Arrange
        const mockInteraction = createMockInteraction();
        const error = new Error("Test error");
        const customMessage = "Custom error message";

        // Act
        await service.handleInteractionError(mockInteraction as unknown as RepliableInteraction, error, customMessage);

        // Assert
        expect(mockInteraction.reply).toHaveBeenCalledWith({
          content: customMessage,
          flags: 64,
        });
      });

      it("should edit reply when interaction is deferred", async () => {
        // Arrange
        const mockInteraction = createMockInteraction({ deferred: true });
        const error = new Error("Test error");

        // Act
        await service.handleInteractionError(mockInteraction as unknown as RepliableInteraction, error);

        // Assert
        expect(mockInteraction.editReply).toHaveBeenCalledWith({
          content: "An error occurred while processing your command.",
        });
        expect(mockInteraction.reply).not.toHaveBeenCalled();
      });

      it("should not reply when interaction is already replied", async () => {
        // Arrange
        const mockInteraction = createMockInteraction({ replied: true });
        const error = new Error("Test error");

        // Act
        await service.handleInteractionError(mockInteraction as unknown as RepliableInteraction, error);

        // Assert
        expect(mockInteraction.reply).not.toHaveBeenCalled();
        expect(mockInteraction.editReply).not.toHaveBeenCalled();
      });

      it("should handle reply failure gracefully", async () => {
        // Arrange
        const mockInteraction = createMockInteraction({ replyFails: true });
        const error = new Error("Test error");

        // Act - should not throw
        await expect(
          service.handleInteractionError(mockInteraction as unknown as RepliableInteraction, error),
        ).resolves.not.toThrow();
      });

      it("should handle edit reply failure gracefully", async () => {
        // Arrange
        const mockInteraction = createMockInteraction({ deferred: true, editReplyFails: true });
        const error = new Error("Test error");

        // Act - should not throw
        await expect(
          service.handleInteractionError(mockInteraction as unknown as RepliableInteraction, error),
        ).resolves.not.toThrow();
      });
    });
  });

  describe("without client injected", () => {
    beforeEach(async () => {
      vi.clearAllMocks();

      const module: TestingModule = await Test.createTestingModule({
        providers: [DiscordService],
      }).compile();

      service = module.get<DiscordService>(DiscordService);
    });

    describe("getClient", () => {
      it("should return undefined when no client is injected", () => {
        // Act
        const result = service.getClient();

        // Assert
        expect(result).toBeUndefined();
      });
    });

    describe("isReady", () => {
      it("should return false when no client is injected", () => {
        // Act
        const result = service.isReady();

        // Assert
        expect(result).toBe(false);
      });
    });

    describe("isEnabled", () => {
      it("should return false when no client is injected", () => {
        // Act
        const result = service.isEnabled();

        // Assert
        expect(result).toBe(false);
      });
    });
  });
});
