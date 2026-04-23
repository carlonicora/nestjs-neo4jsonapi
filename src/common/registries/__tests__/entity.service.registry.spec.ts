import { vi } from "vitest";
import { EntityServiceRegistry } from "../entity.service.registry";
import { AbstractService } from "../../../core/neo4j/abstracts/abstract.service";

describe("EntityServiceRegistry", () => {
  function makeFakeService(type: string) {
    // Create an instance that passes `instance instanceof AbstractService`.
    // The registry only reads `instance.model?.type`, so we don't need a full service.
    const svc = Object.create(AbstractService.prototype);
    svc.model = { type, nodeName: type, labelName: type };
    return svc;
  }

  it("registers services by descriptor.model.type", () => {
    const providers = [
      { instance: makeFakeService("accounts") },
      { instance: makeFakeService("persons") },
      { instance: { notAService: true } },
    ];
    const registry = new EntityServiceRegistry({ getProviders: () => providers } as any);
    registry.onModuleInit();
    expect(registry.get("accounts")).toBeDefined();
    expect(registry.get("persons")).toBeDefined();
    expect(registry.get("widgets")).toBeUndefined();
  });

  it("returns undefined for unknown types instead of throwing", () => {
    const registry = new EntityServiceRegistry({ getProviders: () => [] } as any);
    registry.onModuleInit();
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("listTypes returns the registered types", () => {
    const providers = [{ instance: makeFakeService("accounts") }];
    const registry = new EntityServiceRegistry({ getProviders: () => providers } as any);
    registry.onModuleInit();
    expect(registry.listTypes()).toEqual(["accounts"]);
  });

  it("warns and keeps the first registration on duplicate type", () => {
    const first = makeFakeService("accounts");
    const second = makeFakeService("accounts");
    const providers = [{ instance: first }, { instance: second }];
    const registry = new EntityServiceRegistry({ getProviders: () => providers } as any);
    registry.onModuleInit();
    expect(registry.get("accounts")).toBe(first);
  });
});
