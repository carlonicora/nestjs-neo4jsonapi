import { describe, expect, it } from "vitest";

/**
 * Importing the package must not patch JavaScript built-ins.
 *
 * `natural`'s root entry loads `sylvester`, which replaces `Math.sign` with
 * `x < 0 ? -1 : 1` (so `Math.sign(0) === 1`) for the whole process. That broke
 * TypeScript's binary search inside prettier ("position cannot precede the
 * beginning of the file") and any comparator built on `Math.sign`. The chunker
 * now imports only natural's tokenizers; this walks the full bootstrap graph,
 * which includes it, and checks `Math.sign` is still the native one.
 */
describe("global built-ins", () => {
  it("keeps the native Math.sign after the bootstrap graph is imported", async () => {
    await import("../app.module.factory");
    await import("../../foundations/chunker/services/types/semanticsplitter.service");

    expect(Function.prototype.toString.call(Math.sign)).toContain("[native code]");
    expect(Math.sign(0)).toBe(0);
  }, 60000);
});
