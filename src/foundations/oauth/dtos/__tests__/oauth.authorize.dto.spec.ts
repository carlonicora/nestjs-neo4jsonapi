import { describe, it, expect } from "vitest";
import "reflect-metadata";
import { randomUUID } from "crypto";
import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { OAuthConsentDecisionDto } from "../oauth.authorize.dto";

const base = { client_id: "client-1", redirect_uri: "https://example.test/cb" };

const errorsFor = async (body: Record<string, unknown>) => validate(plainToInstance(OAuthConsentDecisionDto, body));

describe("OAuthConsentDecisionDto.company_id", () => {
  it("accepts a body without company_id (deny, and approve before a studio is picked)", async () => {
    expect(await errorsFor(base)).toHaveLength(0);
  });

  it("accepts a company id generated the way company ids are (crypto.randomUUID, v4)", async () => {
    expect(await errorsFor({ ...base, company_id: randomUUID() })).toHaveLength(0);
  });

  it("accepts an existing company id", async () => {
    expect(await errorsFor({ ...base, company_id: "992aa8e1-25a7-4d3d-b12e-a836976b0184" })).toHaveLength(0);
  });

  it("rejects a company_id that is not a UUID", async () => {
    const errors = await errorsFor({ ...base, company_id: "not-a-uuid" });

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe("company_id");
    expect(errors[0].constraints).toHaveProperty("isUuid");
  });
});
