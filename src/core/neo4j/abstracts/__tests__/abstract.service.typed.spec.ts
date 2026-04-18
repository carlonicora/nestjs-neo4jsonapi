import { vi, describe, it, expect } from "vitest";
import { AbstractService } from "../abstract.service";

describe("AbstractService typed-records variants", () => {
  const repo: any = {
    find: vi.fn(async () => [{ id: "a1", name: "Acme" }]),
    findByRelated: vi.fn(async () => [{ id: "o1", total: 100 }]),
  };
  const jsonApiService: any = {};
  const clsService: any = { get: vi.fn() };
  const model: any = { nodeName: "account", type: "accounts", labelName: "Account" };
  const descriptor: any = {
    fieldNames: [],
    fieldDefaults: {},
    relationships: {},
    fields: {},
    computed: {},
    virtualFields: {},
    isCompanyScoped: true,
    model,
  };

  class TypedTestService extends AbstractService<any, any> {
    protected readonly descriptor = descriptor;
  }

  const svc: any = new TypedTestService(jsonApiService, repo, clsService, model);

  it("findRecords returns typed objects directly, not JSON:API", async () => {
    const out = await svc.findRecords({ filters: [{ field: "status", op: "eq", value: "open" }] });
    expect(out).toEqual([{ id: "a1", name: "Acme" }]);
    expect(repo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: [{ field: "status", op: "eq", value: "open" }],
      }),
    );
  });

  it("findRelatedRecords returns typed objects directly", async () => {
    const out = await svc.findRelatedRecords({
      relationship: "orders",
      id: "acme-id",
      filters: [],
      orderByFields: [{ field: "createdAt", direction: "desc" }],
      limit: 5,
    });
    expect(out).toEqual([{ id: "o1", total: 100 }]);
    expect(repo.findByRelated).toHaveBeenCalled();
  });

  it("applies limit client-side when provided", async () => {
    repo.find.mockResolvedValueOnce([{ id: "1" }, { id: "2" }, { id: "3" }]);
    const out = await svc.findRecords({ limit: 2 });
    expect(out).toEqual([{ id: "1" }, { id: "2" }]);
  });
});
