import { ValidationPipe } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { authMeta } from "../../entities/auth.meta";
import { AuthPostOAuthCompleteDTO } from "../auth.post.oauth-complete.dto";

const PENDING_ID = "e2e00000-0000-4000-8000-000000008603";

// Same options as the global pipe in the library bootstrap (whitelist: true).
const pipe = new ValidationPipe({ whitelist: true, transform: true, validateCustomDecorators: true });

const run = (data: Record<string, unknown>) =>
  pipe.transform({ data }, { type: "body", metatype: AuthPostOAuthCompleteDTO }) as Promise<AuthPostOAuthCompleteDTO>;

const valid = (attributes: Record<string, unknown>) => ({ type: authMeta.endpoint, id: PENDING_ID, attributes });

describe("AuthPostOAuthCompleteDTO", () => {
  it("accepts empty attributes (an invite sign-up sends no consent)", async () => {
    const dto = await run(valid({}));

    expect(dto.data.id).toBe(PENDING_ID);
    expect(dto.data.attributes).toEqual({});
  });

  it("keeps the client consent", async () => {
    const dto = await run(
      valid({
        termsAcceptedAt: "2026-11-09T00:00:00Z",
        marketingConsent: true,
        marketingConsentAt: "2026-11-09T00:00:00Z",
      }),
    );

    expect(dto.data.attributes).toEqual({
      termsAcceptedAt: "2026-11-09T00:00:00Z",
      marketingConsent: true,
      marketingConsentAt: "2026-11-09T00:00:00Z",
    });
  });

  it("rejects a termsAcceptedAt that is not a date", async () => {
    await expect(run(valid({ termsAcceptedAt: "yesterday" }))).rejects.toThrow();
  });

  it("rejects a non-uuid data.id", async () => {
    await expect(run({ type: authMeta.endpoint, id: "not-a-uuid", attributes: {} })).rejects.toThrow();
  });

  it("rejects a type other than the auth endpoint", async () => {
    await expect(run({ type: "users", id: PENDING_ID, attributes: {} })).rejects.toThrow();
  });
});
