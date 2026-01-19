import { describe, it, expect, beforeEach, vi } from "vitest";
import { HttpException } from "@nestjs/common";
import { OAuthClientService } from "./oauth.client.service";
import { OAuthRepository } from "../repositories/oauth.repository";
import { OAuthClient } from "../entities/oauth.client.entity";

describe("OAuthClientService", () => {
  let clientService: OAuthClientService;
  let mockRepository: Partial<OAuthRepository>;

  const mockClient: OAuthClient = {
    id: "client-uuid",
    type: "oauth-clients",
    clientId: "test-client-id",
    clientSecretHash: "hashed-secret",
    name: "Test App",
    description: "A test application",
    redirectUris: ["https://example.com/callback"],
    allowedScopes: ["read", "write"],
    allowedGrantTypes: ["authorization_code", "refresh_token"],
    isConfidential: true,
    isActive: true,
    accessTokenLifetime: 3600,
    refreshTokenLifetime: 604800,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    mockRepository = {
      createClient: vi.fn().mockResolvedValue({ client: mockClient, clientSecret: "raw-secret" }),
      findClientByClientId: vi.fn().mockResolvedValue(mockClient),
      findClientsByOwnerId: vi.fn().mockResolvedValue([mockClient]),
      updateClient: vi.fn().mockResolvedValue(mockClient),
      regenerateClientSecret: vi.fn().mockResolvedValue({ clientSecret: "new-secret" }),
      deleteClient: vi.fn().mockResolvedValue(undefined),
    };

    clientService = new OAuthClientService(mockRepository as OAuthRepository);
  });

  describe("createClient", () => {
    it("should create a confidential client with secret", async () => {
      const result = await clientService.createClient({
        name: "Test App",
        redirectUris: ["https://example.com/callback"],
        allowedScopes: ["read"],
        ownerId: "user-id",
        companyId: "company-id",
      });

      expect(result.client).toBeDefined();
      expect(result.clientSecret).toBeDefined();
      expect(mockRepository.createClient).toHaveBeenCalled();
    });

    it("should reject invalid redirect URI", async () => {
      await expect(
        clientService.createClient({
          name: "Test App",
          redirectUris: ["not-a-valid-uri"],
          allowedScopes: ["read"],
          ownerId: "user-id",
          companyId: "company-id",
        }),
      ).rejects.toThrow(HttpException);
    });

    it("should reject invalid scope", async () => {
      await expect(
        clientService.createClient({
          name: "Test App",
          redirectUris: ["https://example.com/callback"],
          allowedScopes: ["invalid-scope"],
          ownerId: "user-id",
          companyId: "company-id",
        }),
      ).rejects.toThrow(HttpException);
    });

    it("should reject client_credentials for public clients", async () => {
      await expect(
        clientService.createClient({
          name: "Test App",
          redirectUris: ["https://example.com/callback"],
          allowedScopes: ["read"],
          allowedGrantTypes: ["client_credentials"],
          isConfidential: false,
          ownerId: "user-id",
          companyId: "company-id",
        }),
      ).rejects.toThrow(HttpException);
    });
  });

  describe("getClient", () => {
    it("should return client for valid clientId", async () => {
      const result = await clientService.getClient("test-client-id");
      expect(result).toBeDefined();
      expect(result?.clientId).toBe("test-client-id");
    });

    it("should return null for unknown client", async () => {
      mockRepository.findClientByClientId = vi.fn().mockResolvedValue(null);
      const result = await clientService.getClient("unknown-client");
      expect(result).toBeNull();
    });
  });

  describe("validateClient", () => {
    it("should return null for unknown client", async () => {
      mockRepository.findClientByClientId = vi.fn().mockResolvedValue(null);
      const result = await clientService.validateClient("unknown-client");
      expect(result).toBeNull();
    });

    it("should return null for inactive client", async () => {
      mockRepository.findClientByClientId = vi.fn().mockResolvedValue({
        ...mockClient,
        isActive: false,
      });
      const result = await clientService.validateClient("test-client");
      expect(result).toBeNull();
    });

    it("should return client for valid public client", async () => {
      mockRepository.findClientByClientId = vi.fn().mockResolvedValue({
        ...mockClient,
        isConfidential: false,
        clientSecretHash: null,
      });
      const result = await clientService.validateClient("test-client");
      expect(result).toBeDefined();
    });
  });

  describe("validateRedirectUri", () => {
    it("should accept registered URI", () => {
      const result = clientService.validateRedirectUri(mockClient, "https://example.com/callback");
      expect(result).toBe(true);
    });

    it("should reject unregistered URI", () => {
      const result = clientService.validateRedirectUri(mockClient, "https://evil.com/callback");
      expect(result).toBe(false);
    });
  });

  describe("validateScopes", () => {
    it("should accept valid scopes", () => {
      const result = clientService.validateScopes(mockClient, ["read"]);
      expect(result).toBe(true);
    });

    it("should accept empty scopes", () => {
      const result = clientService.validateScopes(mockClient, []);
      expect(result).toBe(true);
    });

    it("should reject invalid scopes", () => {
      const result = clientService.validateScopes(mockClient, ["admin"]);
      expect(result).toBe(false);
    });
  });

  describe("validateGrantType", () => {
    it("should accept allowed grant type", () => {
      const result = clientService.validateGrantType(mockClient, "authorization_code");
      expect(result).toBe(true);
    });

    it("should reject disallowed grant type", () => {
      const result = clientService.validateGrantType(mockClient, "client_credentials");
      expect(result).toBe(false);
    });
  });

  describe("updateClient", () => {
    it("should update client with valid data", async () => {
      const result = await clientService.updateClient("test-client-id", {
        name: "Updated Name",
      });
      expect(mockRepository.updateClient).toHaveBeenCalledWith("test-client-id", {
        name: "Updated Name",
      });
      expect(result).toBeDefined();
    });

    it("should reject invalid redirect URIs on update", async () => {
      await expect(
        clientService.updateClient("test-client-id", {
          redirectUris: ["not-a-valid-uri"],
        }),
      ).rejects.toThrow(HttpException);
    });
  });

  describe("regenerateSecret", () => {
    it("should regenerate secret for confidential client", async () => {
      const result = await clientService.regenerateSecret("test-client-id");
      expect(result.clientSecret).toBeDefined();
      expect(mockRepository.regenerateClientSecret).toHaveBeenCalled();
    });

    it("should reject regeneration for unknown client", async () => {
      mockRepository.findClientByClientId = vi.fn().mockResolvedValue(null);
      await expect(clientService.regenerateSecret("unknown")).rejects.toThrow(HttpException);
    });

    it("should reject regeneration for public client", async () => {
      mockRepository.findClientByClientId = vi.fn().mockResolvedValue({
        ...mockClient,
        isConfidential: false,
      });
      await expect(clientService.regenerateSecret("test-client-id")).rejects.toThrow(HttpException);
    });
  });

  describe("deleteClient", () => {
    it("should delete existing client", async () => {
      await clientService.deleteClient("test-client-id");
      expect(mockRepository.deleteClient).toHaveBeenCalledWith("test-client-id");
    });

    it("should reject deletion of unknown client", async () => {
      mockRepository.findClientByClientId = vi.fn().mockResolvedValue(null);
      await expect(clientService.deleteClient("unknown")).rejects.toThrow(HttpException);
    });
  });
});
