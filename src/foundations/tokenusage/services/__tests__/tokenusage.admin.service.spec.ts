import { describe, expect, it, vi } from "vitest";
import { TokenUsageAdminBreakdownDescriptor } from "../../entities/tokenusage-admin-breakdown";
import { TokenUsageAdminSummaryDescriptor } from "../../entities/tokenusage-admin-summary";
import { TokenUsageAdminService } from "../tokenusage.admin.service";

function makeService(repoOverrides: Record<string, any> = {}) {
  const jsonApiService = {
    buildList: vi.fn(async (model: any, rows: any[]) => ({ model, rows })),
    buildSingle: vi.fn(async (model: any, row: any) => ({ model, row })),
  } as any;
  const repository = {
    findSummary: vi.fn(async () => []),
    findTimeline: vi.fn(async () => []),
    findBreakdown: vi.fn(async () => []),
    ...repoOverrides,
  } as any;
  const clsService = { get: vi.fn(() => undefined), has: vi.fn(() => false) } as any;
  return { service: new TokenUsageAdminService(jsonApiService, repository, clsService), jsonApiService, repository };
}

describe("TokenUsageAdminService", () => {
  it("inherits the generic CRUD surface from AbstractService", () => {
    const { service } = makeService();
    // Unused by any route on this controller, but present — the base class is
    // what makes the descriptor, model and repository wiring consistent with
    // the sibling TokenUsageService.
    expect(typeof (service as any).find).toBe("function");
    expect(typeof (service as any).findById).toBe("function");
  });

  it("serialises the summary as a JSON:API list with the summary model", async () => {
    const rows = [{ id: "customer|current" }];
    const { service, jsonApiService } = makeService({ findSummary: vi.fn(async () => rows) });

    await service.getSummary({ from: "2026-08-01T00:00:00.000Z", to: "2026-08-07T00:00:00.000Z" });

    expect(jsonApiService.buildList).toHaveBeenCalledWith(TokenUsageAdminSummaryDescriptor.model, rows);
  });

  it("passes the breakdown dimension, scope and limit straight through", async () => {
    const { service, repository, jsonApiService } = makeService();

    await service.getBreakdown({
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-07T00:00:00.000Z",
      dimension: "user",
      scope: "customer",
      limit: 10,
    });

    expect(repository.findBreakdown).toHaveBeenCalledWith({
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-07T00:00:00.000Z",
      dimension: "user",
      scope: "customer",
      companyId: undefined,
      limit: 10,
    });
    expect(jsonApiService.buildList).toHaveBeenCalledWith(TokenUsageAdminBreakdownDescriptor.model, []);
  });
});
