import { describe, expect, it } from "vitest";
import { repairTruncatedJson } from "../repair-truncated-json";

/**
 * The observed failure this exists for: a structured call hit its output cap
 * (`finish_reason: "length"`), so the payload stopped INSIDE a string and every
 * `JSON.parse`-based salvage rung rejected the whole response — discarding the
 * elements the model had already completed.
 */
describe("repairTruncatedJson", () => {
  it("recovers the complete elements of an array truncated inside a string", () => {
    const truncated = '{"facts":[{"text":"first"},{"text":"second"},{"text":"thi';

    const repaired = repairTruncatedJson(truncated);

    expect(repaired).not.toBeNull();
    const parsed = JSON.parse(repaired as string);
    // N-1: the two complete entries survive, the partial one is dropped.
    expect(parsed.facts).toEqual([{ text: "first" }, { text: "second" }]);
  });

  it("keeps an element that closed but was not followed by a separator", () => {
    const repaired = repairTruncatedJson('{"a":[1,2],"b":"x');

    expect(JSON.parse(repaired as string)).toEqual({ a: [1, 2] });
  });

  it("drops a trailing bare token, which may itself be truncated", () => {
    // `3` could be the start of `35` — only elements the input PROVES complete
    // (comma- or bracket-terminated) are kept.
    expect(JSON.parse(repairTruncatedJson("[1,2,3") as string)).toEqual([1, 2]);
  });

  it("does not trip over commas, braces or escapes inside strings", () => {
    const truncated = '{"list":[{"t":"a, b {c} \\"quoted\\""},{"t":"unfin';

    expect(JSON.parse(repairTruncatedJson(truncated) as string)).toEqual({ list: [{ t: 'a, b {c} "quoted"' }] });
  });

  it("returns already-valid JSON verbatim", () => {
    const valid = '{"a": 1, "b": ["x"]}';

    expect(repairTruncatedJson(valid)).toBe(valid);
  });

  it("recovers JSON truncated inside a markdown fence", () => {
    const repaired = repairTruncatedJson('```json\n{"items":[1,2,{"a":');

    expect(JSON.parse(repaired as string)).toEqual({ items: [1, 2] });
  });

  it("yields an empty container when nothing inside it completed", () => {
    expect(JSON.parse(repairTruncatedJson('{"a":"unterminat') as string)).toEqual({});
  });

  it("returns null for input with no JSON in it", () => {
    expect(repairTruncatedJson("I'm sorry, I cannot help with that.")).toBeNull();
    expect(repairTruncatedJson("")).toBeNull();
  });

  it("returns null when the brackets are mismatched", () => {
    expect(repairTruncatedJson('{"a":[1,2}')).toBeNull();
  });
});
