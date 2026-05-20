import { Injectable } from "@nestjs/common";
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  convertInchesToTwip,
} from "docx";
import sharp from "sharp";

// ---------------------------------------------------------------------------
// Local company-info shape used only in this service.
// Mirrors the fields actually consumed from CompanyInterface
// (from @carlonicora/nextjs-jsonapi) without importing that frontend package.
// ---------------------------------------------------------------------------
export interface BlockNoteCompanyInfo {
  name: string;
  legal_address?: string;
  fiscal_data?: string;
  /** Preferred logo URL (S3 signed URL or absolute HTTP URL). */
  logoUrl?: string;
  /** Fallback logo field. */
  logo?: string;
}

// ---------------------------------------------------------------------------
// Public context shape passed to render().
// ---------------------------------------------------------------------------
export interface BlockNoteRenderContext {
  /** Document title (rendered as H1). */
  title: string;
  /**
   * Sections to render. Each section gets an H2 title followed by
   * markdown-parsed content.
   */
  sections: Array<{ title: string; content: string }>;
  /** Company information for the page header. */
  company: BlockNoteCompanyInfo;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface Section {
  title: string;
  content: string;
}

interface ListItem {
  text: string;
  level: number;
}

interface MarkdownNode {
  type: "paragraph" | "heading" | "list" | "table" | "blockquote" | "code";
  level?: number;
  ordered?: boolean;
  content?: string;
  rows?: string[][];
  items?: ListItem[];
}

// ---------------------------------------------------------------------------
// Image helpers (Node-compatible replacements for browser Image API)
// ---------------------------------------------------------------------------

/** Detects image MIME type from URL extension or Content-Type header. */
function detectImageType(url: string, contentType?: string): "jpg" | "png" | "gif" | "webp" {
  if (contentType) {
    if (contentType.includes("png")) return "png";
    if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
    if (contentType.includes("gif")) return "gif";
    if (contentType.includes("webp")) return "webp";
  }

  const urlLower = url.toLowerCase();
  if (urlLower.endsWith(".png") || urlLower.includes(".png?")) return "png";
  if (urlLower.endsWith(".gif") || urlLower.includes(".gif?")) return "gif";
  if (urlLower.endsWith(".webp") || urlLower.includes(".webp?")) return "webp";

  return "jpg";
}

/**
 * Calculates scaled dimensions to fit within max bounds while preserving
 * aspect ratio. Never upscales (scale capped at 1).
 */
function calculateScaledDimensions(
  originalWidth: number,
  originalHeight: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  const scale = Math.min(maxWidth / originalWidth, maxHeight / originalHeight, 1);
  return {
    width: Math.round(originalWidth * scale),
    height: Math.round(originalHeight * scale),
  };
}

/**
 * Uses `sharp` to read image dimensions from a Node.js Buffer.
 * Falls back to (200, 50) defaults on failure.
 */
async function getImageDimensionsFromBuffer(buffer: Buffer): Promise<{ width: number; height: number }> {
  try {
    const metadata = await sharp(buffer).metadata();
    return {
      width: metadata.width ?? 200,
      height: metadata.height ?? 50,
    };
  } catch {
    return { width: 200, height: 50 };
  }
}

/**
 * Fetches a logo image from an absolute URL and returns it as a Buffer
 * together with its type and scaled dimensions.
 *
 * Returns null on any network or processing error so that document
 * generation can proceed without the logo.
 */
async function fetchLogoImage(
  logo: string,
): Promise<{ buffer: Buffer; type: "jpg" | "png" | "gif" | "webp"; width: number; height: number } | null> {
  try {
    // On the backend every logo URL must already be absolute.
    const response = await fetch(logo);
    if (!response.ok) return null;

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType = response.headers.get("content-type") ?? undefined;
    const type = detectImageType(logo, contentType);
    const dimensions = await getImageDimensionsFromBuffer(buffer);
    const scaled = calculateScaledDimensions(dimensions.width, dimensions.height, 200, 50);

    return { buffer, type, ...scaled };
  } catch (error) {
    console.error("[BlockNoteToDocxService] Error fetching logo:", error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// DOCX header / footer builders
// ---------------------------------------------------------------------------

async function createDocumentHeader(company: BlockNoteCompanyInfo): Promise<Header> {
  let logoData: { buffer: Buffer; type: "jpg" | "png" | "gif" | "webp"; width: number; height: number } | null = null;
  const logoUrl = company.logoUrl ?? company.logo;
  if (logoUrl) {
    logoData = await fetchLogoImage(logoUrl);
  }

  const leftColumnParagraphs: Paragraph[] = [];

  if (logoData) {
    try {
      leftColumnParagraphs.push(
        new Paragraph({
          children: [
            new ImageRun({
              data: logoData.buffer,
              transformation: { width: logoData.width, height: logoData.height },
              type: logoData.type,
            } as any),
          ],
          spacing: { after: 80 },
        }),
      );
    } catch (error) {
      console.error("[BlockNoteToDocxService] Failed to embed logo in header:", error);
    }
  }

  leftColumnParagraphs.push(
    new Paragraph({
      children: [new TextRun({ text: company.name, bold: true, size: 24 })],
      spacing: { after: 40 },
    }),
  );

  const rightColumnParagraphs: Paragraph[] = [];

  if (company.legal_address) {
    rightColumnParagraphs.push(
      new Paragraph({
        children: [new TextRun({ text: company.legal_address, size: 18 })],
        alignment: AlignmentType.RIGHT,
        spacing: { after: 40 },
      }),
    );
  }

  if (company.fiscal_data) {
    try {
      const fiscalData = JSON.parse(company.fiscal_data);
      if (fiscalData.partita_iva) {
        rightColumnParagraphs.push(
          new Paragraph({
            children: [
              new TextRun({ text: "P.IVA: ", bold: true, size: 18 }),
              new TextRun({ text: fiscalData.partita_iva, size: 18 }),
            ],
            alignment: AlignmentType.RIGHT,
            spacing: { after: 40 },
          }),
        );
      }
      if (fiscalData.codice_fiscale) {
        rightColumnParagraphs.push(
          new Paragraph({
            children: [
              new TextRun({ text: "C.F.: ", bold: true, size: 18 }),
              new TextRun({ text: fiscalData.codice_fiscale, size: 18 }),
            ],
            alignment: AlignmentType.RIGHT,
            spacing: { after: 40 },
          }),
        );
      }
    } catch {
      rightColumnParagraphs.push(
        new Paragraph({
          children: [new TextRun({ text: company.fiscal_data, size: 18 })],
          alignment: AlignmentType.RIGHT,
          spacing: { after: 40 },
        }),
      );
    }
  }

  const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const headerTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: noBorder,
      bottom: noBorder,
      left: noBorder,
      right: noBorder,
      insideHorizontal: noBorder,
      insideVertical: noBorder,
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            children: leftColumnParagraphs,
            width: { size: 40, type: WidthType.PERCENTAGE },
            verticalAlign: "top" as any,
          }),
          new TableCell({
            children: rightColumnParagraphs,
            width: { size: 60, type: WidthType.PERCENTAGE },
            verticalAlign: "top" as any,
          }),
        ],
      }),
    ],
  });

  const separator = new Paragraph({
    border: {
      bottom: { color: "000000", space: 1, style: BorderStyle.SINGLE, size: 6 },
    },
    spacing: { after: 120 },
  });

  return new Header({ children: [headerTable, separator] });
}

