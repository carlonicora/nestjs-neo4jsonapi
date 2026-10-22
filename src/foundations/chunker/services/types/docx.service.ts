import { Injectable } from "@nestjs/common";
import { XMLParser } from "fast-xml-parser";
import { LoadedZip, loadZipWithinLimits } from "../../utils/zip-limits";
import { Document } from "@langchain/core/documents";
const fs = require("fs");

type DocxContent = {
  type: "table" | "paragraphs";
  content: string | any;
};

@Injectable()
export class DocXService {
  private numberingState: Record<string, number> = {};

  public resetNumberingState(): void {
    this.numberingState = {};
  }

  public convertToMarkdown(docxElements: any[]): string {
    this.resetNumberingState();
    return docxElements
      .map((element) => this.extractElement({ element }))
      .filter((markdown) => markdown.trim() !== "") // Remove empty lines
      .join("\n\n");
  }

  private extractElement(params: { element: any }): string {
    const element = params.element;

    if (element["w:tbl"]) return this.extractTableAsMarkdown({ element: element["w:tbl"] });

    if (element["w:p"]) return this.extractParagraph({ element: element["w:p"] });

    return "";
  }

  private extractTableAsMarkdown(params: { element: any }): string {
    const tableData: string[][] = [];
    const rows = params.element["w:tr"] ?? [];

    for (const row of Array.isArray(rows) ? rows : [rows]) {
      if (!row) continue;

      const rowData: string[] = [];
      const cells = Array.isArray(row["w:tc"]) ? row["w:tc"] : [row["w:tc"]];

      for (const cell of cells) {
        if (!cell) continue;

        const cellContent = Array.isArray(cell["w:p"]) ? cell["w:p"] : [cell["w:p"]];
        const content = this.extractCellContentAsMarkdown(cellContent);
        rowData.push(content || " ");
      }

      tableData.push(rowData);
    }

    if (tableData.length === 0) return "";

    const columnCount = tableData[0]?.length || 0;
    if (columnCount === 1) {
      const allContent = tableData
        .map((row) => row[0]?.trim())
        .filter((content) => content && content.length > 0)
        .join("\n\n");

      if (!allContent) return "";

      const hasDocxHeader = this.checkForTableHeader(params.element);

      let headerText = "";

      if (hasDocxHeader) {
        headerText = tableData[0]?.[0]?.trim() || "";
      } else {
        const firstRow = params.element["w:tr"]
          ? Array.isArray(params.element["w:tr"])
            ? params.element["w:tr"][0]
            : params.element["w:tr"]
          : null;
        const firstCell =
          firstRow && firstRow["w:tc"]
            ? Array.isArray(firstRow["w:tc"])
              ? firstRow["w:tc"][0]
              : firstRow["w:tc"]
            : null;
        const firstCellParagraphs =
          firstCell && firstCell["w:p"]
            ? Array.isArray(firstCell["w:p"])
              ? firstCell["w:p"]
              : [firstCell["w:p"]]
            : [];

        if (firstCellParagraphs.length > 0) {
          headerText = this.extractCellContent([firstCellParagraphs[0]]);
        } else {
          headerText = tableData[0]?.[0]?.trim() || "Table Content";
        }
      }

      const sections: string[] = [];
      sections.push(`## ${headerText.trim()}`);
      sections.push(allContent);

      return sections.join("\n\n");
    }

    const markdownTable: string[] = [];

    if (tableData[0]) {
      markdownTable.push(`| ${tableData[0].join(" | ")} |`);
      markdownTable.push(`| ${tableData[0].map(() => "---").join(" | ")} |`);
    }

    for (let i = 1; i < tableData.length; i++) {
      if (tableData[i]) {
        markdownTable.push(`| ${tableData[i].join(" | ")} |`);
      }
    }

    return markdownTable.join("\n");
  }

  private extractCellContentAsMarkdown(cellContent: any[]): string {
    const paragraphs: string[] = [];

    for (const cellElement of cellContent) {
      if (!cellElement) continue;

      const paragraphElements = Array.isArray(cellElement) ? cellElement : [cellElement];
      for (const paragraph of paragraphElements) {
        if (!paragraph) continue;

        const paragraphText = this.extractParagraph({ element: paragraph });
        if (paragraphText && paragraphText.trim()) {
          paragraphs.push(paragraphText.trim());
        }
      }
    }

    return paragraphs.join("\n\n");
  }

