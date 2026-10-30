import "reflect-metadata";
import { describe, it, expect } from "vitest";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { ReferralVisitPostDTO } from "../dtos/referral-visit.post.dto";

const errorsFor = async (body: unknown) =>
  validate(plainToInstance(ReferralVisitPostDTO, body) as object, { whitelist: true, forbidNonWhitelisted: true });

describe("ReferralVisitPostDTO", () => {
  it("accepts a malformed code", async () => {
    const errors = await errorsFor({ data: { type: "referrals/visits", attributes: { referralCode: "abc" } } });
    expect(errors).toHaveLength(0);
  });

  it("accepts a UUID", async () => {
    const errors = await errorsFor({
      data: { type: "referrals/visits", attributes: { referralCode: "550e8400-e29b-41d4-a716-446655440000" } },
    });
    expect(errors).toHaveLength(0);
  });

  it("rejects a missing code", async () => {
    const errors = await errorsFor({ data: { type: "referrals/visits", attributes: {} } });
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects a wrong type", async () => {
    const errors = await errorsFor({ data: { type: "referrals", attributes: { referralCode: "abc" } } });
    expect(errors.length).toBeGreaterThan(0);
  });
});