function createDocumentFooter(title: string): Footer {
  const separator = new Paragraph({
    border: {
      top: { color: "000000", space: 1, style: BorderStyle.SINGLE, size: 6 },
    },
    spacing: { before: 120 },
  });

  const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const footerTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: noBorder,
      bottom: noBorder,
      left: noBorder,
      right: noBorder,
      insideHorizontal: noBorder,
      insideVertical: noBorder,
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            children: [
              new Paragraph({
                children: [new TextRun({ text: title, size: 18, italics: true })],
              }),
            ],
            width: { size: 50, type: WidthType.PERCENTAGE },
            verticalAlign: "center" as any,
          }),
          new TableCell({
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: "Page ", size: 18 }),
                  new TextRun({ children: [PageNumber.CURRENT] }),
                  new TextRun({ text: " of ", size: 18 }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES] }),
                ],
                alignment: AlignmentType.RIGHT,
              }),
            ],
            width: { size: 50, type: WidthType.PERCENTAGE },
            verticalAlign: "center" as any,
          }),
        ],
      }),
    ],
  });

  return new Footer({ children: [separator, footerTable] });
}

// ---------------------------------------------------------------------------
// Markdown parser (identical logic to export-markdown-to-docx.ts)
// ---------------------------------------------------------------------------