  private checkForTableHeader(tableElement: any): boolean {
    // Check if the table has explicit header styling or properties
    const firstRow = Array.isArray(tableElement["w:tr"]) ? tableElement["w:tr"][0] : tableElement["w:tr"];
    if (!firstRow) return false;

    // Check for table header properties in the first row
    const firstCell = Array.isArray(firstRow["w:tc"]) ? firstRow["w:tc"][0] : firstRow["w:tc"];
    if (!firstCell) return false;

    // Look for header-specific styling in cell properties
    const cellProps = firstCell["w:tcPr"];
    const isHeader =
      cellProps?.["w:shd"]?.["@_w:fill"] !== undefined || // Shading
      cellProps?.["w:tcBorders"] !== undefined; // Special borders

    return isHeader;
  }

  private extractParagraph(params: { element: any[] }): string {
    const lineStyle = params.element?.["w:pPr"];
    const lineContent = params.element?.["w:r"] ?? [];
    const paragraphStyle = lineStyle?.["w:pStyle"]?.["@_w:val"];

    if (!lineContent) return "";

    // Extract all text first, then apply formatting to the entire paragraph
    const textParts: string[] = [];
    let hasItalic = false;
    let hasBold = false;

    for (const segment of (Array.isArray(lineContent) ? lineContent : [lineContent]) as any[]) {
      if (!segment) continue;

      const paragraphText = segment["w:t"];
      if (!paragraphText) continue;

      // Extract text content
      let text = "";
      if (typeof paragraphText === "string") {
        text = paragraphText;
      } else if (typeof paragraphText === "object" && paragraphText["#text"]) {
        text = paragraphText["#text"];
      } else if (typeof paragraphText === "object") {
        // Handle objects without #text (like xml:space preserve) - treat as empty
        text = "";
      } else {
        text = String(paragraphText);
      }

      if (text) {
        textParts.push(text);

        // Check formatting for this run
        const runStyle = segment["w:rPr"];
        if (runStyle) {
          if (runStyle["w:i"] !== undefined || runStyle["w:iCs"] !== undefined) {
            hasItalic = true;
          }
          if (runStyle["w:b"] !== undefined || runStyle["w:bCs"] !== undefined) {
            hasBold = true;
          }
        }
      }
    }

    const response = textParts.join(" ").trim();
    if (!response) return "";

    // Apply formatting to the entire paragraph
    let formattedResponse = response;
    if (hasBold && hasItalic) {
      formattedResponse = `**_${response}_**`;
    } else if (hasBold) {
      formattedResponse = `**${response}**`;
    } else if (hasItalic) {
      formattedResponse = `*${response}*`;
    }

    // Determine Markdown element type
    switch (paragraphStyle) {
      case "Heading1":
        return `# ${formattedResponse}`;
      case "Heading2":
        return `## ${formattedResponse}`;
      case "Heading3":
        return `### ${formattedResponse}`;
      case "Heading4":
        return `#### ${formattedResponse}`;
      case "Heading5":
        return `##### ${formattedResponse}`;
      case "Heading6":
        return `###### ${formattedResponse}`;
      case "Blockquote":
        return `> ${formattedResponse}`;
      case "Code":
      case "Preformatted":
        return `\`\`\`\n${formattedResponse}\n\`\`\``;
      default:
        // Handle lists
        const ilvl = lineStyle?.["w:numPr"]?.["w:ilvl"]?.["@_w:val"];
        const numId = lineStyle?.["w:numPr"]?.["w:numId"]?.["@_w:val"];
        const style = lineStyle?.["w:pStyle"]?.["@_w:val"];
        if (ilvl !== undefined) {
          return this.extractListItem({ response: formattedResponse, ilvl, numId, style });
        }

        return formattedResponse;
    }
  }

  private extractListItem(params: { response: string; ilvl: string; numId: string; style: string }): string {
    const { response, ilvl, numId, style } = params;
    const indentation = "  ".repeat(parseInt(ilvl, 10) || 0);

    if (numId) {
      const isOrdered = style === "ListParagraph" && parseInt(numId, 10) > 0;

      if (isOrdered) {
        if (!this.numberingState[numId]) {
          this.numberingState[numId] = 1;
        }

        const prefix = `${this.numberingState[numId]}.`;
        this.numberingState[numId]++;

        return `${indentation}${prefix} ${response}`;
      }
    }

    return `${indentation}- ${response}`;
  }

