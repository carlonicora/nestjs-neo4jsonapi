import { describe, expect, it } from "vitest";
import { HandbookSectionDescriptor } from "../handbook-section";
import { handbookSectionMeta } from "../handbook-section.meta";

describe("HandbookSectionDescriptor", () => {
  it("is not company scoped", () => {
    expect(HandbookSectionDescriptor.isCompanyScoped).toBe(false);
  });

  it("declares key, title, summary and order as strings", () => {
    expect(HandbookSectionDescriptor.fields.key).toEqual({ type: "string", required: true });
    expect(HandbookSectionDescriptor.fields.title).toEqual({ type: "string", required: true });
    expect(HandbookSectionDescriptor.fields.summary).toEqual({ type: "string" });
    expect(HandbookSectionDescriptor.fields.order).toEqual({ type: "string", required: true });
  });

  it("declares the display translation as two optional strings", () => {
    expect(HandbookSectionDescriptor.fields.displayTitle).toEqual({ type: "string" });
    expect(HandbookSectionDescriptor.fields.displaySummary).toEqual({ type: "string" });
  });

  it("carries the section metadata", () => {
    expect(handbookSectionMeta.type).toBe("handbooksections");
    expect(handbookSectionMeta.labelName).toBe("HandbookSection");
  });

  it("declares no relationships", () => {
    expect(HandbookSectionDescriptor.relationships).toEqual({});
  });
});