function parseMarkdown(markdown: string): MarkdownNode[] {
  const nodes: MarkdownNode[] = [];
  const lines = markdown.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      nodes.push({ type: "heading", level: headingMatch[1].length, content: headingMatch[2].trim() });
      i++;
      continue;
    }

    // Blockquotes
    if (line.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        quoteLines.push(lines[i].substring(2));
        i++;
      }
      nodes.push({ type: "blockquote", content: quoteLines.join("\n") });
      continue;
    }

    // Code blocks
    if (line.startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      nodes.push({ type: "code", content: codeLines.join("\n") });
      continue;
    }

    // Unordered lists
    if (line.match(/^\s*[\-\*]\s+/)) {
      const items: ListItem[] = [];
      while (i < lines.length && lines[i].match(/^\s*[\-\*]\s+/)) {
        const leadingSpaces = lines[i].match(/^(\s*)/)?.[1].length ?? 0;
        items.push({ text: lines[i].replace(/^\s*[\-\*]\s+/, "").trim(), level: Math.floor(leadingSpaces / 4) });
        i++;
      }
      nodes.push({ type: "list", ordered: false, items });
      continue;
    }

    // Ordered lists
    if (line.match(/^\s*\d+\.\s+/)) {
      const items: ListItem[] = [];
      while (i < lines.length && lines[i].match(/^\s*\d+\.\s+/)) {
        const leadingSpaces = lines[i].match(/^(\s*)/)?.[1].length ?? 0;
        items.push({ text: lines[i].replace(/^\s*\d+\.\s+/, "").trim(), level: Math.floor(leadingSpaces / 4) });
        i++;
      }
      nodes.push({ type: "list", ordered: true, items });
      continue;
    }

    // Tables
    if (line.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        if (!lines[i].match(/^\|[\s\-:]+\|/)) {
          rows.push(
            lines[i]
              .split("|")
              .slice(1, -1)
              .map((cell) => cell.trim()),
          );
        }
        i++;
      }
      if (rows.length > 0) nodes.push({ type: "table", rows });
      continue;
    }

    // Paragraph
    const paragraphLines: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !lines[i].match(/^(#{1,6}|\||[\-\*]|\d+\.|\>|```)/)) {
      paragraphLines.push(lines[i]);
      i++;
    }
    nodes.push({ type: "paragraph", content: paragraphLines.join(" ") });
  }

  return nodes;
}

// ---------------------------------------------------------------------------
// Inline formatting parser (identical logic to export-markdown-to-docx.ts)
// ---------------------------------------------------------------------------

