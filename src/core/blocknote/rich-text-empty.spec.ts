import { describe, expect, it } from "vitest";
import { emptyRichTextToNull, isDocumentEmpty } from "./rich-text-empty";

describe("isDocumentEmpty", () => {
  it("treats a non-array or an empty array as empty", () => {
    expect(isDocumentEmpty(undefined)).toBe(true);
    expect(isDocumentEmpty(null)).toBe(true);
    expect(isDocumentEmpty("x")).toBe(true);
    expect(isDocumentEmpty([])).toBe(true);
  });

  it("treats one blank paragraph as empty", () => {
    expect(isDocumentEmpty([{ id: "a", type: "paragraph", content: [] }])).toBe(true);
    expect(isDocumentEmpty([{ id: "a", type: "paragraph", content: [{ type: "text", text: "   " }] }])).toBe(true);
    expect(isDocumentEmpty([{ id: "a", type: "paragraph", content: "  " }])).toBe(true);
  });

  it("treats text, mentions, headings and list items as content", () => {
    expect(isDocumentEmpty([{ type: "paragraph", content: [{ type: "text", text: "Smells of tar." }] }])).toBe(false);
    expect(isDocumentEmpty([{ type: "paragraph", content: [{ type: "mention", props: { id: "x" } }] }])).toBe(false);
    expect(isDocumentEmpty([{ type: "heading", content: [] }])).toBe(false);
    expect(isDocumentEmpty([{ type: "bulletListItem", content: [] }])).toBe(false);
    expect(isDocumentEmpty([{ type: "paragraph", content: "Wet stone." }])).toBe(false);
  });

  it("looks into nested children of a blank paragraph", () => {
    const nested = [{ type: "paragraph", content: [], children: [{ type: "paragraph", content: "child" }] }];
    expect(isDocumentEmpty(nested)).toBe(false);
  });
});

describe("emptyRichTextToNull", () => {
  it("returns null for null, undefined, empty string and an empty document", () => {
    expect(emptyRichTextToNull(null)).toBeNull();
    expect(emptyRichTextToNull(undefined)).toBeNull();
    expect(emptyRichTextToNull("")).toBeNull();
    expect(emptyRichTextToNull("[]")).toBeNull();
    expect(emptyRichTextToNull(JSON.stringify([{ type: "paragraph", content: [] }]))).toBeNull();
  });

  it("returns the original string unchanged when the document has content", () => {
    const wire = JSON.stringify([{ type: "paragraph", content: "Cold." }]);
    expect(emptyRichTextToNull(wire)).toBe(wire);
  });

  it("treats unparseable input as empty", () => {
    expect(emptyRichTextToNull("{not json")).toBeNull();
  });
});
