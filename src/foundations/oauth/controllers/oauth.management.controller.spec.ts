import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Mock guards before imports
vi.mock("../../../common/guards/jwt.auth.guard", () => ({
  JwtAuthGuard: class MockJwtAuthGuard {
    canActivate = vi.fn().mockReturnValue(true);
  },
}));

// Mock OAuth client service
vi.mock("../services/oauth.client.service", () => ({
  OAuthClientService: vi.fn().mockImplementation(() => ({
    getClientsByOwner: vi.fn(),
    createClient: vi.fn(),
    getClient: vi.fn(),
    updateClient: vi.fn(),
    deleteClient: vi.fn(),
    regenerateSecret: vi.fn(),
  })),
}));

// Mock nestjs-cls
vi.mock("nestjs-cls", () => ({
  ClsService: vi.fn().mockImplementation(() => ({
    get: vi.fn(),
  })),
}));

import { HttpException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { ClsService } from "nestjs-cls";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { OAuthClientCreateDto, OAuthClientUpdateDto } from "../dtos/oauth.client.dto";
import { OAuthClientService } from "../services/oauth.client.service";
import { OAuthManagementController } from "./oauth.management.controller";

describe("OAuthManagementController", () => {
  let controller: OAuthManagementController;
  let clientService: vi.Mocked<OAuthClientService>;
  let clsService: vi.Mocked<ClsService>;

  // Test data constants
  const MOCK_USER_ID = "550e8400-e29b-41d4-a716-446655440000";
  const MOCK_OTHER_USER_ID = "550e8400-e29b-41d4-a716-446655440099";
  const MOCK_COMPANY_ID = "660e8400-e29b-41d4-a716-446655440001";
  const MOCK_CLIENT_ID = "770e8400-e29b-41d4-a716-446655440002";
  const MOCK_CLIENT_SECRET = "secret_abc123";

  const mockClient = {
    clientId: MOCK_CLIENT_ID,
    name: "Test App",
    description: "A test application",
    redirectUris: ["https://example.com/callback"],
    allowedScopes: ["read", "write"],
    allowedGrantTypes: ["authorization_code", "refresh_token"],
    isConfidential: true,
    isActive: true,
    accessTokenLifetime: 3600,
    refreshTokenLifetime: 86400,
    owner: { id: MOCK_USER_ID },
  };

  beforeEach(async () => {
    const mockClientService = {
      getClientsByOwner: vi.fn(),
      createClient: vi.fn(),
      getClient: vi.fn(),
      updateClient: vi.fn(),
      deleteClient: vi.fn(),
      regenerateSecret: vi.fn(),
    };

    const mockClsService = {
      get: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OAuthManagementController],
      providers: [
        { provide: OAuthClientService, useValue: mockClientService },
        { provide: ClsService, useValue: mockClsService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<OAuthManagementController>(OAuthManagementController);
    clientService = module.get(OAuthClientService);
    clsService = module.get(ClsService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("list", () => {
    it("should return user's OAuth clients", async () => {
      clsService.get.mockReturnValue(MOCK_USER_ID);
      clientService.getClientsByOwner.mockResolvedValue([mockClient]);

      const result = await controller.list();

      expect(clsService.get).toHaveBeenCalledWith("userId");
      expect(clientService.getClientsByOwner).toHaveBeenCalledWith(MOCK_USER_ID);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].type).toBe("oauth-clients");
      expect(result.data[0].id).toBe(MOCK_CLIENT_ID);
      expect(result.data[0].attributes.name).toBe("Test App");
    });

    it("should return empty array when user has no clients", async () => {
      clsService.get.mockReturnValue(MOCK_USER_ID);
      clientService.getClientsByOwner.mockResolvedValue([]);

      const result = await controller.list();

      expect(result.data).toHaveLength(0);
    });

    it("should handle service errors", async () => {
      clsService.get.mockReturnValue(MOCK_USER_ID);
      clientService.getClientsByOwner.mockRejectedValue(new Error("Database error"));

      await expect(controller.list()).rejects.toThrow("Database error");
    });
  });

  describe("create", () => {
    const createDto: OAuthClientCreateDto = {
      data: {
        type: "oauth-clients",
        attributes: {
          name: "New App",
          description: "A new application",
          redirectUris: ["https://newapp.com/callback"],
          allowedScopes: ["read"],
          allowedGrantTypes: ["authorization_code"],
          isConfidential: true,
          accessTokenLifetime: 7200,
          refreshTokenLifetime: 172800,
        },
      },
    };

    it("should create a new OAuth client and return with secret", async () => {
      clsService.get.mockImplementation((key: string) => {
        if (key === "userId") return MOCK_USER_ID;
        if (key === "companyId") return MOCK_COMPANY_ID;
        return undefined;
      });
      clientService.createClient.mockResolvedValue({
        client: { ...mockClient, name: "New App" },
        clientSecret: MOCK_CLIENT_SECRET,
      });

      const result = await controller.create(createDto);

      expect(clientService.createClient).toHaveBeenCalledWith({
        name: "New App",
        description: "A new application",
        redirectUris: ["https://newapp.com/callback"],
        allowedScopes: ["read"],
        allowedGrantTypes: ["authorization_code"],
        isConfidential: true,
        accessTokenLifetime: 7200,
        refreshTokenLifetime: 172800,
        ownerId: MOCK_USER_ID,
        companyId: MOCK_COMPANY_ID,
      });
      expect(result.data.attributes.clientSecret).toBe(MOCK_CLIENT_SECRET);
    });

    it("should handle service errors during creation", async () => {
      clsService.get.mockReturnValue(MOCK_USER_ID);
      clientService.createClient.mockRejectedValue(new Error("Creation failed"));

      await expect(controller.create(createDto)).rejects.toThrow("Creation failed");
    });
  });

  describe("get", () => {
    it("should return client when user is owner", async () => {
      clsService.get.mockReturnValue(MOCK_USER_ID);
      clientService.getClient.mockResolvedValue(mockClient);

      const result = await controller.get(MOCK_CLIENT_ID);

      expect(clientService.getClient).toHaveBeenCalledWith(MOCK_CLIENT_ID);
      expect(result.data.id).toBe(MOCK_CLIENT_ID);
      expect(result.data.attributes.name).toBe("Test App");
    });

    it("should throw 404 when client not found", async () => {
      clsService.get.mockReturnValue(MOCK_USER_ID);
      clientService.getClient.mockResolvedValue(null);

      await expect(controller.get(MOCK_CLIENT_ID)).rejects.toThrow(new HttpException("Client not found", 404));
    });

    it("should throw 403 when user is not owner", async () => {
      clsService.get.mockReturnValue(MOCK_OTHER_USER_ID);
      clientService.getClient.mockResolvedValue(mockClient);

      await expect(controller.get(MOCK_CLIENT_ID)).rejects.toThrow(new HttpException("Access denied", 403));
    });
  });

  describe("update", () => {
    const updateDto: OAuthClientUpdateDto = {
      data: {
        type: "oauth-clients",
        id: MOCK_CLIENT_ID,
        attributes: {
          name: "Updated App",
          description: "Updated description",
          redirectUris: ["https://updated.com/callback"],
          allowedScopes: ["read", "write", "admin"],
          isActive: false,
        },
      },
    };

    it("should update client when user is owner", async () => {
      clsService.get.mockReturnValue(MOCK_USER_ID);
      clientService.getClient.mockResolvedValue(mockClient);
      clientService.updateClient.mockResolvedValue({ ...mockClient, name: "Updated App" });

      const result = await controller.update(MOCK_CLIENT_ID, updateDto);

      expect(clientService.getClient).toHaveBeenCalledWith(MOCK_CLIENT_ID);
      expect(clientService.updateClient).toHaveBeenCalledWith(MOCK_CLIENT_ID, {
        name: "Updated App",
        description: "Updated description",
        redirectUris: ["https://updated.com/callback"],
        allowedScopes: ["read", "write", "admin"],
        isActive: false,
      });
      expect(result.data.attributes.name).toBe("Updated App");
    });

    it("should throw 404 when client not found", async () => {
      clsService.get.mockReturnValue(MOCK_USER_ID);
      clientService.getClient.mockResolvedValue(null);

      await expect(controller.update(MOCK_CLIENT_ID, updateDto)).rejects.toThrow(
        new HttpException("Client not found", 404),
      );
      expect(clientService.updateClient).not.toHaveBeenCalled();
    });

    it("should throw 403 when user is not owner", async () => {
      clsService.get.mockReturnValue(MOCK_OTHER_USER_ID);
      clientService.getClient.mockResolvedValue(mockClient);

      await expect(controller.update(MOCK_CLIENT_ID, updateDto)).rejects.toThrow(
        new HttpException("Access denied", 403),
      );
      expect(clientService.updateClient).not.toHaveBeenCalled();
    });
  });

  describe("delete", () => {
    it("should delete client when user is owner", async () => {
      clsService.get.mockReturnValue(MOCK_USER_ID);
      clientService.getClient.mockResolvedValue(mockClient);
      clientService.deleteClient.mockResolvedValue(undefined);

      await controller.delete(MOCK_CLIENT_ID);

      expect(clientService.getClient).toHaveBeenCalledWith(MOCK_CLIENT_ID);
      expect(clientService.deleteClient).toHaveBeenCalledWith(MOCK_CLIENT_ID);
    });

    it("should throw 404 when client not found", async () => {
      clsService.get.mockReturnValue(MOCK_USER_ID);
      clientService.getClient.mockResolvedValue(null);

      await expect(controller.delete(MOCK_CLIENT_ID)).rejects.toThrow(new HttpException("Client not found", 404));
      expect(clientService.deleteClient).not.toHaveBeenCalled();
    });

    it("should throw 403 when user is not owner", async () => {
      clsService.get.mockReturnValue(MOCK_OTHER_USER_ID);
      clientService.getClient.mockResolvedValue(mockClient);

      await expect(controller.delete(MOCK_CLIENT_ID)).rejects.toThrow(new HttpException("Access denied", 403));
      expect(clientService.deleteClient).not.toHaveBeenCalled();
    });
  });

  describe("regenerateSecret", () => {
    it("should regenerate secret when user is owner", async () => {
      clsService.get.mockReturnValue(MOCK_USER_ID);
      clientService.getClient.mockResolvedValue(mockClient);
      clientService.regenerateSecret.mockResolvedValue({ clientSecret: "new_secret_xyz" });

      const result = await controller.regenerateSecret(MOCK_CLIENT_ID);

      expect(clientService.getClient).toHaveBeenCalledWith(MOCK_CLIENT_ID);
      expect(clientService.regenerateSecret).toHaveBeenCalledWith(MOCK_CLIENT_ID);
      expect(result.data.attributes.clientSecret).toBe("new_secret_xyz");
      expect(result.data.id).toBe(MOCK_CLIENT_ID);
    });

    it("should throw 404 when client not found", async () => {
      clsService.get.mockReturnValue(MOCK_USER_ID);
      clientService.getClient.mockResolvedValue(null);

      await expect(controller.regenerateSecret(MOCK_CLIENT_ID)).rejects.toThrow(
        new HttpException("Client not found", 404),
      );
      expect(clientService.regenerateSecret).not.toHaveBeenCalled();
    });

    it("should throw 403 when user is not owner", async () => {
      clsService.get.mockReturnValue(MOCK_OTHER_USER_ID);
      clientService.getClient.mockResolvedValue(mockClient);

      await expect(controller.regenerateSecret(MOCK_CLIENT_ID)).rejects.toThrow(
        new HttpException("Access denied", 403),
      );
      expect(clientService.regenerateSecret).not.toHaveBeenCalled();
    });
  });

  describe("dependency injection", () => {
    it("should have clientService injected", () => {
      expect(controller["clientService"]).toBeDefined();
    });

    it("should have clsService injected", () => {
      expect(controller["cls"]).toBeDefined();
    });
  });
});
