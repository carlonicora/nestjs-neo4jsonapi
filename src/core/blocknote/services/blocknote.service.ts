import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";

/**
 * BlockNote Service
 *
 * Converts between BlockNote/ProseMirror data structures and Markdown
 *
 * Features:
 * - Convert BlockNote JSON to Markdown
 * - Convert Markdown to BlockNote JSON
 * - Support for headings, paragraphs, lists, code blocks
 * - Support for text styling (bold, italic, strikethrough, code)
 * - Support for checklist items
 *
 * @example
 * ```typescript
 * const markdown = blocknoteService.convertToMarkdown({ nodes: blockNoteData });
 * const blockNote = blocknoteService.createFromMarkdown('# Hello World');
 * ```
 */
@Injectable()
export class BlockNoteService {
  /**
   * Converts a BlockNoteJS/Prosemirror data structure into markdown.
   *
   * `preserveMentions` keeps mention inline nodes addressable in the markdown
   * (see `processMention`). It is opt-in because every existing caller wants
   * the plain alias.
   */
  convertToMarkdown(params: { nodes: any[]; preserveMentions?: boolean }): string {
    const preserveMentions = params.preserveMentions ?? false;
    return params.nodes.map((node) => this.processNode(node, 0, preserveMentions)).join("");
  }

  /**
   * Converts markdown text into a BlockNoteJS/Prosemirror data structure.
   */
  async createFromMarkdown(markdown: string): Promise<any[]> {
    // Dynamically import marked to avoid bundling issues
    const { marked } = await import("marked");
    const tokens = marked.lexer(markdown);
    return this.tokensToNodes(tokens);
  }

  /**
   * Recursively convert marked tokens into nodes.
   */
  protected tokensToNodes(tokens: any[]): any[] {
    const nodes = [];
    for (const token of tokens) {
      switch (token.type) {
        case "heading":
          nodes.push({
            id: randomUUID(),
            type: "heading",
            props: { textColor: "default", backgroundColor: "default", textAlignment: "left", level: token.depth },
            content: this.inlineTokensToContent(token.tokens),
            children: [],
          });
          break;
        case "paragraph": {
          // A paragraph whose only inline token is an image becomes an image
          // block: BlockNote has no inline image, and guides put every
          // screenshot on its own line.
          const only = token.tokens?.length === 1 ? token.tokens[0] : undefined;
          if (only && only.type === "image") {
            nodes.push({
              id: randomUUID(),
              type: "image",
              props: {
                backgroundColor: "default",
                textAlignment: "left",
                name: "",
                url: String(only.href ?? ""),
                caption: String(only.text ?? ""),
                showPreview: true,
                previewWidth: 1024,
              },
              children: [],
            });
            break;
          }
          nodes.push({
            id: randomUUID(),
            type: "paragraph",
            props: { textColor: "default", backgroundColor: "default", textAlignment: "left" },
            content: this.inlineTokensToContent(token.tokens),
            children: [],
          });
          break;
        }
        case "list": {
          // An image between two steps splits one markdown list in two; the
          // second list keeps its number (marked reports it as `start`), so the
          // first item carries it or BlockNote would restart the count at 1.
          const start = token.ordered && typeof token.start === "number" && token.start > 1 ? token.start : undefined;
          for (const [index, item] of (token.items as any[]).entries()) {
            const nested = (item.tokens ?? []).filter((t: any) => t.type === "list");
            const inline = (item.tokens ?? []).filter((t: any) => t.type !== "list");
            const content = this.inlineTokensToContent(
              inline.flatMap((t: any) => (t.type === "text" && t.tokens ? t.tokens : [t])),
            );
            const children = nested.flatMap((t: any) => this.tokensToNodes([t]));
            const base = { textColor: "default", backgroundColor: "default", textAlignment: "left" };
            if (item.task) {
              nodes.push({
                id: randomUUID(),
                type: "checkListItem",
                props: { ...base, checked: item.checked || false },
                content,
                children,
              });
            } else if (token.ordered) {
              const props = index === 0 && start !== undefined ? { ...base, start } : base;
              nodes.push({ id: randomUUID(), type: "numberedListItem", props, content, children });
            } else {
              nodes.push({ id: randomUUID(), type: "bulletListItem", props: base, content, children });
            }
          }
          break;
        }
        case "blockquote":
          nodes.push({
            id: randomUUID(),
            type: "quote",
            props: { textColor: "default", backgroundColor: "default" },
            content: this.inlineTokensToContent(
              (token.tokens ?? []).flatMap((t: any) => (t.type === "paragraph" ? t.tokens : [t])),
            ),
            children: [],
          });
          break;
        case "table":
          // Tables are not supported by this converter; guides do not use them.
          break;
        case "code":
          nodes.push({
            id: randomUUID(),
            type: "codeBlock",
            props: {
              textColor: "default",
              backgroundColor: "default",
              textAlignment: "left",
              language: token.lang || "",
            },
            content: [{ type: "text", text: token.text, styles: {} }],
            children: [],
          });
          break;
        default:
          // You can add more cases here for blockquotes, horizontal rules, etc.
          break;
      }
    }
    return nodes;
  }