  private extractLine(params: { element: any }): string {
    const paragraphText = params.element["w:t"];
    const paragraphStyle = params.element["w:rPr"];

    if (!paragraphText) return "";

    // Handle all possible w:t formats: string, object with #text, or raw number
    let resolvedText = "";
    if (typeof paragraphText === "string") {
      resolvedText = paragraphText;
    } else if (typeof paragraphText === "object" && paragraphText["#text"]) {
      resolvedText = paragraphText["#text"];
    } else if (typeof paragraphText === "object") {
      // Handle objects without #text (like xml:space preserve) - treat as empty
      resolvedText = "";
    } else {
      // Handle numbers and other primitive types
      resolvedText = String(paragraphText);
    }

    if (!resolvedText) return "";

    if (paragraphStyle) {
      const isBold =
        paragraphStyle["w:b"] !== undefined ||
        paragraphStyle["w:bCs"] !== undefined ||
        (paragraphStyle["w:rStyle"] !== undefined && paragraphStyle["w:rStyle"]["@_w:val"] === "Strong");
      const isItalic =
        paragraphStyle["w:i"] !== undefined ||
        paragraphStyle["w:iCs"] !== undefined ||
        (paragraphStyle["w:rStyle"] !== undefined && paragraphStyle["w:rStyle"]["@_w:val"] === "Emphasis");

      if (isBold && isItalic) return `**_${resolvedText}_**`;
      if (isBold) return `**${resolvedText}**`;
      if (isItalic) return `*${resolvedText}*`;
    }

    return resolvedText;
  }

  private extractTable(params: { element: any }): Record<string, Record<string, string>> | undefined {
    const tableData: string[][] = [];
    const rows = params.element["w:tr"] ?? [];

    // Track vertically merged cells
    const verticalMergeTracker: Record<number, string> = {};

    for (const rowIndex in rows) {
      const row = rows[rowIndex];
      if (!row) continue; // Safeguard against undefined rows

      const rowData: string[] = [];
      const cells = Array.isArray(row["w:tc"]) ? row["w:tc"] : [row["w:tc"]];

      let colIndexOffset = 0; // Tracks the offset for skipped columns due to horizontal spans

      for (const colIndex in cells) {
        const cell = cells[colIndex];
        if (!cell) continue; // Safeguard against undefined cells

        const cellProps = cell["w:tcPr"];
        const cellContent = Array.isArray(cell["w:p"]) ? cell["w:p"] : [cell["w:p"]];

        // Extract content from the cell
        const content = this.extractCellContent(cellContent);

        // Handle vertical merging
        const vMerge = cellProps?.["w:vMerge"];
        if (vMerge?.["@_w:val"] === "restart") {
          verticalMergeTracker[colIndexOffset] = content;
          rowData[colIndexOffset] = content;
        } else if (vMerge !== undefined) {
          rowData[colIndexOffset] = verticalMergeTracker[colIndexOffset];
        } else {
          rowData[colIndexOffset] = content;
        }

        // Handle horizontal spanning (gridSpan)
        const gridSpan = parseInt(cellProps?.["w:gridSpan"]?.["@_w:val"] ?? "1", 10);
        if (gridSpan > 1) {
          for (let i = 1; i < gridSpan; i++) {
            rowData[colIndexOffset + i] = rowData[colIndexOffset]; // Duplicate content for spanned cells
          }
          colIndexOffset += gridSpan - 1; // Skip the additional columns added by the span
        }

        colIndexOffset++; // Increment for the current column
      }

      tableData.push(rowData);
    }

    if (tableData.length === 0) return undefined;

    const headers = tableData[0];
    const jsonTable: Record<string, Record<string, string>> = {};

    tableData.slice(1).forEach((row, index) => {
      if (!row) return; // Safeguard against undefined rows in tableData

      const rowObject: Record<string, string> = {};

      // Map row data to headers
      headers.forEach((header, colIndex) => {
        rowObject[header] = row[colIndex] ?? "";
      });

      // Add the row object to the final JSON table
      jsonTable[`row${index + 1}`] = rowObject;
    });

    return jsonTable;
  }

