import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { EmailAutomationEnrollmentPostDTO } from "../dtos/email-automation-enrollment.post.dto";
import { emailAutomationEnrollmentMeta } from "../entities/email-automation-enrollment.meta";

const body = (data: Record<string, unknown> = {}, attributes: Record<string, unknown> = {}) =>
  plainToInstance(EmailAutomationEnrollmentPostDTO, {
    data: {
      type: emailAutomationEnrollmentMeta.endpoint,
      id: "6f1c1f3e-8a5b-4c3d-9e2f-1a2b3c4d5e6f",
      attributes: { recipientType: "waitlist", recipientId: "wl-1", ...attributes },
      ...data,
    },
  });

describe("EmailAutomationEnrollmentPostDTO", () => {
  it("accepts a valid body", async () => {
    expect(await validate(body())).toHaveLength(0);
  });

  it('rejects recipientType "company"', async () => {
    const errors = await validate(body({}, { recipientType: "company" }));

    expect(JSON.stringify(errors)).toContain("recipientType");
  });

  it("rejects a wrong type", async () => {
    const errors = await validate(body({ type: "email-automations" }));

    expect(JSON.stringify(errors)).toContain("type");
  });

  it("rejects an empty recipientId", async () => {
    const errors = await validate(body({}, { recipientId: "" }));

    expect(JSON.stringify(errors)).toContain("recipientId");
  });
});
