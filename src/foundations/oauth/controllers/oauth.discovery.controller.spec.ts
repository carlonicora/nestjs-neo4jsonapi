import { vi, describe, it, expect, beforeEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { OAuthDiscoveryController } from "./oauth.discovery.controller";

describe("OAuthDiscoveryController", () => {
  let controller: OAuthDiscoveryController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OAuthDiscoveryController],
      providers: [
        {
          provide: ConfigService,
          useValue: {
            get: vi.fn((k: string) =>
              k === "api"
                ? { url: "https://api.example.com" }
                : k === "app"
                  ? { url: "https://app.example.com" }
                  : { enabled: true },
            ),
          },
        },
      ],
    }).compile();
    controller = module.get(OAuthDiscoveryController);
  });

  it("authorization server metadata lists existing oauth routes", () => {
    const meta = controller.authorizationServer();
    expect(meta.issuer).toBe("https://api.example.com");
    // Browser-facing consent page lives on the WEB app, not the API
    expect(meta.authorization_endpoint).toBe("https://app.example.com/oauth/authorize");
    expect(meta.token_endpoint).toBe("https://api.example.com/oauth/token");
    expect(meta.registration_endpoint).toBe("https://api.example.com/oauth/register");
    expect(meta.code_challenge_methods_supported).toEqual(["S256"]);
    expect(meta.grant_types_supported).toContain("authorization_code");
  });

  it("protected resource metadata points at this server", () => {
    const meta = controller.protectedResource();
    expect(meta.resource).toBe("https://api.example.com/mcp");
    expect(meta.authorization_servers).toEqual(["https://api.example.com"]);
  });
});