function parseInlineFormatting(text: string): (TextRun | ExternalHyperlink)[] {
  const elements: (TextRun | ExternalHyperlink)[] = [];
  let currentText = text;

  interface Match {
    index: number;
    length: number;
    text: string;
    bold?: boolean;
    italics?: boolean;
    code?: boolean;
    link?: boolean;
    url?: string;
  }

  while (currentText.length > 0) {
    let foundMatch: Match | null = null;
    let earliestIndex = currentText.length;

    // Bold + italic (***)
    const boldItalicMatch = currentText.match(/\*\*\*([^*]+?)\*\*\*/);
    if (boldItalicMatch?.index !== undefined && boldItalicMatch.index < earliestIndex) {
      const before = boldItalicMatch.index > 0 ? currentText[boldItalicMatch.index - 1] : "";
      const after =
        boldItalicMatch.index + boldItalicMatch[0].length < currentText.length
          ? currentText[boldItalicMatch.index + boldItalicMatch[0].length]
          : "";
      if (before !== "*" && after !== "*") {
        earliestIndex = boldItalicMatch.index;
        foundMatch = {
          index: boldItalicMatch.index,
          length: boldItalicMatch[0].length,
          text: boldItalicMatch[1],
          bold: true,
          italics: true,
        };
      }
    }

    // Bold (**)
    if (!foundMatch || foundMatch.index > 0) {
      const boldMatch = currentText.match(/\*\*([^*]+?)\*\*/);
      if (boldMatch?.index !== undefined && boldMatch.index < earliestIndex) {
        const before = boldMatch.index > 0 ? currentText[boldMatch.index - 1] : "";
        const after =
          boldMatch.index + boldMatch[0].length < currentText.length
            ? currentText[boldMatch.index + boldMatch[0].length]
            : "";
        if (before !== "*" && after !== "*") {
          earliestIndex = boldMatch.index;
          foundMatch = {
            index: boldMatch.index,
            length: boldMatch[0].length,
            text: boldMatch[1],
            bold: true,
            italics: false,
          };
        }
      }
    }

    // Italic (*)
    if (!foundMatch || foundMatch.index > 0) {
      const italicMatch = currentText.match(/\*([^*]+?)\*/);
      if (italicMatch?.index !== undefined && italicMatch.index < earliestIndex) {
        const before = italicMatch.index > 0 ? currentText[italicMatch.index - 1] : "";
        const after =
          italicMatch.index + italicMatch[0].length < currentText.length
            ? currentText[italicMatch.index + italicMatch[0].length]
            : "";
        if (before !== "*" && after !== "*") {
          earliestIndex = italicMatch.index;
          foundMatch = {
            index: italicMatch.index,
            length: italicMatch[0].length,
            text: italicMatch[1],
            bold: false,
            italics: true,
          };
        }
      }
    }

    // Inline code (`)
    const codeMatch = currentText.match(/`(.+?)`/);
    if (codeMatch?.index !== undefined && codeMatch.index < earliestIndex) {
      earliestIndex = codeMatch.index;
      foundMatch = { index: codeMatch.index, length: codeMatch[0].length, text: codeMatch[1], code: true };
    }

    // Links ([text](url))
    const linkMatch = currentText.match(/\[(.+?)\]\((.+?)\)/);
    if (linkMatch?.index !== undefined && linkMatch.index < earliestIndex) {
      earliestIndex = linkMatch.index;
      foundMatch = {
        index: linkMatch.index,
        length: linkMatch[0].length,
        text: linkMatch[1],
        url: linkMatch[2],
        link: true,
      };
    }

    // Underscore emphasis — CommonMark requires the underscore NOT to be
    // flanked by an alphanumeric character on the inner side (i.e. intra-word
    // underscores such as `primary_contact_name` are NEVER emphasis). The
    // asterisk variants do not have this restriction.
    const isWordChar = (c: string): boolean => /\w/.test(c);
    const isUnderscoreEmphasis = (m: RegExpMatchArray): boolean => {
      const startIdx = m.index!;
      const endIdx = startIdx + m[0].length;
      const before = startIdx > 0 ? currentText[startIdx - 1] : "";
      const after = endIdx < currentText.length ? currentText[endIdx] : "";
      return !isWordChar(before) && !isWordChar(after);
    };

    // Underscore bold+italic (___)
    const underscoreBoldItalicMatch = currentText.match(/___(.+?)___/);
    if (
      underscoreBoldItalicMatch?.index !== undefined &&
      underscoreBoldItalicMatch.index < earliestIndex &&
      isUnderscoreEmphasis(underscoreBoldItalicMatch)
    ) {
      earliestIndex = underscoreBoldItalicMatch.index;
      foundMatch = {
        index: underscoreBoldItalicMatch.index,
        length: underscoreBoldItalicMatch[0].length,
        text: underscoreBoldItalicMatch[1],
        bold: true,
        italics: true,
      };
    }

    // Underscore bold (__)
    const underscoreBoldMatch = currentText.match(/__(.+?)__/);
    if (
      underscoreBoldMatch?.index !== undefined &&
      underscoreBoldMatch.index < earliestIndex &&
      isUnderscoreEmphasis(underscoreBoldMatch)
    ) {
      earliestIndex = underscoreBoldMatch.index;
      foundMatch = {
        index: underscoreBoldMatch.index,
        length: underscoreBoldMatch[0].length,
        text: underscoreBoldMatch[1],
        bold: true,
        italics: false,
      };
    }

    // Underscore italic (_)
    const underscoreItalicMatch = currentText.match(/_(.+?)_/);
    if (
      underscoreItalicMatch?.index !== undefined &&
      underscoreItalicMatch.index < earliestIndex &&
      isUnderscoreEmphasis(underscoreItalicMatch)
    ) {
      earliestIndex = underscoreItalicMatch.index;
      foundMatch = {
        index: underscoreItalicMatch.index,
        length: underscoreItalicMatch[0].length,
        text: underscoreItalicMatch[1],
        bold: false,
        italics: true,
      };
    }

    if (foundMatch) {
      if (foundMatch.length === 0) {
        elements.push(new TextRun({ text: currentText }));
        break;
      }

      if (foundMatch.index > 0) {
        elements.push(new TextRun({ text: currentText.substring(0, foundMatch.index) }));
      }

      if (foundMatch.link && foundMatch.url) {
        elements.push(
          new ExternalHyperlink({
            children: [new TextRun({ text: foundMatch.text, style: "Hyperlink" })],
            link: foundMatch.url,
          }),
        );
      } else {
        elements.push(
          new TextRun({
            text: foundMatch.text,
            bold: foundMatch.bold,
            italics: foundMatch.italics,
            font: foundMatch.code ? "Courier New" : undefined,
            size: foundMatch.code ? 20 : undefined,
          }),
        );
      }

      currentText = currentText.substring(foundMatch.index + foundMatch.length);
    } else {
      if (currentText.length > 0) elements.push(new TextRun({ text: currentText }));
      break;
    }
  }

  if (elements.length === 0) elements.push(new TextRun({ text }));
  return elements;
}

