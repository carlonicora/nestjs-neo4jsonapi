import { GUARDS_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { describe, expect, it, vi } from "vitest";
import { SystemRoles } from "../../../common/constants/system.roles";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { ReferralAdminController } from "../controllers/referral.admin.controller";
import { referralAdminReferralMeta } from "../entities/referral-admin-referral.meta";
import { referralAdminReferrerMeta } from "../entities/referral-admin-referrer.meta";
import { referralAdminSummaryMeta } from "../entities/referral-admin-summary.meta";

const reply = () => ({ send: vi.fn() }) as any;

function makeController() {
  const service = {
    getSummary: vi.fn(async () => ({ data: [] })),
    getReferrers: vi.fn(async () => ({ data: [] })),
    getReferrals: vi.fn(async () => ({ data: [] })),
  } as any;
  return { controller: new ReferralAdminController(service), service };
}

const ROUTES = ["getSummary", "getReferrers", "getReferrals"] as const;

describe("ReferralAdminController", () => {
  it("guards the class with JwtAuthGuard", () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, ReferralAdminController)).toEqual([JwtAuthGuard]);
  });

  it("every route carries Roles(Administrator)", () => {
    for (const route of ROUTES) {
      const handler = ReferralAdminController.prototype[route];
      expect(Reflect.getMetadata("roles", handler)).toEqual([SystemRoles.Administrator]);
    }
  });

  it("mounts the routes at the meta endpoints", () => {
    expect(Reflect.getMetadata(PATH_METADATA, ReferralAdminController.prototype.getSummary)).toBe(
      referralAdminSummaryMeta.endpoint,
    );
    expect(Reflect.getMetadata(PATH_METADATA, ReferralAdminController.prototype.getReferrers)).toBe(
      referralAdminReferrerMeta.endpoint,
    );
    expect(Reflect.getMetadata(PATH_METADATA, ReferralAdminController.prototype.getReferrals)).toBe(
      referralAdminReferralMeta.endpoint,
    );
  });

  it("passes a known period and sort through", async () => {
    const { controller, service } = makeController();
    const r = reply();

    await controller.getReferrers(r, "90d", "conversion");

    expect(service.getReferrers).toHaveBeenCalledWith({ period: "90d", sort: "conversion" });
    expect(r.send).toHaveBeenCalledWith({ data: [] });
  });

  it("unknown period falls back to 30d", async () => {
    const { controller, service } = makeController();

    await controller.getSummary(reply(), "7y");
    await controller.getReferrals(reply(), undefined);
    await controller.getReferrers(reply(), "toString");

    expect(service.getSummary).toHaveBeenCalledWith({ period: "30d" });
    expect(service.getReferrals).toHaveBeenCalledWith({ period: "30d" });
    expect(service.getReferrers).toHaveBeenCalledWith({ period: "30d", sort: "paying" });
  });

  it("unknown sort falls back to paying", async () => {
    const { controller, service } = makeController();

    await controller.getReferrers(reply(), "all", "'; DETACH DELETE n //");

    expect(service.getReferrers).toHaveBeenCalledWith({ period: "all", sort: "paying" });
  });

  it("answers with the feature disabled", async () => {
    // The controller takes no REFERRAL_CONFIG at all: the admin report stays
    // reachable while the referral feature is off.
    expect(ReferralAdminController.length).toBe(1);
    const { controller, service } = makeController();
    const r = reply();

    await controller.getSummary(r, "30d");

    expect(service.getSummary).toHaveBeenCalledWith({ period: "30d" });
    expect(r.send).toHaveBeenCalled();
  });
});
