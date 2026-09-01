import { describe, it, expect } from "vitest";
import { extractMessageText } from "../message.content";

describe("extractMessageText", () => {
  it("returns a string response unchanged", () => {
    expect(extractMessageText("Il decreto fissa l'udienza.")).toBe("Il decreto fissa l'udienza.");
  });

  it("joins the text parts of an array response", () => {
    expect(
      extractMessageText([
        { type: "text", text: "Il decreto fissa " },
        { type: "text", text: "l'udienza." },
      ]),
    ).toBe("Il decreto fissa l'udienza.");
  });

  it("never yields the string '[object Object]' for an array response", () => {
    // The regression this exists to prevent: String([{type:"text",text:"…"}]) is
    // "[object Object]", a non-empty string that passes every downstream guard and
    // gets persisted as the document's abstract and tldr.
    const content = [{ type: "text", text: "Sintesi." }];
    expect(String(content)).toBe("[object Object]");
    expect(extractMessageText(content)).toBe("Sintesi.");
  });

  it("ignores non-text parts such as reasoning or tool blocks", () => {
    expect(extractMessageText([{ type: "reasoning" }, { type: "text", text: "Sintesi." }, { type: "tool_use" }])).toBe(
      "Sintesi.",
    );
  });

  it("returns an empty string for null, undefined and an empty array", () => {
    expect(extractMessageText(null)).toBe("");
    expect(extractMessageText(undefined)).toBe("");
    expect(extractMessageText([])).toBe("");
  });
});
