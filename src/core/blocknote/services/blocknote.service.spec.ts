import { BlockNoteService } from "./blocknote.service";

describe("BlockNoteService – mention links", () => {
  const service = new BlockNoteService();

  it("converts [alias](mention://npc/abc-123) into a mention inline", async () => {
    const blocks = await service.createFromMarkdown("Hello [Mara](mention://npc/abc-123).");
    const paragraph = blocks[0];
    expect(paragraph.type).toBe("paragraph");
    const mention = paragraph.content.find((c: any) => c.type === "mention");
    expect(mention).toEqual({
      type: "mention",
      props: { id: "abc-123", entityType: "npc", alias: "Mara" },
    });
  });

  it("treats non-mention links as plain text", async () => {
    const blocks = await service.createFromMarkdown("See [the wiki](https://example.com).");
    const paragraph = blocks[0];
    const hasMention = paragraph.content.some((c: any) => c.type === "mention");
    expect(hasMention).toBe(false);
  });

  it("supports mention links inside list items", async () => {
    const blocks = await service.createFromMarkdown("- [Mara](mention://npc/abc) bargained.");
    const item = blocks[0];
    expect(item.type).toBe("bulletListItem");
    const mention = item.content.find((c: any) => c.type === "mention");
    expect(mention?.props?.entityType).toBe("npc");
  });
});

describe("BlockNoteService – convertToMarkdown content tolerance", () => {
  const service = new BlockNoteService();

  it("accepts BlockNote shorthand where a block's content is a plain string", () => {
    const nodes = [{ type: "paragraph", content: "Giulia stole one of the masks." }];
    expect(service.convertToMarkdown({ nodes }).trim()).toBe("Giulia stole one of the masks.");
  });

  it("treats a block with undefined content as empty instead of crashing", () => {
    const nodes = [
      { type: "paragraph" },
      { type: "paragraph", content: [{ type: "text", text: "after", styles: {} }] },
    ];
    expect(service.convertToMarkdown({ nodes }).trim()).toBe("after");
  });
});

describe("BlockNoteService – guide markdown", () => {
  const service = new BlockNoteService();

  it("turns an ordered list into numberedListItem blocks", async () => {
    const blocks = await service.createFromMarkdown("1. Apri le pratiche\n2. Premi crea");
    expect(blocks.map((b: any) => b.type)).toEqual(["numberedListItem", "numberedListItem"]);
    expect(blocks[1].content[0].text).toBe("Premi crea");
  });

  it("nests a sub-list as children of its parent item", async () => {
    const blocks = await service.createFromMarkdown("- Uno\n  - Uno.a\n- Due");
    expect(blocks).toHaveLength(2);
    expect(blocks[0].children[0].type).toBe("bulletListItem");
    expect(blocks[0].children[0].content[0].text).toBe("Uno.a");
  });

  it("turns a paragraph that is only an image into an image block", async () => {
    const blocks = await service.createFromMarkdown("![La scheda](https://cdn.test/howtos/x/01.png)");
    expect(blocks[0].type).toBe("image");
    expect(blocks[0].props.url).toBe("https://cdn.test/howtos/x/01.png");
    expect(blocks[0].props.caption).toBe("La scheda");
    expect(blocks[0].props.previewWidth).toBe(1024);
  });

  it("keeps a link as link inline content", async () => {
    const blocks = await service.createFromMarkdown("Vedi [la guida](/help/how-to/creare-una-pratica).");
    const link = blocks[0].content.find((c: any) => c.type === "link");
    expect(link.href).toBe("/help/how-to/creare-una-pratica");
    expect(link.content[0].text).toBe("la guida");
  });

  it("turns a blockquote into a quote block", async () => {
    const blocks = await service.createFromMarkdown("> Conviene farlo subito.");
    expect(blocks[0].type).toBe("quote");
    expect(blocks[0].content[0].text).toBe("Conviene farlo subito.");
  });

  it("keeps the number an ordered list resumes from after an image", async () => {
    const blocks = await service.createFromMarkdown(
      "1. Apri\n\n![Cap](https://cdn.test/a.png)\n\n2. Premi\n3. Salva\n",
    );
    expect(blocks.map((b: any) => b.type)).toEqual([
      "numberedListItem",
      "image",
      "numberedListItem",
      "numberedListItem",
    ]);
    expect(blocks[0].props.start).toBeUndefined();
    expect(blocks[2].props.start).toBe(2);
    expect(blocks[3].props.start).toBeUndefined();
    expect(service.convertToMarkdown({ nodes: blocks })).toContain("2. Premi\n1. Salva");
  });

  it("round-trips numbered items, links and images through convertToMarkdown", async () => {
    const md = "1. Apri [le pratiche](/proceedings)\n\n![Cap](https://cdn.test/a.png)\n";
    const blocks = await service.createFromMarkdown(md);
    const back = service.convertToMarkdown({ nodes: blocks });
    expect(back).toContain("1. Apri [le pratiche](/proceedings)");
    expect(back).toContain("![Cap](https://cdn.test/a.png)");
  });
});