  /**
   * Convert inline tokens to content array.
   */
  protected inlineTokensToContent(tokens: any[]): any[] {
    if (!tokens) return [];
    const content = [];
    for (const token of tokens) {
      switch (token.type) {
        case "text":
          // Handle nested tokens within text tokens (common in list items)
          if (token.tokens && token.tokens.length > 0) {
            content.push(...this.inlineTokensToContent(token.tokens));
          } else {
            content.push({ type: "text", text: token.text, styles: {} });
          }
          break;
        case "strong":
          // Apply bold styling properly in BlockNote format
          if (token.tokens && token.tokens.length > 0) {
            const strongContent = this.inlineTokensToContent(token.tokens);
            strongContent.forEach((item) => {
              if (item.type === "text") {
                item.styles = { ...item.styles, bold: true };
              }
            });
            content.push(...strongContent);
          } else {
            content.push({
              type: "text",
              text: token.text,
              styles: { bold: true },
            });
          }
          break;
        case "em":
          // Apply italic styling properly in BlockNote format
          if (token.tokens && token.tokens.length > 0) {
            const emContent = this.inlineTokensToContent(token.tokens);
            emContent.forEach((item) => {
              if (item.type === "text") {
                item.styles = { ...item.styles, italic: true };
              }
            });
            content.push(...emContent);
          } else {
            content.push({
              type: "text",
              text: token.text,
              styles: { italic: true },
            });
          }
          break;
        case "del":
          // Apply strikethrough styling properly in BlockNote format
          if (token.tokens && token.tokens.length > 0) {
            const delContent = this.inlineTokensToContent(token.tokens);
            delContent.forEach((item) => {
              if (item.type === "text") {
                item.styles = { ...item.styles, strike: true };
              }
            });
            content.push(...delContent);
          } else {
            content.push({
              type: "text",
              text: token.text,
              styles: { strike: true },
            });
          }
          break;
        case "codespan":
          // Apply code styling properly in BlockNote format
          content.push({
            type: "text",
            text: token.text,
            styles: { code: true },
          });
          break;
        case "link": {
          const href = String(token.href ?? "");
          const m = /^mention:\/\/([^/]+)\/(.+)$/.exec(href);
          if (m) {
            const [, entityType, id] = m;
            const aliasText =
              token.tokens && token.tokens.length > 0
                ? this.inlineTokensToContent(token.tokens)
                    .map((c: any) => c.text ?? "")
                    .join("")
                : (token.text ?? "");
            content.push({
              type: "mention",
              props: { id, entityType, alias: aliasText },
            });
          } else {
            const inner =
              token.tokens && token.tokens.length > 0
                ? this.inlineTokensToContent(token.tokens).filter((c: any) => c.type === "text")
                : [{ type: "text", text: token.text || "", styles: {} }];
            content.push({ type: "link", href, content: inner });
          }
          break;
        }
        default:
          // Fallback for any unsupported inline types.
          content.push({ type: "text", text: token.text || "", styles: {} });
          break;
      }
    }
    return content;
  }

  /**
   * Process a single node to markdown.
   */
  protected processNode(node: any, indentLevel = 0, preserveMentions = false): string {
    switch (node.type) {
      case "paragraph":
        return this.processParagraph(node, preserveMentions);
      case "heading":
        return this.processHeading(node, preserveMentions);
      case "bulletListItem":
        return this.processBulletListItem(node, indentLevel, preserveMentions);
      case "numberedListItem":
        return this.processNumberedListItem(node, indentLevel, preserveMentions);
      case "checkListItem":
        return this.processCheckListItem(node, indentLevel, preserveMentions);
      case "codeBlock":
        return this.processCodeBlock(node, preserveMentions);
      case "image":
        return `![${node.props?.caption ?? ""}](${node.props?.url ?? ""})\n\n`;
      case "quote":
        return `> ${this.processContent(node.content, preserveMentions)}\n\n`;
      default:
        return "";
    }
  }