// ---------------------------------------------------------------------------
// Markdown node → DOCX elements converter
// ---------------------------------------------------------------------------

function nodeToDocxElements(node: MarkdownNode): (Paragraph | Table)[] {
  switch (node.type) {
    case "heading": {
      const headingLevels: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
        1: HeadingLevel.HEADING_1,
        2: HeadingLevel.HEADING_2,
        3: HeadingLevel.HEADING_3,
        4: HeadingLevel.HEADING_4,
        5: HeadingLevel.HEADING_5,
        6: HeadingLevel.HEADING_6,
      };
      return [
        new Paragraph({
          children: parseInlineFormatting(node.content ?? ""),
          heading: headingLevels[node.level ?? 1],
          spacing: { before: 240, after: 120 },
          keepNext: true,
        }),
      ];
    }

    case "paragraph": {
      if (!node.content) return [];
      return [
        new Paragraph({
          children: parseInlineFormatting(node.content),
          spacing: { after: 120 },
        }),
      ];
    }

    case "list": {
      if (!node.items) return [];
      return node.items.map(
        (item) =>
          new Paragraph({
            children: parseInlineFormatting(item.text),
            bullet: !node.ordered ? { level: item.level } : undefined,
            numbering: node.ordered ? { reference: "default-numbering", level: item.level } : undefined,
            spacing: { after: 80 },
          }),
      );
    }

    case "blockquote": {
      if (!node.content) return [];
      return [
        new Paragraph({
          children: parseInlineFormatting(node.content),
          border: { left: { color: "999999", space: 1, style: BorderStyle.SINGLE, size: 8 } },
          indent: { left: convertInchesToTwip(0.5) },
          spacing: { after: 120 },
          shading: { fill: "F5F5F5" },
        }),
      ];
    }

    case "code": {
      if (!node.content) return [];
      return [
        new Paragraph({
          children: [new TextRun({ text: node.content, font: "Courier New", size: 20 })],
          shading: { fill: "F5F5F5" },
          spacing: { after: 120 },
        }),
      ];
    }

    case "table": {
      if (!node.rows || node.rows.length === 0) return [];
      const tableRows = node.rows.map(
        (row, rowIndex) =>
          new TableRow({
            children: row.map(
              (cell) =>
                new TableCell({
                  children: [new Paragraph({ children: parseInlineFormatting(cell) })],
                  shading: rowIndex === 0 ? { fill: "E7E6E6" } : undefined,
                }),
            ),
          }),
      );
      return [new Table({ rows: tableRows, width: { size: 100, type: WidthType.PERCENTAGE } })];
    }

    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// BlockNote → DOCX pipeline helpers
// ---------------------------------------------------------------------------

function extractInlineText(content: any[]): string {
  if (!content || !Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (typeof item === "string") return item;
      if (item.type === "text") {
        let t: string = item.text ?? "";
        if (item.styles?.bold) t = `**${t}**`;
        if (item.styles?.italic) t = `*${t}*`;
        if (item.styles?.code) t = `\`${t}\``;
        return t;
      }
      if (item.type === "link") {
        return `[${extractInlineText(item.content ?? [])}](${item.href ?? ""})`;
      }
      if (item.type === "templateField") {
        return `[[${item.props?.alias ?? item.props?.fieldId ?? "unknown"}]]`;
      }
      return item.text ?? "";
    })
    .join("");
}

