import { describe, expect, it } from "vitest";
import { BlockNoteService } from "../blocknote.service";

const doc = [
  {
    type: "paragraph",
    content: [
      { type: "text", text: "what does ", styles: {} },
      { type: "mention", props: { id: "npc-1", entityType: "npcs", alias: "The Quiet One" } },
      { type: "text", text: " want?", styles: {} },
    ],
  },
];

describe("BlockNoteService.convertToMarkdown mentions", () => {
  it("emits the bare alias by default", () => {
    const service = new BlockNoteService();
    expect(service.convertToMarkdown({ nodes: doc })).toContain("what does The Quiet One want?");
  });

  it("emits a mention:// link when preserveMentions is set", () => {
    const service = new BlockNoteService();
    expect(service.convertToMarkdown({ nodes: doc, preserveMentions: true })).toContain(
      "[The Quiet One](mention://npcs/npc-1)",
    );
  });

  it("round-trips through the markdown parser back into a mention node", async () => {
    const service = new BlockNoteService();
    const markdown = service.convertToMarkdown({ nodes: doc, preserveMentions: true });
    const blocks: any[] = await service.createFromMarkdown(markdown);
    const inline = blocks.flatMap((block) => block.content ?? []);
    expect(inline).toContainEqual(
      expect.objectContaining({ type: "mention", props: expect.objectContaining({ id: "npc-1", entityType: "npcs" }) }),
    );
  });
});
