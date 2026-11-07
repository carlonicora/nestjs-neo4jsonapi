import { describe, expect, it } from "vitest";
import { sanitiseReturnPath } from "../sanitise-return-path";

describe("sanitiseReturnPath", () => {
  it.each(["/", "/settings", "/settings?section=profile"])("sanitiseReturnPath keeps %s", (path) => {
    expect(sanitiseReturnPath(path)).toBe(path);
  });

  it.each([
    "/campaigns",
    "/settings?section=a b",
    undefined,
    "",
    "settings",
    "//evil.test",
    "/\\evil.test",
    "https://evil.test",
    "/a?u=https://evil.test",
  ])("sanitiseReturnPath rejects %s", (path) => {
    expect(sanitiseReturnPath(path)).toBe("/");
  });
});
