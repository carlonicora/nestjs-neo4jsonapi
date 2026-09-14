import { describe, expect, it } from "vitest";
import { ModelService } from "../model.service";

/**
 * The predicate reads config through the service's own resolution path, so the
 * double supplies a ConfigService-shaped `get`. The real constructor is
 * `(clsService, configService, ...optional)` — only the config is exercised here,
 * so the cls slot takes a stub and every optional dependency is omitted, which
 * is exactly the no-resolver shape `envCandidate` is written for.
 */
function makeService(ai: Record<string, unknown>): ModelService {
  const clsService = { get: () => undefined, set: () => undefined };
  const configService = {
    get: (key: string) => (key === "ai" ? ai : { env: "development", api: { env: "development" } }),
  };
  return new ModelService(clsService as any, configService as any) as ModelService;
}

const embedder = { provider: "openai", apiKey: "k", model: "text-embedding-3-large", url: "", dimensions: 3072 };
const chat = { provider: "openai", apiKey: "k", model: "gpt-5", url: "" };

describe("ModelService.isAiConfigured", () => {
  it("is false when nothing is configured", () => {
    expect(
      makeService({
        embedder: { provider: "", apiKey: "", model: "", dimensions: 0 },
        ai: { provider: "", apiKey: "", model: "" },
      }).isAiConfigured(),
    ).toBe(false);
  });

  it("is false when the embedder has no dimensions", () => {
    expect(makeService({ embedder: { ...embedder, dimensions: 0 }, ai: chat }).isAiConfigured()).toBe(false);
  });

  it("is false when the chat tier has no model", () => {
    expect(makeService({ embedder, ai: { ...chat, model: "" } }).isAiConfigured()).toBe(false);
  });

  it("is true without an apiKey when provider and model are set", () => {
    expect(
      makeService({
        embedder: { ...embedder, apiKey: "" },
        ai: { ...chat, apiKey: "", url: "http://localhost:11434/v1" },
      }).isAiConfigured(),
    ).toBe(true);
  });

  it("is true under MOCK_AI on embedder dimensions alone", () => {
    expect(
      makeService({
        mock: true,
        embedder: { provider: "", apiKey: "", model: "", dimensions: 1536 },
        ai: { provider: "", apiKey: "", model: "" },
      }).isAiConfigured(),
    ).toBe(true);
  });

  it("is false under MOCK_AI with no dimensions", () => {
    expect(
      makeService({
        mock: true,
        embedder: { provider: "", apiKey: "", model: "", dimensions: 0 },
        ai: chat,
      }).isAiConfigured(),
    ).toBe(false);
  });
});