  protected processParagraph(node: any, preserveMentions = false): string {
    const content = this.processContent(node.content, preserveMentions);
    return `${content}\n\n`;
  }

  protected processHeading(node: any, preserveMentions = false): string {
    const level = node.props.level || 1;
    const hashes = "#".repeat(level);
    const content = this.processContent(node.content, preserveMentions);
    return `${hashes} ${content}\n\n`;
  }

  protected processBulletListItem(node: any, indentLevel: number, preserveMentions = false): string {
    const indent = "  ".repeat(indentLevel);
    const content = this.processContent(node.content, preserveMentions);
    let markdown = `${indent}- ${content}\n`;

    if (node.children && node.children.length > 0) {
      node.children.forEach((child: any) => {
        markdown += this.processNode(child, indentLevel + 1, preserveMentions);
      });
    }

    return markdown;
  }

  protected processNumberedListItem(node: any, indentLevel: number, preserveMentions = false): string {
    const indent = "  ".repeat(indentLevel);
    const content = this.processContent(node.content, preserveMentions);
    // Markdown numbers a list from its first item, so only a resumed list
    // (BlockNote `start`) needs a number other than 1 here.
    let markdown = `${indent}${node.props?.start ?? 1}. ${content}\n`;

    if (node.children && node.children.length > 0) {
      node.children.forEach((child: any) => {
        markdown += this.processNode(child, indentLevel + 1, preserveMentions);
      });
    }

    return markdown;
  }

  protected processCheckListItem(node: any, indentLevel: number, preserveMentions = false): string {
    const indent = "  ".repeat(indentLevel);
    const checked = node.props.checked ? "x" : " ";
    const content = this.processContent(node.content, preserveMentions);
    let markdown = `${indent}- [${checked}] ${content}\n`;

    if (node.children && node.children.length > 0) {
      node.children.forEach((child: any) => {
        markdown += this.processCheckListItem(child, indentLevel + 1, preserveMentions);
      });
    }

    return markdown;
  }

  protected processCodeBlock(node: any, preserveMentions = false): string {
    const language = node.props.language || "";
    const content = this.processContent(node.content, preserveMentions);
    return `\`\`\`${language}\n${content}\n\`\`\`\n\n`;
  }

  protected processContent(contentArray: any[], preserveMentions = false): string {
    // BlockNote's input shorthand allows a block's content to be a bare
    // string instead of an inline-node array, and stored blocks written that
    // way exist in the wild; a missing content is an empty block.
    if (typeof contentArray === "string") return contentArray;
    if (!Array.isArray(contentArray)) return "";
    return contentArray
      .map((contentNode) => {
        if (contentNode.type === "text") {
          const text = this.applyTextStyles(contentNode.text, contentNode.styles);
          return text;
        } else if (contentNode.type === "relationship") {
          return this.processRelationship(contentNode);
        } else if (contentNode.type === "mention") {
          return this.processMention(contentNode, preserveMentions);
        } else if (contentNode.type === "link") {
          return "[" + this.processContent(contentNode.content, preserveMentions) + "](" + contentNode.href + ")";
        }
        return "";
      })
      .join("");
  }

  /**
   * Render a BlockNote mention inline node.
   *
   * Default: the human-readable alias, so LLM prompts and search indexes see a
   * name rather than a hole in the text.
   *
   * preserveMentions: a markdown link the mention parser can read back, so a
   * stored message keeps its entity pointers and can be re-rendered with
   * hovercards. Kept opt-in because the alias form is what the summariser,
   * chunker and prompt paths want.
   */
  protected processMention(node: any, preserveMentions = false): string {
    const alias = node?.props?.alias ?? "";
    if (!preserveMentions) return alias;
    const id = node?.props?.id;
    const entityType = node?.props?.entityType;
    if (!id || !entityType) return alias;
    return "[" + alias + "](mention://" + entityType + "/" + id + ")";
  }

