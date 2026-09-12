import { describe, expect, it, vi } from "vitest";
import { BlockNoteService } from "../../../../core/blocknote/services/blocknote.service";
import { CatalogEntity } from "../../interfaces/graph.catalog.interface";
import { convertRichtextFields, parseBlockNoteDocument, toStoredRichtext } from "../richtext.write";

const blockNote = new BlockNoteService();

/** An entity with one richtext field and one ordinary string field. */
const npc = {
  type: "npcs",
  moduleId: "m-npc",
  description: "An npc.",
  labelName: "Npc",
  nodeName: "npc",
  fields: [
    { name: "name", type: "string", description: "Name.", filterable: true, sortable: true },
    {
      name: "description",
      type: "string",
      description: "Notes.",
      filterable: false,
      sortable: false,
      kind: { type: "richtext" as const },
    },
  ],
  relationships: [],
} as unknown as CatalogEntity;

/** What the frontend stores: a JSON string holding an array of BlockNote blocks. */
const storedDocument = JSON.stringify([
  {
    id: "b1",
    type: "paragraph",
    props: { textColor: "default", backgroundColor: "default", textAlignment: "left" },
    content: [{ type: "text", text: "Already a document.", styles: {} }],
    children: [],
  },
]);

describe("parseBlockNoteDocument", () => {
  it("recognises a serialised BlockNote document", () => {
    expect(parseBlockNoteDocument(storedDocument)).toHaveLength(1);
  });

  it.each([
    ["plain prose", "A paragraph."],
    ["markdown", "# Title\n\nA paragraph."],
    ["a JSON array of strings", '["not", "blocks"]'],
    ["an empty JSON array", "[]"],
    ["an array-looking string that is not JSON", "[unterminated"],
    ["a JSON object", '{"type":"paragraph"}'],
  ])("returns null for %s", (_label, raw) => {
    expect(parseBlockNoteDocument(raw)).toBeNull();
  });
});

describe("toStoredRichtext", () => {
  it("returns an already-stored document unchanged", async () => {
    expect(await toStoredRichtext(blockNote, storedDocument)).toBe(storedDocument);
  });

  it("converts markdown to a serialised BlockNote document", async () => {
    const stored = await toStoredRichtext(blockNote, "# Title\n\nA paragraph.");

    expect(typeof stored).toBe("string");
    const nodes = JSON.parse(stored as string);
    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toMatchObject({
      type: "heading",
      props: { level: 1 },
      content: [{ type: "text", text: "Title", styles: {} }],
      children: [],
    });
    expect(nodes[1]).toMatchObject({
      type: "paragraph",
      content: [{ type: "text", text: "A paragraph.", styles: {} }],
      children: [],
    });
    // The stored value must round-trip: the read side renders it back to markdown.
    expect(blockNote.convertToMarkdown({ nodes }).trim()).toBe("# Title\n\nA paragraph.");
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["an empty string", ""],
    ["a whitespace-only string", "   "],
    ["a number", 7],
    ["a boolean", false],
  ])("passes %s through unchanged", async (_label, value) => {
    const convert = vi.spyOn(blockNote, "createFromMarkdown");
    expect(await toStoredRichtext(blockNote, value as unknown)).toBe(value);
    expect(convert).not.toHaveBeenCalled();
    convert.mockRestore();
  });
});

describe("convertRichtextFields", () => {
  it("converts only the richtext fields and leaves the others untouched", async () => {
    const fields = await convertRichtextFields(blockNote, npc, { name: "# Marcus", description: "# Marcus" });

    expect(fields.name).toBe("# Marcus");
    expect(JSON.parse(fields.description as string)[0]).toMatchObject({ type: "heading" });
  });

  it("returns a new map and never mutates the caller's payload (the approval card keeps the markdown)", async () => {
    const original = { description: "# Title" };
    const fields = await convertRichtextFields(blockNote, npc, original);

    expect(original.description).toBe("# Title");
    expect(fields).not.toBe(original);
  });

  it("leaves a field the payload does not carry absent", async () => {
    const fields = await convertRichtextFields(blockNote, npc, { name: "Marcus" });
    expect(fields).toEqual({ name: "Marcus" });
  });

  it("passes everything through when no converter is available (unit tests)", async () => {
    const fields = await convertRichtextFields(undefined, npc, { description: "# Title" });
    expect(fields).toEqual({ description: "# Title" });
  });

  it("passes everything through for an entity with no richtext field", async () => {
    const plain = { ...npc, fields: [npc.fields[0]] } as CatalogEntity;
    const fields = await convertRichtextFields(blockNote, plain, { name: "# Marcus" });
    expect(fields).toEqual({ name: "# Marcus" });
  });
});