function blockNodeToMarkdown(block: any, depth = 0): string {
  if (!block) return "";

  const indent = "    ".repeat(depth);
  const type: string = block.type ?? "";
  const text = extractInlineText(block.content ?? []);
  const children: any[] = block.children ?? [];
  let md = "";

  switch (type) {
    case "heading": {
      const level = block.props?.level ?? 1;
      md = `${"#".repeat(level)} ${text}\n\n`;
      break;
    }
    case "heading1":
      md = `# ${text}\n\n`;
      break;
    case "heading2":
      md = `## ${text}\n\n`;
      break;
    case "heading3":
      md = `### ${text}\n\n`;
      break;
    case "paragraph":
      md = text ? `${indent}${text}\n\n` : "\n";
      break;
    case "bulletListItem":
    case "listItem":
      md = `${indent}- ${text}\n`;
      break;
    case "numberedListItem":
      md = `${indent}1. ${text}\n`;
      break;
    case "checkListItem": {
      const checked = block.props?.checked ? "x" : " ";
      md = `${indent}- [${checked}] ${text}\n`;
      break;
    }
    case "quote":
    case "blockquote":
      md = `> ${text}\n\n`;
      break;
    case "code":
      md = `\`\`\`\n${text}\n\`\`\`\n\n`;
      break;
    case "table": {
      if (block.content?.rows) {
        const rows = block.content.rows;
        for (let i = 0; i < rows.length; i++) {
          const cells = rows[i].cells ?? [];
          const rowText = cells.map((cell: any) => extractInlineText(cell)).join(" | ");
          md += `| ${rowText} |\n`;
          if (i === 0) md += `| ${cells.map(() => "---").join(" | ")} |\n`;
        }
        md += "\n";
      }
      break;
    }
    default:
      if (text) md = `${indent}${text}\n\n`;
      break;
  }

  for (const child of children) {
    md += blockNodeToMarkdown(child, depth + 1);
  }

  return md;
}

