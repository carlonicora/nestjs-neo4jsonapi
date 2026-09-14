import { describe, expect, it } from "vitest";
import { HandbookPageDescriptor } from "../handbook-page";
import { handbookPageMeta } from "../handbook-page.meta";

describe("HandbookPageDescriptor", () => {
  it("is global content, not company scoped", () => {
    expect(HandbookPageDescriptor.isCompanyScoped).toBe(false);
  });

  it("carries the handbook meta", () => {
    expect(HandbookPageDescriptor.model.labelName).toBe("HandbookPage");
    expect(handbookPageMeta.endpoint).toBe("handbookpages");
  });

  it("declares the ingest fields and no relationships", () => {
    expect(Object.keys(HandbookPageDescriptor.fields).sort()).toEqual(
      [
        "aiStatus",
        "content",
        "contentHash",
        "displayContent",
        "displaySummary",
        "displayTitle",
        "order",
        "path",
        "section",
        "summary",
        "title",
        "wordCount",
      ].sort(),
    );
    expect(HandbookPageDescriptor.relationships).toEqual({});
  });

  it("declares section, order and summary as optional strings", () => {
    expect(HandbookPageDescriptor.fields.section).toEqual({ type: "string" });
    expect(HandbookPageDescriptor.fields.order).toEqual({ type: "string" });
    expect(HandbookPageDescriptor.fields.summary).toEqual({ type: "string" });
  });

  it("declares the display translation as three optional strings", () => {
    expect(HandbookPageDescriptor.fields.displayTitle).toEqual({ type: "string" });
    expect(HandbookPageDescriptor.fields.displaySummary).toEqual({ type: "string" });
    expect(HandbookPageDescriptor.fields.displayContent).toEqual({ type: "string" });
  });

  it("declares no temporal field as a string", () => {
    for (const [name, field] of Object.entries(HandbookPageDescriptor.fields)) {
      expect(name.endsWith("At")).toBe(false);
      expect(["string", "number"]).toContain((field as { type: string }).type);
    }
  });
});
