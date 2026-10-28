import { afterEach, describe, expect, it, vi } from "vitest";
import type { Mocked } from "vitest";
import { ConfigService } from "@nestjs/config";
import { CommunityLayerService } from "../community-layer.service";
import { GraphCatalogService } from "../../../../agents/graph/services/graph.catalog.service";
import type { CatalogEntity } from "../../../../agents/graph/interfaces/graph.catalog.interface";
import { entityTenancyRegistry } from "../../../../common/registries/entity-tenancy.registry";

const campaignEntity = {
  type: "campaigns",
  labelName: "Campaign",
  nodeName: "campaign",
  scope: { path: [], rootType: "campaigns", rootLabel: "Campaign" },
} as unknown as CatalogEntity;

const makeConfig = (community?: { scope?: string }): Mocked<ConfigService> =>
  ({
    get: vi.fn((key: string) => (key === "community" ? community : undefined)),
  }) as unknown as Mocked<ConfigService>;

const makeCatalog = (entities: CatalogEntity[]): Mocked<GraphCatalogService> =>
  ({
    getAllEntities: vi.fn(() => entities),
    buildCatalog: vi.fn(),
  }) as unknown as Mocked<GraphCatalogService>;

describe("CommunityLayerService", () => {
  afterEach(() => {
    entityTenancyRegistry.unregister("Campaign");
  });

  it("returns undefined when community.scope is not set", () => {
    const service = new CommunityLayerService(makeConfig(undefined));
    expect(() => service.onApplicationBootstrap()).not.toThrow();
    expect(service.current()).toBeUndefined();

    const withEmpty = new CommunityLayerService(makeConfig({}), makeCatalog([]));
    expect(() => withEmpty.onApplicationBootstrap()).not.toThrow();
    expect(withEmpty.current()).toBeUndefined();
  });

  it("resolves a chat-scope root", () => {
    const service = new CommunityLayerService(makeConfig({ scope: "campaigns" }), makeCatalog([campaignEntity]));
    service.onApplicationBootstrap();
    expect(service.current()).toEqual({ type: "campaigns", labelName: "Campaign", nodeName: "campaign" });
  });

  it("refuses current() before boot instead of resolving against a half-registered catalog", () => {
    const catalog = makeCatalog([campaignEntity]);
    const service = new CommunityLayerService(makeConfig({ scope: "campaigns" }), catalog);
    expect(() => service.current()).toThrow(/before application bootstrap/);
    expect(catalog.getAllEntities).not.toHaveBeenCalled();
  });

  it("makes an early ready() wait for boot, then resolve against the full catalog", async () => {
    // Boot order of the real worker: a queued job asks while modules still register their descriptors.
    const entities: CatalogEntity[] = [];
    const catalog = makeCatalog(entities);
    const service = new CommunityLayerService(makeConfig({ scope: "campaigns" }), catalog);
    let layer: unknown = "pending";
    const early = service.ready().then((value) => (layer = value));

    await Promise.resolve();
    expect(layer).toBe("pending");

    entities.push(campaignEntity);
    service.onApplicationBootstrap();
    await early;
    expect(layer).toEqual({ type: "campaigns", labelName: "Campaign", nodeName: "campaign" });
    expect(await service.ready()).toEqual(layer);
  });

  it("builds the catalog first when it is still empty", () => {
    const entities: CatalogEntity[] = [];
    const catalog = makeCatalog(entities);
    catalog.buildCatalog.mockImplementation(() => {
      entities.push(campaignEntity);
    });
    const service = new CommunityLayerService(makeConfig({ scope: "campaigns" }), catalog);
    service.onApplicationBootstrap();
    expect(catalog.buildCatalog).toHaveBeenCalledTimes(1);
    expect(service.current()?.labelName).toBe("Campaign");
  });

  it("throws on an unknown type", () => {
    const service = new CommunityLayerService(makeConfig({ scope: "campaign" }), makeCatalog([campaignEntity]));
    expect(() => service.onApplicationBootstrap()).toThrow(/community\.scope/);
    expect(() => service.onApplicationBootstrap()).toThrow(/"campaign"/);
  });

  it("throws on a type that is not a chat-scope root", () => {
    const sessions = {
      type: "sessions",
      labelName: "Session",
      nodeName: "session",
      scope: {
        path: [{ relationship: "BELONGS_TO", direction: "out" }],
        rootType: "campaigns",
        rootLabel: "Campaign",
      },
    } as unknown as CatalogEntity;
    const service = new CommunityLayerService(makeConfig({ scope: "sessions" }), makeCatalog([sessions]));
    expect(() => service.onApplicationBootstrap()).toThrow(/community\.scope "sessions"/);
  });

  it("throws on a scopeByService type", () => {
    const external = {
      type: "x",
      labelName: "X",
      nodeName: "x",
      scope: { path: [], rootType: "x", rootLabel: "X", viaService: true },
    } as unknown as CatalogEntity;
    const service = new CommunityLayerService(makeConfig({ scope: "x" }), makeCatalog([external]));
    expect(() => service.onApplicationBootstrap()).toThrow(/community\.scope "x"/);
  });

  it("throws on a root whose label is not company-scoped", () => {
    entityTenancyRegistry.register({
      labelName: "Campaign",
      type: "campaigns",
      isCompanyScoped: false,
      tenancy: "global",
    });
    const service = new CommunityLayerService(makeConfig({ scope: "campaigns" }), makeCatalog([campaignEntity]));
    expect(() => service.onApplicationBootstrap()).toThrow(/community\.scope "campaigns"/);
  });

  it("throws when scope is set but no catalog is loaded", () => {
    const service = new CommunityLayerService(makeConfig({ scope: "campaigns" }));
    expect(() => service.onApplicationBootstrap()).toThrow(/community\.scope "campaigns"/);
  });
});
