import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBaseConfig } from "../base.config";

describe("mcp config block", () => {
  const KEYS = ["MCP_ENABLED", "MCP_SERVER_NAME", "MCP_INSTRUCTIONS", "MCP_PROMOTED_ENTITIES"];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("defaults: disabled, serverName neural-erp, empty promotedEntities", () => {
    const cfg = createBaseConfig();
    expect(cfg.mcp).toEqual({
      enabled: false,
      serverName: "neural-erp",
      instructions: undefined,
      promotedEntities: [],
    });
  });

  it("parses env", () => {
    process.env.MCP_ENABLED = "true";
    process.env.MCP_SERVER_NAME = "acme-erp";
    process.env.MCP_PROMOTED_ENTITIES = "orders, workOrders ,equipments";
    const cfg = createBaseConfig();
    expect(cfg.mcp.enabled).toBe(true);
    expect(cfg.mcp.serverName).toBe("acme-erp");
    expect(cfg.mcp.promotedEntities).toEqual(["orders", "workOrders", "equipments"]);
  });
});
