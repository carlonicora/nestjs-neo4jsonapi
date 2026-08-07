import { describe, expect, it, vi } from "vitest";
import { TokenUsageAdminController } from "../tokenusage.admin.controller";

const reply = () => ({ send: vi.fn() }) as any;

describe("TokenUsageAdminController", () => {
  it("defaults the breakdown limit to 10 and the scope to customer", async () => {
    const service = { getBreakdown: vi.fn(async () => ({ data: [] })) } as any;
    const controller = new TokenUsageAdminController(service);
    const r = reply();

    await controller.getBreakdown(r, "2026-08-01T00:00:00.000Z", "2026-08-07T00:00:00.000Z", "company");

    expect(service.getBreakdown).toHaveBeenCalledWith(
      expect.objectContaining({ dimension: "company", scope: "customer", limit: 10 }),
    );
    expect(r.send).toHaveBeenCalled();
  });

  it("defaults the timeline granularity to day and stackBy to scope", async () => {
    const service = { getTimeline: vi.fn(async () => ({ data: [] })) } as any;
    const controller = new TokenUsageAdminController(service);

    await controller.getTimeline(reply(), "2026-08-01T00:00:00.000Z", "2026-08-07T00:00:00.000Z");

    expect(service.getTimeline).toHaveBeenCalledWith(expect.objectContaining({ granularity: "day", stackBy: "scope" }));
  });

  it("rejects an unknown granularity rather than interpolating it into Cypher", async () => {
    const service = { getTimeline: vi.fn(async () => ({ data: [] })) } as any;
    const controller = new TokenUsageAdminController(service);

    await expect(
      controller.getTimeline(
        reply(),
        "2026-08-01T00:00:00.000Z",
        "2026-08-07T00:00:00.000Z",
        "'; MATCH (n) DETACH DELETE n //",
      ),
    ).rejects.toThrow();
    expect(service.getTimeline).not.toHaveBeenCalled();
  });
});