function blocksToMarkdown(blocks: any[]): string {
  if (!blocks || !Array.isArray(blocks)) return "";
  return blocks.map((block) => blockNodeToMarkdown(block)).join("");
}

/**
 * Diagnostic helper: collect every templateField's fieldId/alias pair found
 * in a tree of BlockNote blocks. Used only for one-shot debugging of the
 * "placeholder didn't get replaced" class of bug.
 */
function collectTemplateFieldIds(blocks: any[]): Array<{ fieldId: string; alias: string }> {
  const out: Array<{ fieldId: string; alias: string }> = [];
  const walk = (nodes: any[]): void => {
    for (const block of nodes ?? []) {
      if (Array.isArray(block?.content)) {
        for (const item of block.content) {
          if (item?.type === "templateField") {
            out.push({ fieldId: String(item.props?.fieldId ?? ""), alias: String(item.props?.alias ?? "") });
          }
        }
      }
      if (Array.isArray(block?.children)) walk(block.children);
      if (Array.isArray(block?.content?.rows)) {
        for (const row of block.content.rows) {
          for (const cell of row.cells ?? []) {
            if (Array.isArray(cell)) {
              for (const item of cell) {
                if (item?.type === "templateField") {
                  out.push({ fieldId: String(item.props?.fieldId ?? ""), alias: String(item.props?.alias ?? "") });
                }
              }
            }
          }
        }
      }
    }
  };
  walk(blocks);
  return out;
}

/**
 * Recursively walk BlockNote JSON and replace `templateField` inline nodes
 * with plain text nodes containing the field value from fieldContext.
 */