  protected applyTextStyles(text: string, styles: any): string {
    if (!styles) return text;

    if (styles.bold) {
      text = `**${text}**`;
    }
    if (styles.italic) {
      text = `*${text}*`;
    }
    if (styles.strike) {
      text = `~~${text}~~`;
    }

    return text;
  }

  protected processRelationship(node: any): string {
    return node.props.alias || "";
  }

  protected processContentNodes(nodes: any[]): string {
    return nodes
      .map((node) => {
        switch (node.type) {
          case "paragraph":
            return this.processContent(node.content || []).trim();
          case "bulletListItem":
          case "numberedListItem":
          case "checkListItem":
            return `• ${this.processContent(node.content || []).trim()}`;
          case "codeBlock":
            const language = node.props?.language || "";
            const codeContent = this.processContent(node.content || []);
            return `\`\`\`${language}\n${codeContent}\n\`\`\``;
          default:
            return this.processContent(node.content || []).trim();
        }
      })
      .filter((content) => content.length > 0)
      .join("\n");
  }

  /**
   * Converts a BlockNoteJS/Prosemirror data structure into plain text (no markdown formatting).
   */
  convertToPlainText(params: { nodes: any[] }): string {
    return params.nodes.map((node) => this.processNodeAsPlainText(node)).join("");
  }

  // Plain text conversion methods (no markdown formatting)
  protected processNodeAsPlainText(node: any, indentLevel = 0): string {
    switch (node.type) {
      case "paragraph":
        return this.processParagraphAsPlainText(node);
      case "heading":
        return this.processHeadingAsPlainText(node);
      case "bulletListItem":
        return this.processBulletListItemAsPlainText(node, indentLevel);
      case "numberedListItem":
        return this.processNumberedListItemAsPlainText(node, indentLevel);
      case "checkListItem":
        return this.processCheckListItemAsPlainText(node, indentLevel);
      case "codeBlock":
        return this.processCodeBlockAsPlainText(node);
      case "quote":
        return `${this.processContentAsPlainText(node.content)}\n\n`;
      case "image":
        return `${node.props?.caption ?? ""}\n\n`;
      default:
        return "";
    }
  }

  protected processParagraphAsPlainText(node: any): string {
    const content = this.processContentAsPlainText(node.content);
    return `${content}\n\n`;
  }

  protected processHeadingAsPlainText(node: any): string {
    const content = this.processContentAsPlainText(node.content);
    return `${content}\n\n`;
  }

  protected processBulletListItemAsPlainText(node: any, indentLevel: number): string {
    const indent = "  ".repeat(indentLevel);
    const content = this.processContentAsPlainText(node.content);
    let text = `${indent}• ${content}\n`;

    if (node.children && node.children.length > 0) {
      node.children.forEach((child: any) => {
        text += this.processNodeAsPlainText(child, indentLevel + 1);
      });
    }

    return text;
  }

  protected processNumberedListItemAsPlainText(node: any, indentLevel: number): string {
    const indent = "  ".repeat(indentLevel);
    const content = this.processContentAsPlainText(node.content);
    let text = `${indent}• ${content}\n`;

    if (node.children && node.children.length > 0) {
      node.children.forEach((child: any) => {
        text += this.processNodeAsPlainText(child, indentLevel + 1);
      });
    }

    return text;
  }

  protected processCheckListItemAsPlainText(node: any, indentLevel: number): string {
    const indent = "  ".repeat(indentLevel);
    const checked = node.props.checked ? "✓" : "○";
    const content = this.processContentAsPlainText(node.content);
    let text = `${indent}${checked} ${content}\n`;

    if (node.children && node.children.length > 0) {
      node.children.forEach((child: any) => {
        text += this.processCheckListItemAsPlainText(child, indentLevel + 1);
      });
    }

    return text;
  }

  protected processCodeBlockAsPlainText(node: any): string {
    const content = this.processContentAsPlainText(node.content);
    return `${content}\n\n`;
  }

  protected processContentAsPlainText(contentArray: any[]): string {
    if (!contentArray) return "";
    return contentArray
      .map((contentNode) => {
        if (contentNode.type === "text") {
          return contentNode.text;
        } else if (contentNode.type === "relationship") {
          return contentNode.props?.alias || "";
        } else if (contentNode.type === "mention") {
          return contentNode.props?.alias || "";
        } else if (contentNode.type === "link") {
          return this.processContentAsPlainText(contentNode.content);
        }
        return "";
      })
      .join("");
  }
}
