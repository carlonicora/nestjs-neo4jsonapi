import { describe, it, expect, beforeEach } from "vitest";
import { MdxToMarkdownService } from "../mdx-to-markdown.service";

describe("MdxToMarkdownService", () => {
  let service: MdxToMarkdownService;
  beforeEach(() => {
    service = new MdxToMarkdownService();
  });

  it("passes plain markdown through largely intact", async () => {
    const out = await service.convert(`# Title\n\nBody.\n`);
    expect(out).toContain("# Title");
    expect(out).toContain("Body.");
  });

  it("strips unknown JSX components silently", async () => {
    const out = await service.convert(`<Mystery foo="bar" />\n\nKeep me.`);
    expect(out).not.toContain("<Mystery");
    expect(out).toContain("Keep me.");
  });

  it('converts <Callout type="warning"> to a blockquote with prefix', async () => {
    const out = await service.convert(`<Callout type="warning">Heads up.</Callout>`);
    expect(out).toMatch(/>\s*Warning: Heads up\./);
  });

  it("converts <Steps> + <Step> to a numbered list", async () => {
    const mdx = `<Steps><Step>One</Step><Step>Two</Step></Steps>`;
    const out = await service.convert(mdx);
    expect(out).toMatch(/1\.\s*One/);
    expect(out).toMatch(/2\.\s*Two/);
  });

  it('replaces <Screenshot caption="X"> with [Screenshot: X]', async () => {
    const out = await service.convert(`<Screenshot src="/x.png" caption="The map" />`);
    expect(out).toContain("[Screenshot: The map]");
  });

  it("inlines <EntityRef> children as plain text", async () => {
    const out = await service.convert(`<EntityRef type="npc">NPCs</EntityRef> are people.`);
    expect(out).toContain("NPCs are people.");
  });

  it("flattens <KeyBinding>Cmd+K</KeyBinding> to text", async () => {
    const out = await service.convert(`Press <KeyBinding>Cmd+K</KeyBinding>.`);
    expect(out).toContain("Press Cmd+K.");
  });

  it("drops <Related> blocks", async () => {
    const out = await service.convert(`<Related slugs={["a","b"]} />\n\nVisible.`);
    expect(out).not.toContain("Related");
    expect(out).toContain("Visible.");
  });
});
