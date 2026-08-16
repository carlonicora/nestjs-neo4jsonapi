import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { AI_PROVIDER_REGISTRY, validateAiConnectionAttributes } from "../ai-provider.registry";

describe("AI_PROVIDER_REGISTRY", () => {
  it("defines providers for every connection type", () => {
    for (const type of ["ai", "aiLite", "aiLarge", "vision", "audio", "embedder", "transcriber", "documentAi"]) {
      expect(AI_PROVIDER_REGISTRY[type as keyof typeof AI_PROVIDER_REGISTRY].length).toBeGreaterThan(0);
    }
  });

  it("marks every apiKey and googleCredentialsBase64 field as secret", () => {
    for (const rows of Object.values(AI_PROVIDER_REGISTRY)) {
      for (const row of rows) {
        for (const f of row.fields) {
          if (f.field === "apiKey" || f.field === "googleCredentialsBase64") expect(f.kind).toBe("secret");
        }
      }
    }
  });
});

describe("validateAiConnectionAttributes", () => {
  it("accepts a valid azure chat connection", () => {
    expect(() =>
      validateAiConnectionAttributes({
        connectionType: "ai",
        provider: "azure",
        attributes: { instance: "my-instance", model: "gpt-5", apiKey: "sk-x", apiVersion: "2024-06-01" },
      }),
    ).not.toThrow();
  });

  it("rejects a missing required field", () => {
    expect(() =>
      validateAiConnectionAttributes({ connectionType: "ai", provider: "azure", attributes: { model: "gpt-5" } }),
    ).toThrow(BadRequestException);
  });

  it("rejects an unknown provider for the type", () => {
    expect(() =>
      validateAiConnectionAttributes({ connectionType: "transcriber", provider: "vertex", attributes: {} }),
    ).toThrow(BadRequestException);
  });

  it("rejects a field the provider does not declare", () => {
    expect(() =>
      validateAiConnectionAttributes({
        connectionType: "ai",
        provider: "ollama",
        attributes: { model: "gemma3:12b", instance: "nope" },
      }),
    ).toThrow(BadRequestException);
  });

  it("rejects a plaintext-http non-local url", () => {
    expect(() =>
      validateAiConnectionAttributes({
        connectionType: "ai",
        provider: "custom",
        attributes: { model: "m", url: "http://evil.example.com/v1" },
      }),
    ).toThrow();
  });
});