  private extractCellContent(cellContent: any[]): string {
    const rowContent: string[] = [];
    for (const cellElement of cellContent) {
      if (!cellElement) continue; // Safeguard against undefined cell elements

      const paragraphs = Array.isArray(cellElement) ? cellElement : [cellElement];
      for (const paragraph of paragraphs) {
        if (!paragraph) continue; // Safeguard against undefined paragraphs

        const runs = Array.isArray(paragraph["w:r"]) ? paragraph["w:r"] : [paragraph["w:r"]];
        for (const run of runs) {
          if (!run) continue; // Safeguard against undefined runs
          if (run["w:t"]) {
            // Handle all possible w:t formats: string, object with #text, or raw number
            let text = "";
            if (typeof run["w:t"] === "string") {
              text = run["w:t"];
            } else if (typeof run["w:t"] === "object" && run["w:t"]["#text"]) {
              text = run["w:t"]["#text"];
            } else if (typeof run["w:t"] === "object") {
              // Handle objects without #text (like xml:space preserve) - treat as empty
              text = "";
            } else {
              // Handle numbers and other primitive types
              text = String(run["w:t"]);
            }
            if (text) {
              rowContent.push(text);
            }
          }
        }
      }
    }
    return rowContent.join(" ");
  }

  /** Loads the DOCX zip, refusing (BadRequestException) one that expands beyond the zip limits. */
  private async loadArchive(buffer: Buffer): Promise<LoadedZip> {
    const zip = await loadZipWithinLimits({ buffer, label: "DOCX" });
    if (!zip) throw new Error("Unable to read the DOCX file: it is not a zip archive.");
    return zip;
  }

  async extractDocxContent(docPath: string): Promise<DocxContent[]> {
    const buffer = fs.readFileSync(docPath);
    const zip = await this.loadArchive(buffer);

    const documentXml = await zip.file("word/document.xml")?.async("text");
    if (!documentXml) {
      throw new Error("Unable to find document.xml in the DOCX file.");
    }

    const parser = new XMLParser({ ignoreAttributes: false });
    const parsedXml = parser.parse(documentXml);

    const content: DocxContent[] = [];
    const nodes = parsedXml["w:document"]?.["w:body"] ?? [];

    const bodyElements: any[] = [];
    if (nodes["w:p"]) {
      bodyElements.push(...((Array.isArray(nodes["w:p"]) ? nodes["w:p"] : [nodes["w:p"]]) as any[]));
    }
    if (nodes["w:tbl"]) {
      bodyElements.push(...((Array.isArray(nodes["w:tbl"]) ? nodes["w:tbl"] : [nodes["w:tbl"]]) as any[]));
    }

    let paragraphGroup: string[] = [];

    for (const element of bodyElements) {
      if (element["w:r"] || element["w:pPr"]) {
        paragraphGroup.push(this.extractParagraph({ element: element }));
      } else if (element["w:tbl"] || element["w:tr"]) {
        if (paragraphGroup.length > 0) {
          content.push({ type: "paragraphs", content: paragraphGroup.join("\n\n") });
          paragraphGroup = [];
        }

        const tableData = this.extractTable({ element: element });
        if (tableData) content.push({ type: "table", content: tableData });
      }
    }

    if (paragraphGroup.length > 0) {
      content.push({ type: "paragraphs", content: paragraphGroup.join("\n\n") });
    }

    return content;
  }

  async getRawElements(filePath: string): Promise<any[]> {
    const buffer = fs.readFileSync(filePath);
    const zip = await this.loadArchive(buffer);

    const documentXml = await zip.file("word/document.xml")?.async("text");
    if (!documentXml) {
      throw new Error("Unable to find document.xml in the DOCX file.");
    }

    const parser = new XMLParser({ ignoreAttributes: false });
    const parsedXml = parser.parse(documentXml);

    const nodes = parsedXml["w:document"]?.["w:body"] ?? [];
    const bodyElements: any[] = [];

    // Extract elements in document order, preserving hierarchy
    // Only get top-level elements, not nested ones inside tables
    const allBodyChildren = Object.entries(nodes).filter(([key]) => key.startsWith("w:"));

    for (const [elementType, elements] of allBodyChildren) {
      const elementArray = Array.isArray(elements) ? elements : [elements];
      bodyElements.push(...elementArray.map((element) => ({ [elementType]: element })));
    }

    return bodyElements;
  }

  async load(params: { filePath: string }): Promise<Document[]> {
    const structure = await this.extractDocxContent(params.filePath);

    const response: Document[] = [];

    for (const doc of structure) {
      if (doc.type === "paragraphs") {
        response.push(
          new Document({
            pageContent: doc.content,
            metadata: { type: "paragraphs" },
          }),
        );
      } else if (doc.type === "table") {
        const data = JSON.stringify(doc.content).replaceAll("{", "{{").replaceAll("}", "}}");
        response.push(
          new Document({
            pageContent: data,
            metadata: { type: "table" },
          }),
        );
      }
    }

    return response;
  }
}
