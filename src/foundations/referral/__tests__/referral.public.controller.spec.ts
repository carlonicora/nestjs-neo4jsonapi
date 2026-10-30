import "reflect-metadata";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { HttpStatus } from "@nestjs/common";
import { GUARDS_METADATA, HTTP_CODE_METADATA } from "@nestjs/common/constants";
import { ReferralPublicController } from "../controllers/referral.public.controller";
import { ReferralService } from "../services/referral.service";

describe("ReferralPublicController", () => {
  let controller: ReferralPublicController;
  let referralService: { recordVisit: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    referralService = { recordVisit: vi.fn().mockResolvedValue(undefined) };
    controller = new ReferralPublicController(referralService as unknown as ReferralService);
  });

  it("answers 204 and delegates", async () => {
    await controller.recordVisit({
      data: { type: "referrals/visits", attributes: { referralCode: "abc" } },
    });

    expect(referralService.recordVisit).toHaveBeenCalledWith({ referralCode: "abc" });

    const handler = ReferralPublicController.prototype.recordVisit;
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(HttpStatus.NO_CONTENT);
    expect(Reflect.getMetadata("THROTTLER:LIMITdefault", handler)).toBe(10);
    expect(Reflect.getMetadata("THROTTLER:TTLdefault", handler)).toBe(60000);
    expect(Reflect.getMetadata("path", handler)).toBe("referrals/visits");
    expect(Reflect.getMetadata(GUARDS_METADATA, ReferralPublicController)).toBeUndefined();
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toBeUndefined();
  });
});
