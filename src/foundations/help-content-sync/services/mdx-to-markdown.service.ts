import { Injectable } from "@nestjs/common";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkMdx from "remark-mdx";
import { toMarkdown } from "mdast-util-to-markdown";
import { mdxToMarkdown as mdxToMarkdownExt } from "mdast-util-mdx";
import type { Root, RootContent, BlockContent } from "mdast";

type MdxNode = any;

@Injectable()
export class MdxToMarkdownService {
  /**
   * Convert MDX source into plain markdown suitable for the chunker.
   * Known JSX components are rewritten to text-equivalent markdown;
   * unknown JSX is dropped silently.
   */
  async convert(mdx: string): Promise<string> {
    const tree = unified().use(remarkParse).use(remarkMdx).parse(mdx) as Root;
    const transformed = this.transformTree(tree);
    return toMarkdown(transformed, { extensions: [mdxToMarkdownExt()] });
  }

  private transformTree(tree: Root): Root {
    tree.children = tree.children.flatMap((child) => this.transformNode(child)) as RootContent[];
    return tree;
  }

  private transformNode(node: MdxNode): RootContent[] {
    if (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") {
      return this.transformJsx(node);
    }
    if ("children" in node && Array.isArray(node.children)) {
      node.children = node.children.flatMap((c: any) => this.transformNode(c));
    }
    return [node];
  }

  private transformJsx(node: MdxNode): RootContent[] {
    switch (node.name) {
      case "Callout": {
        const typeAttr = (node.attributes ?? []).find((a: any) => a.name === "type");
        const type = typeAttr?.value ?? "info";
        const prefix = `${String(type).charAt(0).toUpperCase() + String(type).slice(1)}: `;
        const innerText = this.flattenText(node);
        return [
          {
            type: "blockquote",
            children: [{ type: "paragraph", children: [{ type: "text", value: prefix + innerText }] }],
          } as BlockContent,
        ];
      }
      case "Steps": {
        const steps = (node.children ?? []).filter(
          (c: any) => (c.type === "mdxJsxFlowElement" || c.type === "mdxJsxTextElement") && c.name === "Step",
        );
        return [
          {
            type: "list",
            ordered: true,
            start: 1,
            spread: false,
            children: steps.map((s: any) => ({
              type: "listItem",
              spread: false,
              children: [{ type: "paragraph", children: [{ type: "text", value: this.flattenText(s) }] }],
            })),
          } as BlockContent,
        ];
      }
      case "Screenshot": {
        const caption = (node.attributes ?? []).find((a: any) => a.name === "caption")?.value ?? "image";
        return [{ type: "paragraph", children: [{ type: "text", value: `[Screenshot: ${caption}]` }] }];
      }
      case "Video": {
        const src = (node.attributes ?? []).find((a: any) => a.name === "src")?.value ?? "";
        return [{ type: "paragraph", children: [{ type: "text", value: `[Video: ${src}]` }] }];
      }
      case "EntityRef":
      case "KeyBinding": {
        return [{ type: "text", value: this.flattenText(node) } as RootContent];
      }
      case "Related":
      default:
        return [];
    }
  }

  private flattenText(node: MdxNode): string {
    if (!node) return "";
    if (typeof node.value === "string") return node.value;
    if (Array.isArray(node.children)) return node.children.map((c: any) => this.flattenText(c)).join("");
    return "";
  }
}
