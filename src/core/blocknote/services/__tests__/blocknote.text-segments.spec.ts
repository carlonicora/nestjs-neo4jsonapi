import { describe, expect, it } from "vitest";
import { BlockNoteService } from "../blocknote.service";

const service = new BlockNoteService();

const buildBlocks = (): any[] => [
  {
    type: "heading",
    content: [{ type: "text", text: "Hello", styles: { bold: true } }],
    children: [
      {
        type: "paragraph",
        content: [{ type: "link", href: "https://x", content: [{ type: "text", text: "link" }] }],
        children: [],
      },
    ],
  },
];

describe("BlockNoteService – extractTextSegments", () => {
  it("collects every inline text depth-first, including link text", () => {
    expect(service.extractTextSegments(buildBlocks())).toEqual(["Hello", "link"]);
  });

  it("reads table cells in both cell shapes", () => {
    const table = [
      {
        type: "table",
        content: {
          type: "tableContent",
          rows: [
            { cells: [[{ type: "text", text: "A1" }], { type: "tableCell", content: [{ type: "text", text: "B1" }] }] },
          ],
        },
        children: [],
      },
    ];
    expect(service.extractTextSegments(table)).toEqual(["A1", "B1"]);
  });

  it("skips whitespace-only text and code blocks", () => {
    const blocks = [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "  " },
          { type: "text", text: "Kept" },
        ],
        children: [],
      },
      { type: "codeBlock", content: [{ type: "text", text: "const x = 1;" }], children: [] },
    ];
    expect(service.extractTextSegments(blocks)).toEqual(["Kept"]);
  });

  it("returns nothing for an empty document", () => {
    expect(service.extractTextSegments([])).toEqual([]);
  });
});

describe("BlockNoteService – applyTextSegments", () => {
  it("replaces the text in place and keeps styles and links", () => {
    expect(service.applyTextSegments(buildBlocks(), ["Ciao", "collegamento"])).toMatchObject([
      {
        content: [{ text: "Ciao", styles: { bold: true } }],
        children: [{ content: [{ href: "https://x", content: [{ text: "collegamento" }] }] }],
      },
    ]);
  });

  it("throws when the segment count differs", () => {
    expect(() => service.applyTextSegments(buildBlocks(), ["Ciao"])).toThrow("segment count mismatch");
    expect(() => service.applyTextSegments(buildBlocks(), ["a", "b", "c"])).toThrow("segment count mismatch");
  });

  it("leaves the input untouched", () => {
    const blocks = buildBlocks();
    service.applyTextSegments(blocks, ["Ciao", "collegamento"]);
    expect(blocks[0].content[0].text).toBe("Hello");
    expect(blocks[0].children[0].content[0].content[0].text).toBe("link");
  });
});
