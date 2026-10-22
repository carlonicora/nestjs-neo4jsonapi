import { Injectable, Logger } from "@nestjs/common";
import { Document } from "@langchain/core/documents";
import * as fs from "fs/promises";
import * as officeParser from "officeparser";
import { loadZipWithinLimits } from "../../utils/zip-limits";

@Injectable()
export class PptxService {
  private readonly logger = new Logger(PptxService.name);
  public convertToMarkdown(content: string): string {
    if (!content || !content.trim()) {
      return "";
    }

    // Try multiple splitting strategies to identify slides
    let sections = content
      .split(/\n\s*\n+/)
      .map((section) => section.trim())
      .filter((section) => section.length > 0);

    // If we only get 1 section, try splitting by slide numbers or other patterns
    if (sections.length === 1) {
      // Try splitting by numbered slides (1\n, 2\n, etc.)
      const slideNumberSplit = content.split(/\n(\d+)\n/).filter((s) => s.trim());

      if (slideNumberSplit.length > 3) {
        // At least some content between numbers
        sections = [];
        for (let i = 0; i < slideNumberSplit.length; i += 2) {
          if (slideNumberSplit[i] && slideNumberSplit[i].trim()) {
            sections.push(slideNumberSplit[i].trim());
          }
        }
      } else {
        // Try splitting by lines that look like titles (short lines followed by content)
        const lines = content.split("\n");
        sections = [];
        let currentSection = [];

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          const nextLine = lines[i + 1]?.trim();

          // If this line is short (<80 chars) and next line exists, might be a title
          if (line && line.length < 80 && nextLine && nextLine.length > 0) {
            // Save previous section if it exists
            if (currentSection.length > 0) {
              sections.push(currentSection.join("\n").trim());
              currentSection = [];
            }
          }

          if (line) {
            currentSection.push(line);
          }
        }

        // Add the last section
        if (currentSection.length > 0) {
          sections.push(currentSection.join("\n").trim());
        }
      }
    }

    if (sections.length === 0) {
      return content;
    }

    // Format as markdown with slide separators
    const result = sections
      .map((section) => {
        // First line of each section is likely a title
        const lines = section
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line);
        if (lines.length === 0) return "";

        const formatted: string[] = [];

        // If the first line looks like a title (short and followed by content)
        if (lines.length > 1 && lines[0].length < 100 && !lines[0].endsWith(".")) {
          formatted.push(`## ${lines[0]}`);
          formatted.push(...lines.slice(1));
        } else {
          formatted.push(...lines);
        }

        return formatted.join("\n\n");
      })
      .filter((section) => section.trim())
      .join("\n\n---\n\n");

    return result;
  }

  async extractPptxContent(pptxPath: string): Promise<string> {
    // A PPTX is a zip: refuse one that expands beyond the zip limits BEFORE officeparser inflates it
    // (outside the try below, so the refusal reaches the caller instead of reading as "empty").
    await loadZipWithinLimits({ buffer: await fs.readFile(pptxPath), label: "PPTX" });

    try {
      const ast = await officeParser.parseOffice(pptxPath, { ignoreNotes: false });
      return ast?.toText() || "";
    } catch (error) {
      console.error("💥 PPTX SERVICE - Error extracting PPTX content:", error);
      return "";
    }
  }

  async getRawElements(filePath: string): Promise<string> {
    return this.extractPptxContent(filePath);
  }

  async load(params: { filePath: string }): Promise<Document[]> {
    const content = await this.extractPptxContent(params.filePath);

    if (!content || !content.trim()) {
      return [];
    }

    // Create a single document with the extracted text content
    return [
      new Document({
        pageContent: content,
        metadata: {
          type: "pptx",
          source: params.filePath,
        },
      }),
    ];
  }
}
