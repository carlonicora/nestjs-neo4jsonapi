import { vi, describe, it, expect, beforeEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { OAuthRegistrationController } from "./oauth.registration.controller";
import { OAuthClientService } from "../services/oauth.client.service";

describe("OAuthRegistrationController", () => {
  let controller: OAuthRegistrationController;
  const clientService = {
    createClient: vi.fn().mockResolvedValue({
      client: {
        clientId: "cid_123",
        name: "Claude",
        redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
        allowedScopes: ["mcp"],
        allowedGrantTypes: ["authorization_code", "refresh_token"],
        isConfidential: false,
      },
      clientSecret: undefined,
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OAuthRegistrationController],
      providers: [
        { provide: OAuthClientService, useValue: clientService },
        { provide: ConfigService, useValue: { get: vi.fn().mockReturnValue({ enabled: true }) } },
      ],
    }).compile();
    controller = module.get(OAuthRegistrationController);
  });

  it("registers a public client from RFC 7591 metadata", async () => {
    const res = await controller.register({
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
      client_name: "Claude",
      grant_types: ["authorization_code", "refresh_token"],
      token_endpoint_auth_method: "none",
    } as any);
    expect(clientService.createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Claude",
        redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
        isConfidential: false,
      }),
    );
    expect(res.client_id).toBe("cid_123");
    expect(res.token_endpoint_auth_method).toBe("none");
    expect(res.client_secret).toBeUndefined();
  });
});
