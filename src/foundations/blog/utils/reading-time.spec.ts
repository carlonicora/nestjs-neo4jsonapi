import { describe, expect, it } from "vitest";
import { readingMinutes } from "./reading-time";

describe("readingMinutes", () => {
  it("is at least one minute", () => {
    expect(readingMinutes("")).toBe(1);
    expect(readingMinutes("one two three")).toBe(1);
  });

  it("rounds up at 200 words per minute", () => {
    expect(readingMinutes(Array(200).fill("w").join(" "))).toBe(1);
    expect(readingMinutes(Array(401).fill("w").join(" "))).toBe(3);
  });
});
