import { describe, expect, it } from "vitest";
import { buildResponseLanguageInstruction } from "../response-language-instruction";

const ITALIAN_LINE =
  "Write every human-readable text value of your response in Italian. Keep unchanged: identifiers, enum values, schema keys, timestamps, any text the instructions or field descriptions say to copy exactly, and the names of existing people, places and things.";

describe("buildResponseLanguageInstruction", () => {
  it("returns the exact line for Italian", () => {
    expect(buildResponseLanguageInstruction("it")).toBe(ITALIAN_LINE);
  });

  it("returns undefined for English", () => {
    expect(buildResponseLanguageInstruction("en")).toBeUndefined();
  });

  it("returns undefined for an empty code", () => {
    expect(buildResponseLanguageInstruction("")).toBeUndefined();
  });

  it("contains no curly braces, backticks or template placeholders", () => {
    const line = buildResponseLanguageInstruction("it") as string;
    expect(line).not.toContain("{");
    expect(line).not.toContain("}");
    expect(line).not.toContain("`");
    expect(line).not.toContain("${");
  });
});
