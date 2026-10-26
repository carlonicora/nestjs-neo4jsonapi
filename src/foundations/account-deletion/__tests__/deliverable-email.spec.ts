import { describe, expect, it } from "vitest";
import { hasDeliverableEmail } from "../utils/deliverable-email";

describe("hasDeliverableEmail", () => {
  it.each([["player-df4af9c5@narr8.local"], ["PLAYER@X.LOCAL"], ["123456789012345678"], [""], [undefined], [null]])(
    "is false for %s",
    (email) => {
      expect(hasDeliverableEmail(email as string | undefined | null)).toBe(false);
    },
  );

  it("is true for a real address", () => {
    expect(hasDeliverableEmail("gm@example.com")).toBe(true);
  });
});