function replaceFieldNodes(blocks: any[], fieldContext: Record<string, unknown>): void {
  for (const block of blocks) {
    if (block.content && Array.isArray(block.content)) {
      for (let i = 0; i < block.content.length; i++) {
        const item = block.content[i];
        if (item.type === "templateField") {
          const fieldId: string = item.props?.fieldId ?? item.props?.alias ?? "";
          const value = fieldContext[fieldId] != null ? String(fieldContext[fieldId]) : `[[${fieldId}]]`;
          block.content[i] = { type: "text", text: value, styles: {} };
        }
      }
    }
    if (block.children && Array.isArray(block.children)) {
      replaceFieldNodes(block.children, fieldContext);
    }
    // Table content (rows > cells > inline content)
    if (block.content?.rows && Array.isArray(block.content.rows)) {
      for (const row of block.content.rows) {
        for (const cell of row.cells ?? []) {
          if (Array.isArray(cell)) {
            for (let i = 0; i < cell.length; i++) {
              if (cell[i].type === "templateField") {
                const fieldId: string = cell[i].props?.fieldId ?? cell[i].props?.alias ?? "";
                const value = fieldContext[fieldId] != null ? String(fieldContext[fieldId]) : `[[${fieldId}]]`;
                cell[i] = { type: "text", text: value, styles: {} };
              }
            }
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Converts a BlockNote template (JSON-serialized blocks buffer) into a DOCX
 * buffer by:
 *  1. Parsing the BlockNote JSON.
 *  2. Replacing `templateField` inline nodes with values from fieldContext.
 *  3. Converting the resulting blocks to markdown.
 *  4. Rendering markdown into a `docx` Document with company header/footer.
 *  5. Returning the document as a Node.js Buffer.
 *
 * This service is the Node.js equivalent of the browser-side
 * `generateDocxBlob` function in `apps/web/src/lib/export-markdown-to-docx.ts`.
 */
@Injectable()
export class BlockNoteToDocxService {
  /**
   * Render a BlockNote template buffer against a field context and return a
   * DOCX buffer.
   *
   * @param templateBuffer  UTF-8 JSON-encoded BlockNote blocks array, OR
   *                        a pre-rendered markdown string (UTF-8 encoded).
   *                        When the buffer's content starts with `[` the
   *                        service treats it as BlockNote JSON; otherwise it
   *                        is treated as raw markdown.
   * @param fieldContext    Must include `title` (string), `company`
   *                        (BlockNoteCompanyInfo), and any template field
   *                        values whose keys match the `templateField`
   *                        `fieldId` / `alias` props in the template blocks.
   *                        Additional keys are ignored.
   */
  async render(templateBuffer: Buffer, fieldContext: Record<string, unknown>): Promise<Buffer> {
    const title = typeof fieldContext.title === "string" ? fieldContext.title : "Document";
    const company = (fieldContext.company as BlockNoteCompanyInfo | undefined) ?? { name: "" };
    const sectionsFromContext = fieldContext.sections as Section[] | undefined;

    // Determine markdown content
    let markdownContent: string;

    const templateStr = templateBuffer.toString("utf8").trimStart();

    if (templateStr.startsWith("[")) {
      // BlockNote JSON blocks
      const blocks: any[] = JSON.parse(templateStr);
      // Deep-clone to avoid mutating the parsed structure
      const clonedBlocks: any[] = JSON.parse(JSON.stringify(blocks));
      replaceFieldNodes(clonedBlocks, fieldContext);
      markdownContent = blocksToMarkdown(clonedBlocks);
    } else {
      // Raw markdown — no field replacement for now (used when the template
      // is already converted to markdown upstream)
      markdownContent = templateStr;
    }

    // Build sections: if sections are provided via fieldContext use them,
    // otherwise wrap the full markdown content in a single section.
    const sections: Section[] = sectionsFromContext ?? [{ title: "", content: markdownContent }];

    return this._buildDocx({ title, sections, company });
  }

  // ---------------------------------------------------------------------------
  // Private: build the docx Document and serialize to Buffer
  // ---------------------------------------------------------------------------

  private async _buildDocx(opts: {
    title: string;
    sections: Section[];
    company: BlockNoteCompanyInfo;
  }): Promise<Buffer> {
    const { title, sections, company } = opts;

    if (!title) throw new Error("BlockNoteToDocxService: title is required");
    if (!sections || sections.length === 0) throw new Error("BlockNoteToDocxService: at least one section is required");

    const header = await createDocumentHeader(company);
    const footer = createDocumentFooter(title);

    const documentChildren: (Paragraph | Table)[] = [];

    documentChildren.push(
      new Paragraph({
        text: title,
        heading: HeadingLevel.HEADING_1,
        spacing: { after: 240 },
        keepNext: true,
      }),
    );

    for (const section of sections) {
      if (section.title) {
        documentChildren.push(
          new Paragraph({
            text: section.title,
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 240, after: 120 },
            keepNext: true,
          }),
        );
      }

      const contentNodes = parseMarkdown(section.content);
      for (const node of contentNodes) {
        documentChildren.push(...nodeToDocxElements(node));
      }
    }

    const doc = new Document({
      sections: [
        {
          properties: {
            page: {
              margin: {
                top: convertInchesToTwip(1.5),
                bottom: convertInchesToTwip(1.5),
                left: convertInchesToTwip(1),
                right: convertInchesToTwip(1),
              },
            },
          },
          headers: { default: header },
          footers: { default: footer },
          children: documentChildren,
        },
      ],
      numbering: {
        config: [
          {
            reference: "default-numbering",
            levels: [
              { level: 0, format: "decimal", text: "%1.", alignment: AlignmentType.LEFT },
              { level: 1, format: "decimal", text: "%2.", alignment: AlignmentType.LEFT },
              { level: 2, format: "decimal", text: "%3.", alignment: AlignmentType.LEFT },
              { level: 3, format: "decimal", text: "%4.", alignment: AlignmentType.LEFT },
            ],
          },
        ],
      },
    });

    const result = await Packer.toBuffer(doc);
    return Buffer.from(result);
  }
}
