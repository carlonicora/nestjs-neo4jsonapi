import { vi, beforeEach, describe, it, expect } from "vitest";
import { Test } from "@nestjs/testing";
import { SearchEntitiesTool } from "../search-entities.tool";
import { ToolFactory } from "../tool.factory";
import { CatalogEntity } from "../../interfaces/graph.catalog.interface";
import { GraphCatalogService } from "../../services/graph.catalog.service";
import { GraphSearchService } from "../../services/graph.search.service";
import { ScopeGuard } from "../../services/scope.guard";
import { ToolFieldFormatterService } from "../../services/field-formatting";
import { BlockNoteService } from "../../../../core/blocknote/services/blocknote.service";
import { EntityServiceRegistry } from "../../../../common/registries/entity.service.registry";

describe("SearchEntitiesTool — service search warnings", () => {
  const formatter = new ToolFieldFormatterService(new BlockNoteService());

  const entity: CatalogEntity = {
    type: "accounts",
    moduleId: "11111111-1111-1111-1111-111111111111",
    description: "A",
    fields: [{ name: "name", type: "string", description: "Display name.", filterable: true, sortable: true }],
    relationships: [],
    nodeName: "account",
    labelName: "Account",
    personal: false,
    generatedFields: [],
    textSearchFields: ["name"],
    summary: (d: any) => d.name,
  };
  const registryGet = vi.fn();
  const ctx = { companyId: "c", userId: "u", userModuleIds: ["11111111-1111-1111-1111-111111111111"] };
  const factory: Pick<ToolFactory, "resolveEntity" | "resolveService" | "capture"> = {
    resolveEntity: (t) => (t === "accounts" ? entity : { error: "nope" }),
    resolveService: (t) => registryGet(t),
    capture: async (record, fn, recorder) => {
      const v = await fn();
      recorder.push({ tool: record.tool, input: record.input, durationMs: 0 });
      return v;
    },
  };
  const described = [{ tool: "describe_entity", input: { type: "accounts" }, durationMs: 0 }];
  let tool: SearchEntitiesTool;

  beforeEach(async () => {
    registryGet.mockReset();
    // Search, catalog, registry and scope guard are not reached on this path: the factory resolves the service.
    const module = await Test.createTestingModule({
      providers: [
        SearchEntitiesTool,
        { provide: ToolFactory, useValue: factory },
        { provide: GraphSearchService, useValue: {} },
        { provide: GraphCatalogService, useValue: {} },
        { provide: EntityServiceRegistry, useValue: {} },
        { provide: ScopeGuard, useValue: {} },
        { provide: ToolFieldFormatterService, useValue: formatter },
      ],
    }).compile();
    tool = module.get(SearchEntitiesTool);
  });
  const input = { type: "accounts", filters: [{ field: "name", op: "eq", value: "Acme" }] };

  it("a service warning reaches the reply", async () => {
    const svc = {
      findRecords: vi.fn(),
      findRecordsWithWarnings: vi.fn(async () => ({
        records: [
          { id: "a1", name: "Acme" },
          { id: "a2", name: "Acme" },
        ],
        warnings: ["Two records share this name."],
      })),
    };
    registryGet.mockReturnValue(svc);

    const out: any = await tool.invoke(input, ctx, [...described]);

    expect(out.warnings).toEqual(["Two records share this name."]);
    expect(out.items.map((item: any) => item.id)).toEqual(["a1", "a2"]);
    expect(svc.findRecords).not.toHaveBeenCalled();
    expect(svc.findRecordsWithWarnings).toHaveBeenCalledWith(
      expect.objectContaining({ filters: [{ field: "name", op: "eq", value: "Acme" }], limit: 11 }),
    );
  });

  it("no warnings key when the service has none", async () => {
    registryGet.mockReturnValue({
      findRecords: vi.fn(),
      findRecordsWithWarnings: vi.fn(async () => ({ records: [{ id: "a1", name: "Acme" }], warnings: [] })),
    });

    const out: any = await tool.invoke(input, ctx, [...described]);

    expect(out).not.toHaveProperty("warnings");
    expect(out.items).toHaveLength(1);
  });

  it("no warnings key when the service has no hook", async () => {
    const svc = { findRecords: vi.fn(async () => [{ id: "a1", name: "Acme" }]) };
    registryGet.mockReturnValue(svc);

    const out: any = await tool.invoke(input, ctx, [...described]);

    expect(out).not.toHaveProperty("warnings");
    expect(svc.findRecords).toHaveBeenCalledTimes(1);
  });
});
