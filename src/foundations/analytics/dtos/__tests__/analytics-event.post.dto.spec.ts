import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { AnalyticsEventPostDTO } from "../analytics-event.post.dto";

const body = (attributes: Record<string, unknown>) =>
  plainToInstance(AnalyticsEventPostDTO, { data: { type: "analytics-events", attributes } });

describe("AnalyticsEventPostDTO", () => {
  it("accepts a minimal public page view", async () => {
    expect(await validate(body({ path: "/pricing", section: "public" }))).toHaveLength(0);
  });
  it("rejects an unknown section and a non-UUID visitor id", async () => {
    expect((await validate(body({ path: "/x", section: "admin" }))).length).toBeGreaterThan(0);
    expect((await validate(body({ path: "/x", section: "app", visitorId: "not-a-uuid" }))).length).toBeGreaterThan(0);
  });
  it("rejects a path over 2048 characters and a utm value over 255", async () => {
    expect((await validate(body({ path: "/" + "a".repeat(2048), section: "app" }))).length).toBeGreaterThan(0);
    expect((await validate(body({ path: "/x", section: "app", utmSource: "a".repeat(256) }))).length).toBeGreaterThan(
      0,
    );
  });
  it("rejects an empty path", async () => {
    expect((await validate(body({ path: "", section: "app" }))).length).toBeGreaterThan(0);
  });
  it("rejects a wrong resource type", async () => {
    const dto = plainToInstance(AnalyticsEventPostDTO, {
      data: { type: "events", attributes: { path: "/x", section: "app" } },
    });
    expect((await validate(dto)).length).toBeGreaterThan(0);
  });
});
