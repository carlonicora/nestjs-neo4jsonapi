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
