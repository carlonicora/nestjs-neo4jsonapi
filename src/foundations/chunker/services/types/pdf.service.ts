import { Injectable, Logger } from "@nestjs/common";
import * as fs from "fs";
import { LayoutExtractor } from "./pdf/extractors/layout.extractor";
import { TableExtractor } from "./pdf/extractors/table.extractor";
import {
  PdfContent,
  PdfElement,
  PdfHeaderElement,
  PdfListElement,
  PdfParagraphElement,
  PdfTableElement,
} from "./pdf/interfaces/pdf-element.interface";
import { PdfLayoutElement, PdfProcessingOptions } from "./pdf/interfaces/pdf-layout.interface";

import { Document } from "@langchain/core/documents";
import { PDFParse } from "pdf-parse";
const pdf2pic = require("pdf2pic");
const tesseract = require("node-tesseract-ocr");
const sharp = require("sharp");

@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);
  private readonly layoutExtractor = new LayoutExtractor();
  private readonly tableExtractor = new TableExtractor();

  private defaultProcessingOptions: PdfProcessingOptions = {
    enableOCR: false, // Disabled by default for performance
    ocrConfidenceThreshold: 0.6, // Lowered for scanned documents (was 0.8)
    ocrLanguage: "eng", // English by default
    ocrImagePreprocessing: false, // Disabled by default - damages clean scans
    detectTables: true,
    detectImages: true,
    detectHeaders: true,
    preserveLayout: true,
    maxImageSize: 1024 * 1024, // 1MB
    skipHeaderFooter: false,
    columnDetection: true,
  };

  public resetState(): void {
    // Reset any internal state if needed
  }

  public convertToMarkdown(pdfElements: PdfElement[]): string {
    this.resetState();
    return pdfElements
      .map((element) => this.extractElementAsMarkdown(element))
      .filter((markdown) => markdown.trim() !== "")
      .join("\n\n");
  }

  private extractElementAsMarkdown(element: PdfElement): string {
    switch (element.type) {
      case "header":
        const headerElement = element as PdfHeaderElement;
        const headerPrefix = "#".repeat(headerElement.level);
        return `${headerPrefix} ${headerElement.content}`;

      case "paragraph":
        const paragraphElement = element as PdfParagraphElement;
        return paragraphElement.content;

      case "table":
        return this.extractTableAsMarkdown(element as PdfTableElement);

      case "text":
        return element.content;

      case "list":
        const listElement = element as PdfListElement;
        return listElement.items.map((item) => `- ${item.content}`).join("\n");

      case "image":
        const imageText = (element as any).extractedText;
        return imageText ? `![Image content: ${imageText}]` : "";

      default:
        return "";
    }
  }

  private extractTableAsMarkdown(tableElement: PdfTableElement): string {
    if (!tableElement.rows || tableElement.rows.length === 0) {
      return "";
    }

    const markdownRows: string[] = [];
    const columnCount = Math.max(...tableElement.rows.map((row) => row.cells.length));

    // Process header row
    if (tableElement.rows.length > 0) {
      const headerCells = tableElement.rows[0].cells.map((cell) => cell.content.trim() || " ");
      // Pad to column count
      while (headerCells.length < columnCount) {
        headerCells.push(" ");
      }
      markdownRows.push(`| ${headerCells.join(" | ")} |`);
      markdownRows.push(`| ${headerCells.map(() => "---").join(" | ")} |`);
    }

    // Process data rows
    for (let i = 1; i < tableElement.rows.length; i++) {
      const row = tableElement.rows[i];
      const cells = row.cells.map((cell) => cell.content.trim() || " ");
      // Pad to column count
      while (cells.length < columnCount) {
        cells.push(" ");
      }
      markdownRows.push(`| ${cells.join(" | ")} |`);
    }

    return markdownRows.join("\n");
  }

  async extractPdfContent(pdfPath: string, options?: Partial<PdfProcessingOptions>): Promise<PdfContent[]> {
    this.logger.log("##############################################################");
    this.logger.log("## PDF EXTRACTION START");
    this.logger.log(`## File: ${pdfPath}`);
    this.logger.log("##############################################################");

    const processingOptions = { ...this.defaultProcessingOptions, ...options };
    this.logger.log("Processing options:");
    this.logger.log(`  - enableOCR: ${processingOptions.enableOCR}`);
    this.logger.log(`  - ocrImagePreprocessing: ${processingOptions.ocrImagePreprocessing}`);
    this.logger.log(`  - ocrLanguage: ${processingOptions.ocrLanguage}`);
    this.logger.log(`  - ocrConfidenceThreshold: ${processingOptions.ocrConfidenceThreshold}`);

    let extractedText = "";
    let result: PdfContent[] = [];

    // First attempt: Intelligent parsing
    this.logger.log("\n[ATTEMPT 1] Trying intelligent parsing...");
    try {
      result = await this.extractWithIntelligentParsing(pdfPath);
      if (result && result.length > 0) {
        extractedText = result.map((block) => block.content).join("\n");
        const textLength = extractedText.length;
        this.logger.log(`→ Intelligent parsing extracted ${textLength} chars from ${result.length} blocks`);

        const isScanned = this.detectScannedPdf(extractedText);
        this.logger.log(`→ Scanned PDF detection: ${isScanned ? "YES (low quality text)" : "NO (good quality text)"}`);

        if (!isScanned) {
          this.logger.log(`✅ SUCCESS: Using intelligent parsing result`);
          this.logger.log("##############################################################");
          return result;
        } else {
          this.logger.log("⚠️  Scanned PDF detected, will try OCR...");
        }
      } else {
        this.logger.log("⚠️  Intelligent parsing returned no content");
      }
    } catch (error) {
      this.logger.warn("❌ Intelligent PDF extraction failed:", error);
    }

    // Second attempt: Basic parsing
    this.logger.log("\n[ATTEMPT 2] Trying basic parsing...");
    try {
      const basicResult = await this.extractWithBasicParsing(pdfPath);
      if (basicResult && basicResult.length > 0) {
        const basicText = basicResult.map((block) => block.content).join("\n");
        const textLength = basicText.length;
        this.logger.log(`→ Basic parsing extracted ${textLength} chars from ${basicResult.length} blocks`);

        const isScanned = this.detectScannedPdf(basicText);
        this.logger.log(`→ Scanned PDF detection: ${isScanned ? "YES (low quality text)" : "NO (good quality text)"}`);

        if (!isScanned) {
          this.logger.log(`✅ SUCCESS: Using basic parsing result`);
          this.logger.log("##############################################################");
          return basicResult;
        } else {
          extractedText = basicText;

          // Smart OCR fallback: automatically enable OCR for scanned PDFs
          if (!processingOptions.enableOCR) {
            this.logger.log("⚠️  Scanned PDF detected, AUTO-ENABLING OCR");
            processingOptions.enableOCR = true;
          }
        }
      } else {
        this.logger.log("⚠️  Basic parsing returned no content");
      }
    } catch (error) {
      this.logger.warn("❌ Basic PDF extraction failed:", error);
    }

    // Third attempt: OCR processing (if enabled and text quality is poor)
    if (processingOptions.enableOCR) {
      this.logger.log(`\n[ATTEMPT 3] Trying OCR extraction (enableOCR=${processingOptions.enableOCR})...`);
      try {
        const ocrResult = await this.extractWithOCR(pdfPath, processingOptions);

        if (ocrResult && ocrResult.length > 0) {
          const ocrText = ocrResult.map((block) => block.content).join("\n");
          this.logger.log(`✅ SUCCESS: OCR extracted ${ocrText.length} chars from ${ocrResult.length} blocks`);
          this.logger.log("##############################################################");
          return ocrResult;
        } else {
          this.logger.warn("❌ OCR extraction did not yield any content (all pages rejected)");
        }
      } catch (error) {
        this.logger.error("❌ OCR extraction failed:", error);
      }
    } else {
      this.logger.log("\n[ATTEMPT 3] SKIPPED: OCR is disabled");
    }

    // Final fallback: Return what we have, even if poor quality
    if (result && result.length > 0) {
      this.logger.warn("⚠️  FALLBACK: Returning partial extraction result");
      this.logger.log("##############################################################");
      return result;
    }

    this.logger.error("❌ FAILURE: All PDF extraction methods failed, returning empty content");
    this.logger.log("##############################################################");
    return [];
  }

  private async extractWithIntelligentParsing(pdfPath: string): Promise<PdfContent[]> {
    let parser: PDFParse | null = null;

    try {
      // First, get basic PDF structure using pdf-parse for text extraction
      const buffer = fs.readFileSync(pdfPath);
      parser = new PDFParse({ data: buffer });

      const textResult = await parser.getText();

      if (!textResult.text || textResult.text.trim() === "") {
        return [];
      }

      const infoResult = await parser.getInfo();
      const numPages = infoResult.info?.numPages || 1;

      // Create layout elements from the extracted text
      // This is a simplified version - in a real implementation you'd use a proper PDF parser
      // that gives you positioning information for each text element
      const layoutElements = this.createLayoutElementsFromText(textResult.text, numPages);

      if (layoutElements.length === 0) {
        return [];
      }

      // Analyze layout for each page
      const pageWidth = 612; // Standard US Letter width in points
      const pageHeight = 792; // Standard US Letter height in points

      const contentBlocks: PdfContent[] = [];

      // Group elements by page
      const pageGroups = this.groupElementsByPage(layoutElements);

      for (const [, pageElements] of pageGroups.entries()) {
        // Use layout extractor to analyze page structure
        const pageStructure = this.layoutExtractor.analyzePageLayout(pageElements, pageWidth, pageHeight);

        // Detect tables on this page
        const tables = this.tableExtractor.detectTables(pageElements);

        // Process page content in reading order
        const orderedElements = this.layoutExtractor.detectReadingOrder(pageElements);

        // Convert layout analysis to content blocks
        const pageContent = this.convertLayoutToContent(pageStructure, tables, orderedElements);
        contentBlocks.push(...pageContent);
      }

      return contentBlocks;
    } catch (error) {
      this.logger.error("🔍 LAYOUT EXTRACTOR: Error in intelligent parsing:", error);
      return [];
    } finally {
      if (parser) {
        await parser.destroy();
      }
    }
  }

  private createLayoutElementsFromText(text: string, numPages: number): PdfLayoutElement[] {
    const elements: PdfLayoutElement[] = [];

    // Clean and normalize the text
    const cleanedText = this.cleanAndNormalizeText(text);

    // Split into sentences and paragraphs
    const sentences = this.splitIntoSentences(cleanedText);
    const paragraphs = this.reconstructLogicalParagraphs(sentences);

    // Create layout elements with simulated positioning
    let currentY = 50; // Start from top margin
    const lineHeight = 14;
    const marginLeft = 50;
    const marginRight = 50;
    const pageWidth = 612;
    const contentWidth = pageWidth - marginLeft - marginRight;

    for (let i = 0; i < paragraphs.length; i++) {
      const paragraph = paragraphs[i];
      const currentPage = Math.floor(currentY / 742) + 1; // 742 is content height per page

      // Determine font size based on content (headers are larger)
      const isHeader = this.isHeaderParagraph(paragraph);
      const fontSize = isHeader ? 16 : 12;

      const element: PdfLayoutElement = {
        x: marginLeft,
        y: (currentY % 742) + 50, // Reset Y for each page with top margin
        width: contentWidth,
        height: lineHeight * Math.ceil(paragraph.length / 80), // Rough estimate
        content: paragraph,
        fontSize: fontSize,
        fontName: "Arial",
        isBold: isHeader,
        pageNumber: Math.min(currentPage, numPages),
        elementId: `element_${i}`,
        confidence: 0.9,
      };

      elements.push(element);

      // Update Y position for next element
      currentY += element.height + (isHeader ? 20 : 10); // Extra space after headers
    }

    return elements;
  }

  private groupElementsByPage(elements: PdfLayoutElement[]): Map<number, PdfLayoutElement[]> {
    const pageGroups = new Map<number, PdfLayoutElement[]>();

    for (const element of elements) {
      const pageNumber = element.pageNumber;
      if (!pageGroups.has(pageNumber)) {
        pageGroups.set(pageNumber, []);
      }
      pageGroups.get(pageNumber)!.push(element);
    }

    return pageGroups;
  }

  private convertLayoutToContent(
    pageStructure: any,
    tables: PdfTableElement[],
    orderedElements: PdfLayoutElement[],
  ): PdfContent[] {
    const contentBlocks: PdfContent[] = [];

    // First, add detected tables
    for (const table of tables) {
      contentBlocks.push({
        type: "table",
        content: this.convertTableToText(table),
        pageNumber: table.pageNumber,
        confidence: table.confidence || 0.8,
      });
    }

    // Then process remaining elements in reading order
    const tableElementIds = new Set(
      tables.flatMap(
        (table) => table.rows?.flatMap((row) => row.cells?.map((cell) => `${cell.x}_${cell.y}`) || []) || [],
      ),
    );

    for (const element of orderedElements) {
      // Skip elements that are already part of tables
      const elementKey = `${element.x}_${element.y}`;
      if (tableElementIds.has(elementKey)) {
        continue;
      }

      // Determine content type based on layout analysis
      const isHeader = this.isHeaderParagraph(element.content) || element.isBold;

      contentBlocks.push({
        type: isHeader ? "header" : "paragraphs",
        content: element.content,
        pageNumber: element.pageNumber,
        confidence: element.confidence || 0.9,
      });
    }

    return contentBlocks;
  }

  private convertTableToText(table: PdfTableElement): string {
    if (!table.rows || table.rows.length === 0) {
      return "";
    }

    // Convert table to simple text representation
    const textRows: string[] = [];

    for (const row of table.rows) {
      if (row.cells && row.cells.length > 0) {
        const cellContents = row.cells.map((cell) => cell.content || "").join(" | ");
        textRows.push(cellContents);
      }
    }

    return textRows.join("\n");
  }

  private analyzeAndStructureText(text: string): PdfContent[] {
    const contentBlocks: PdfContent[] = [];

    // Clean and normalize the text first
    const cleanedText = this.cleanAndNormalizeText(text);

    // Split into sentences while preserving structure
    const sentences = this.splitIntoSentences(cleanedText);

    if (sentences.length === 0) return contentBlocks;

    // Reconstruct logical paragraphs from sentences
    const logicalParagraphs = this.reconstructLogicalParagraphs(sentences);

    // Process paragraphs to identify headers and content
    for (const paragraph of logicalParagraphs) {
      const trimmedParagraph = paragraph.trim();

      if (trimmedParagraph.length === 0) continue;

      // Check if this paragraph is actually a header
      if (this.isHeaderParagraph(trimmedParagraph)) {
        contentBlocks.push({
          type: "header",
          content: trimmedParagraph,
          pageNumber: 1,
          confidence: 0.9,
        });
      } else {
        // Regular content paragraph
        contentBlocks.push({
          type: "paragraphs",
          content: trimmedParagraph,
          pageNumber: 1,
          confidence: 0.9,
        });
      }
    }

    return contentBlocks;
  }

  private cleanAndNormalizeText(text: string): string {
    return (
      text
        // Remove excessive whitespace but preserve paragraph breaks
        .replace(/[ \t]+/g, " ")
        // Normalize line breaks
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        // Remove page numbers and headers/footers (common patterns)
        .replace(/^\s*\d+\s*$/gm, "") // Standalone page numbers
        .replace(/^\s*Page \d+.*$/gim, "") // "Page X" patterns
        // Fix common PDF extraction issues
        .replace(/([a-z])(\n)([A-Z])/g, "$1 $3") // Fix broken sentences across lines
        .replace(/([a-z,;])(\n)([a-z])/g, "$1 $3") // Fix broken words across lines
        .replace(/(\w)-(\n)(\w)/g, "$1$3") // Fix hyphenated words broken across lines
        .trim()
    );
  }

  private splitIntoSentences(text: string): string[] {
    // Split by sentences but be smart about abbreviations and numbers
    const sentences: string[] = [];

    // Split by common sentence endings followed by whitespace and capital letter
    const parts = text.split(/([.!?]+)\s+(?=[A-Z])/);

    let currentSentence = "";

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];

      if (/^[.!?]+$/.test(part)) {
        // This is punctuation
        currentSentence += part;

        // Check if next part starts with capital (new sentence)
        if (i + 1 < parts.length && /^[A-Z]/.test(parts[i + 1])) {
          sentences.push(currentSentence.trim());
          currentSentence = "";
        }
      } else {
        currentSentence += part;
      }
    }

    // Add any remaining content
    if (currentSentence.trim()) {
      sentences.push(currentSentence.trim());
    }

    return sentences.filter((s) => s.length > 0);
  }

  private reconstructLogicalParagraphs(sentences: string[]): string[] {
    const paragraphs: string[] = [];
    let currentParagraph = "";

    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];
      const nextSentence = sentences[i + 1];

      // Add sentence to current paragraph
      currentParagraph += (currentParagraph ? " " : "") + sentence;

      // Check if we should end this paragraph
      if (this.shouldEndParagraph(sentence, nextSentence)) {
        paragraphs.push(currentParagraph.trim());
        currentParagraph = "";
      }
    }

    // Add final paragraph
    if (currentParagraph.trim()) {
      paragraphs.push(currentParagraph.trim());
    }

    return paragraphs;
  }

  private shouldEndParagraph(currentSentence: string, nextSentence?: string): boolean {
    if (!nextSentence) return true;

    // End paragraph if next sentence looks like a header
    if (this.isHeaderParagraph(nextSentence)) {
      return true;
    }

    // End paragraph if current sentence ends with paragraph indicators
    if (/[.!?]\s*$/.test(currentSentence)) {
      // Check if next sentence starts a new logical section
      if (
        /^\d+\.\s/.test(nextSentence) || // Numbered lists
        /^[A-Z][a-z]+\s*\d+/.test(nextSentence) || // "Article 1", etc.
        nextSentence === nextSentence.toUpperCase()
      ) {
        // All caps
        return true;
      }
    }

    return false;
  }

  private isHeaderParagraph(paragraph: string): boolean {
    const trimmed = paragraph.trim();

    // Use the same header detection logic but for full paragraphs
    return this.detectHeader(trimmed, undefined);
  }

  private detectHeader(line: string, nextLine: string | undefined): boolean {
    const trimmedLine = line.trim();

    // Skip very short or very long lines
    if (trimmedLine.length < 5 || trimmedLine.length > 150) return false;

    // 1. All uppercase titles (main document titles) - language independent
    if (trimmedLine === trimmedLine.toUpperCase() && /[A-Z]/.test(trimmedLine) && trimmedLine.length > 15) {
      return true;
    }

    // 2. Structural section pattern: [Word].[Number][Separator][Description]
    // Matches: "Art. 1 –", "Section 1 -", "Artikel 1 –", "Capítulo 1 :", etc.
    if (/^\w+\.?\s*\d+\s*[\-–—:]\s*.{3,}/.test(trimmedLine)) {
      // Additional check: make sure it's not just a numbered paragraph within text
      // Headers usually have decent length and structure
      if (trimmedLine.length > 20 && trimmedLine.length < 120) {
        return true;
      }
    }

    // 3. Pure numbered sections without prefix: "1. [Long descriptive title]", "2. [Long descriptive title]"
    // But only if it looks like a section title, not a paragraph
    if (/^\d+\.\s+.{20,100}$/.test(trimmedLine) && !/[.!?]$/.test(trimmedLine)) {
      // Check if next line suggests this is a section (long content follows)
      if (nextLine && nextLine.trim().length > 50) {
        return true;
      }
    }

    return false;
  }

  private detectTableLine(line: string): boolean {
    // Look for table-like patterns
    const patterns = [
      /\t.*\t/, // Tab separated
      /\|.*\|/, // Pipe separated
      /\s{3,}.*\s{3,}/, // Multiple spaces (column alignment)
      /^\s*\w+\s+\d+/, // Word followed by number
      /^\s*\d+\s+\w+/, // Number followed by word
    ];

    return patterns.some((pattern) => pattern.test(line));
  }

  private processTableLines(lines: string[]): any | null {
    if (lines.length < 2) return null;

    // Simple table processing - convert to markdown-like structure
    const tableRows = lines.map((line) => {
      // Split by tabs, pipes, or multiple spaces
      const cells = line
        .split(/\t|\||\s{3,}/)
        .map((cell) => cell.trim())
        .filter((cell) => cell.length > 0);
      return cells;
    });

    // Ensure consistent column count
    const maxCols = Math.max(...tableRows.map((row) => row.length));
    if (maxCols < 2) return null; // Not a valid table

    const normalizedRows = tableRows.map((row) => {
      while (row.length < maxCols) row.push("");
      return row;
    });

    return {
      type: "table",
      rows: normalizedRows.map((cells, index) => ({
        cells: cells.map((content, cellIndex) => ({
          content,
          x: cellIndex * 100, // Approximate positioning
          y: index * 20,
          width: 100,
          height: 20,
        })),
        y: index * 20,
        height: 20,
      })),
      x: 0,
      y: 0,
      width: maxCols * 100,
      height: normalizedRows.length * 20,
      pageNumber: 1,
      confidence: 0.7,
    };
  }

  private detectScannedPdf(extractedText: string): boolean {
    this.logger.log("--- Scanned PDF Detection ---");

    if (!extractedText || typeof extractedText !== "string") {
      this.logger.log("→ No text extracted → SCANNED");
      return true; // No text extracted, likely scanned
    }

    const text = extractedText.trim();
    this.logger.log(`Text length: ${text.length} characters`);

    // Check 1: Very little text extracted
    if (text.length < 100) {
      this.logger.log("→ Text too short (< 100 chars) → SCANNED");
      return true;
    }

    // Check 2: Count words
    const words = text.split(/\s+/).filter((word) => word.length > 0);
    this.logger.log(`Word count: ${words.length} words`);
    if (words.length < 20) {
      this.logger.log("→ Too few words (< 20) → SCANNED");
      return true;
    }

    // Check 3: Text density - ratio of meaningful characters to total length
    const meaningfulChars = text.replace(/\s+/g, "").length;
    const totalChars = text.length;
    const textDensity = meaningfulChars / totalChars;
    this.logger.log(`Text density: ${(textDensity * 100).toFixed(1)}% (threshold: >= 30%)`);

    if (textDensity < 0.3) {
      this.logger.log("→ Low text density → SCANNED");
      return true;
    }

    // Check 4: Garbled text patterns (common in poor PDF extraction)
    const garbledPatterns = [
      /[^\w\s\.\,\!\?\;\:\-\(\)]{3,}/g, // Multiple non-word characters in sequence
      /\w{20,}/g, // Very long words (often extraction errors)
      /[A-Z]{10,}/g, // Very long sequences of capital letters
    ];

    let garbledCount = 0;
    for (const pattern of garbledPatterns) {
      const matches = text.match(pattern);
      if (matches) {
        garbledCount += matches.length;
      }
    }

    const garbledRatio = garbledCount / words.length;
    this.logger.log(`Garbled pattern ratio: ${(garbledRatio * 100).toFixed(1)}% (threshold: < 10%)`);
    if (garbledRatio > 0.1) {
      this.logger.log("→ High garbled pattern ratio → SCANNED");
      return true;
    }

    // Check 5: Average line length - scanned PDFs often have very short or very long lines
    const lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (lines.length > 0) {
      const avgLineLength = lines.reduce((sum, line) => sum + line.length, 0) / lines.length;
      this.logger.log(`Average line length: ${avgLineLength.toFixed(1)} chars (threshold: 20-200)`);

      if (avgLineLength < 20 || avgLineLength > 200) {
        this.logger.log("→ Abnormal line length → SCANNED");
        return true;
      }
    }

    // Check 6: CRITICAL - Use comprehensive garbage detection
    // This catches upside-down/rotated text, gibberish from badly scanned PDFs
    this.logger.log("Check 6: Running comprehensive garbage detection...");
    const isGarbage = this.isGarbageOcrOutput(text);
    if (isGarbage) {
      this.logger.log("→ Garbage text detected (see garbage detection logs above) → SCANNED");
      return true;
    }

    // If we get here, the PDF likely has good native text
    this.logger.log("→ All checks passed → NOT SCANNED (good native text)");
    return false;
  }

  private async extractWithBasicParsing(pdfPath: string): Promise<PdfContent[]> {
    let parser: PDFParse | null = null;

    try {
      const buffer = fs.readFileSync(pdfPath);
      parser = new PDFParse({ data: buffer });

      const textResult = await parser.getText();

      if (!textResult.text || textResult.text.trim() === "") {
        return [];
      }

      // Split into paragraphs and create content blocks
      const paragraphs = textResult.text
        .split(/\n\s*\n/)
        .map((p: string) => p.trim())
        .filter((p: string) => p.length > 0);

      return paragraphs.map((paragraph: string) => ({
        type: "paragraphs" as const,
        content: paragraph,
        pageNumber: 1, // pdf-parse doesn't provide page info
        confidence: 0.6, // Lower confidence for basic extraction
      }));
    } finally {
      if (parser) {
        await parser.destroy();
      }
    }
  }

  private async extractWithOCR(pdfPath: string, options: PdfProcessingOptions): Promise<PdfContent[]> {
    if (!options.enableOCR) {
      return [];
    }

    const startTime = Date.now();
    let processedPages = 0;
    let successfulPages = 0;

    try {
      // Check file size for memory planning
      const stats = fs.statSync(pdfPath);
      const fileSizeMB = stats.size / (1024 * 1024);

      if (fileSizeMB > 50) {
        this.logger.warn(
          `Large PDF file detected (${fileSizeMB.toFixed(2)} MB). OCR processing may take significant time and memory.`,
        );
      }

      // Convert PDF pages to images
      const images = await this.convertPdfToImages(pdfPath);

      if (images.length === 0) {
        this.logger.warn("No images extracted from PDF for OCR");
        return [];
      }

      // Process each image with OCR
      let combinedText = "";
      const pageResults: { pageNum: number; success: boolean; textLength: number; error?: string }[] = [];

      for (let i = 0; i < images.length; i++) {
        processedPages++;
        const pageStartTime = Date.now();

        try {
          const pageText = await this.processImageWithOCR(images[i], options);

          if (pageText && pageText.trim()) {
            combinedText += pageText + "\n\n";
            successfulPages++;

            pageResults.push({
              pageNum: i + 1,
              success: true,
              textLength: pageText.length,
            });
          } else {
            pageResults.push({
              pageNum: i + 1,
              success: false,
              textLength: 0,
              error: "No text extracted",
            });

            this.logger.warn(`OCR page ${i + 1} yielded no text content`);
          }
        } catch (pageError) {
          const pageTime = Date.now() - pageStartTime;
          const errorMessage = pageError instanceof Error ? pageError.message : String(pageError);

          pageResults.push({
            pageNum: i + 1,
            success: false,
            textLength: 0,
            error: errorMessage,
          });

          this.logger.warn(`OCR failed for page ${i + 1} after ${pageTime}ms:`, errorMessage);
          // Continue with other pages
        }

        // Memory cleanup hint for large documents
        if (i > 0 && i % 5 === 0) {
          if (global.gc) {
            global.gc();
          }
        }
      }

      if (!combinedText.trim()) {
        this.logger.warn("OCR did not extract any text from any page");

        // Log detailed failure analysis
        const failureReasons = pageResults
          .filter((result) => !result.success)
          .map((result) => `Page ${result.pageNum}: ${result.error}`)
          .join("; ");

        this.logger.warn(`OCR failure details: ${failureReasons}`);
        return [];
      }

      // Process OCR text through the same intelligent analysis pipeline
      const structuredContent = this.analyzeAndStructureText(combinedText);

      return structuredContent;
    } catch (error) {
      const totalTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logger.error(
        `OCR extraction failed after ${totalTime}ms (processed ${processedPages} pages, ${successfulPages} successful):`,
        errorMessage,
      );

      // Provide actionable error information
      if (errorMessage.includes("ENOENT") || errorMessage.includes("not found")) {
        this.logger.error(
          "OCR failure appears to be due to missing Tesseract installation. Please ensure Tesseract OCR is properly installed.",
        );
      } else if (errorMessage.includes("memory") || errorMessage.includes("heap")) {
        this.logger.error(
          "OCR failure appears to be due to insufficient memory. Consider processing smaller PDF files or increasing Node.js memory allocation.",
        );
      }

      return [];
    }
  }

  private async convertPdfToImages(pdfPath: string): Promise<Buffer[]> {
    const startTime = Date.now();
    let parser: PDFParse | null = null;

    try {
      // Verify PDF file exists and is readable
      if (!fs.existsSync(pdfPath)) {
        throw new Error(`PDF file not found: ${pdfPath}`);
      }

      const convert = pdf2pic.fromPath(pdfPath, {
        density: 400, // Higher DPI for better OCR accuracy on scanned documents
        saveFilename: "page",
        savePath: "/tmp", // Temporary path
        format: "png", // PNG format for better OCR results
        width: 3307, // Scaled width for 400 DPI (proportional to density increase)
        height: 4677, // Scaled height for 400 DPI
        preserveAspectRatio: true,
        graphicsMagick: true, // Use GraphicsMagick instead of ImageMagick (will find 'gm' in PATH)
      });

      // Get total number of pages first
      const buffer = fs.readFileSync(pdfPath);
      parser = new PDFParse({ data: buffer });
      const infoResult = await parser.getInfo();
      const pageCount = infoResult.info?.numPages || 1;

      // Limit pages based on file size and configuration
      const maxPages = Math.min(pageCount, 20); // Hard limit for performance

      if (pageCount > 20) {
        this.logger.warn(`PDF has ${pageCount} pages, limiting OCR to first ${maxPages} pages for performance`);
      }

      const imageBuffers: Buffer[] = [];
      let failedPages = 0;

      // Convert each page to image
      for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
        const pageStartTime = Date.now();

        try {
          const result = await convert(pageNum, { responseType: "buffer" });

          if (result && result.buffer && result.buffer.length > 0) {
            imageBuffers.push(result.buffer);
          } else {
            failedPages++;
          }
        } catch (pageError) {
          failedPages++;
          const pageTime = Date.now() - pageStartTime;
          const errorMessage = pageError instanceof Error ? pageError.message : String(pageError);
          const errorStack = pageError instanceof Error ? pageError.stack : undefined;

          this.logger.error(`Error converting page ${pageNum} after ${pageTime}ms: ${errorMessage}`);
          if (errorStack) {
            this.logger.error(`Stack trace: ${errorStack}`);
          }

          // Try to identify specific error types
          if (errorMessage.includes("permission")) {
            this.logger.error(
              "PDF conversion failed due to permission issues. Check file permissions and /tmp directory access.",
            );
          } else if (errorMessage.includes("memory") || errorMessage.includes("heap")) {
            this.logger.error(
              "PDF conversion failed due to memory constraints. Consider processing smaller documents.",
            );
          } else if (errorMessage.includes("not found") || errorMessage.includes("spawn")) {
            this.logger.error("PDF conversion failed: GraphicsMagick binary not found or not executable");
          }

          // Continue with other pages
        }
      }

      if (failedPages > 0) {
        this.logger.warn(`${failedPages} pages failed to convert to images`);
      }

      return imageBuffers;
    } catch (error) {
      const totalTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logger.error(`Failed to convert PDF to images after ${totalTime}ms: ${errorMessage}`);

      // Provide specific guidance based on error type
      if (errorMessage.includes("not found") || errorMessage.includes("ENOENT")) {
        this.logger.error(
          "PDF conversion failed: File not found or pdf2pic dependencies missing. Ensure GraphicsMagick/ImageMagick is installed.",
        );
      } else if (errorMessage.includes("spawn") || errorMessage.includes("command")) {
        this.logger.error(
          "PDF conversion failed: External command execution failed. Check system dependencies (GraphicsMagick/ImageMagick).",
        );
      }

      return [];
    } finally {
      if (parser) {
        await parser.destroy();
      }
    }
  }

  private async processImageWithOCR(imageBuffer: Buffer, options: PdfProcessingOptions): Promise<string> {
    const startTime = Date.now();
    this.logger.log("==================== OCR PIPELINE START ====================");
    this.logger.log(`Image buffer size: ${(imageBuffer.length / 1024).toFixed(2)} KB`);
    this.logger.log(`OCR options: language=${options.ocrLanguage}, preprocessing=${options.ocrImagePreprocessing}`);

    try {
      // Validate input buffer
      if (!imageBuffer || imageBuffer.length === 0) {
        throw new Error("Invalid image buffer: empty or null buffer provided");
      }

      // Step 1: Detect and correct rotation FIRST (before any processing)
      this.logger.log("--- Step 1: Rotation Detection ---");
      let orientedImageBuffer = imageBuffer;
      let rotationApplied = false;
      try {
        const beforeRotation = imageBuffer.length;
        orientedImageBuffer = await this.detectAndCorrectRotation(imageBuffer);
        const afterRotation = orientedImageBuffer.length;
        rotationApplied = beforeRotation !== afterRotation;
        if (rotationApplied) {
          this.logger.log(`✓ Rotation correction applied (buffer changed: ${beforeRotation} → ${afterRotation} bytes)`);
        }
      } catch {
        this.logger.log("⚠️  Rotation detection failed, proceeding with original orientation");
        orientedImageBuffer = imageBuffer;
      }

      // Configure OCR with PSM 3 (fully automatic page segmentation)
      const ocrOptions = {
        lang: options.ocrLanguage || "eng",
        oem: 1, // Use LSTM OCR Engine Mode
        psm: 3, // Fully automatic page segmentation without OSD
      };
      this.logger.log(`--- OCR Configuration ---`);
      this.logger.log(`Language: ${ocrOptions.lang}, OEM: ${ocrOptions.oem}, PSM: ${ocrOptions.psm}`);

      // Step 2: Apply image preprocessing if enabled AND if image quality assessment suggests it
      this.logger.log("--- Step 2: Preprocessing Assessment ---");
      let processedImageBuffer = orientedImageBuffer;
      if (options.ocrImagePreprocessing) {
        this.logger.log("Preprocessing is ENABLED, assessing image quality...");
        const shouldPreprocess = await this.shouldPreprocessImage(orientedImageBuffer);

        if (shouldPreprocess) {
          const preprocessStart = Date.now();
          this.logger.log("→ Quality assessment: APPLY preprocessing (image needs enhancement)");

          try {
            processedImageBuffer = await this.preprocessImageForOCR(orientedImageBuffer);
            this.logger.log(`✓ Preprocessing completed in ${Date.now() - preprocessStart}ms`);
          } catch (preprocessError) {
            const preprocessErrorMessage =
              preprocessError instanceof Error ? preprocessError.message : String(preprocessError);
            this.logger.warn(
              `⚠️  Preprocessing failed after ${Date.now() - preprocessStart}ms: ${preprocessErrorMessage}`,
            );
            processedImageBuffer = orientedImageBuffer;
          }
        } else {
          this.logger.log("→ Quality assessment: SKIP preprocessing (image is high quality)");
        }
      } else {
        this.logger.log("Preprocessing is DISABLED (default setting)");
      }

      // Step 3: Perform OCR text extraction
      this.logger.log("--- Step 3: OCR Extraction ---");
      this.logger.log("Performing OCR text extraction...");
      const ocrStart = Date.now();
      const text = await tesseract.recognize(processedImageBuffer, ocrOptions);
      this.logger.log(`OCR extraction completed in ${Date.now() - ocrStart}ms`);
      this.logger.log(`Raw OCR output length: ${text.length} characters`);
      this.logger.log(`Raw OCR output (first 500 chars):\n"${text.substring(0, 500)}..."`);

      if (text && text.trim()) {
        // Step 4: Validate OCR quality - reject garbage output
        this.logger.log("--- Step 4: Quality Check ---");
        this.logger.log("Running garbage detection (see detailed logs below)...");
        if (this.isGarbageOcrOutput(text)) {
          this.logger.warn("❌ REJECTED: OCR produced garbage output");
          this.logger.log("==================== OCR PIPELINE END (REJECTED: GARBAGE) ====================");
          return "";
        }

        // Step 5: Clean up trailing artifacts (stamps, margin text, etc.)
        this.logger.log("--- Step 5: Artifact Cleanup ---");
        const cleanedText = this.cleanupOcrArtifacts(text);

        const totalTime = Date.now() - startTime;
        this.logger.log(`✅ OCR SUCCESSFUL - Total time: ${totalTime}ms`);
        this.logger.log("==================== OCR PIPELINE END (SUCCESS) ====================");
        return cleanedText;
      } else {
        this.logger.warn("❌ REJECTED: OCR returned empty text");
        this.logger.log("==================== OCR PIPELINE END (EMPTY) ====================");
        return "";
      }
    } catch (error) {
      const totalTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logger.error(`OCR processing failed after ${totalTime}ms: ${errorMessage}`);

      // Provide specific guidance based on error type
      if (errorMessage.includes("lang") || errorMessage.includes("language")) {
        this.logger.error(
          `OCR language error: Invalid language code '${options.ocrLanguage}'. Ensure the language is installed in Tesseract.`,
        );
      } else if (errorMessage.includes("tesseract") || errorMessage.includes("command not found")) {
        this.logger.error(
          "OCR failed: Tesseract OCR engine not found or not properly installed. Please install Tesseract OCR and ensure it's in the system PATH.",
        );
      } else if (errorMessage.includes("timeout") || errorMessage.includes("killed")) {
        this.logger.error(
          "OCR failed: Process timeout or killed. The image may be too complex or system resources insufficient.",
        );
      } else if (errorMessage.includes("memory") || errorMessage.includes("heap")) {
        this.logger.error(
          "OCR failed: Insufficient memory. Consider reducing image resolution or increasing Node.js memory allocation.",
        );
      } else if (errorMessage.includes("Invalid image") || errorMessage.includes("buffer")) {
        this.logger.error(
          "OCR failed: Invalid image data. The image buffer may be corrupted or in an unsupported format.",
        );
      }

      return "";
    }
  }

  private isGarbageOcrOutput(text: string): boolean {
    this.logger.log("==================== GARBAGE DETECTION START ====================");
    this.logger.log(`Input text (first 200 chars): "${text.substring(0, 200)}..."`);

    if (!text || text.trim().length < 10) {
      this.logger.warn("❌ REJECTED: Text too short (< 10 chars)");
      this.logger.log("==================== GARBAGE DETECTION END ====================");
      return true; // Too short to be meaningful
    }

    const trimmedText = text.trim();
    const totalChars = trimmedText.length;

    // Count various character types
    const specialChars = (trimmedText.match(/[§|{}[\]\\<>«»°^~`]/g) || []).length;
    const punctuation = (trimmedText.match(/[!?.,;:]/g) || []).length;
    const punctuationRatio = punctuation / totalChars;
    const wordChars = (trimmedText.match(/[a-zA-ZÀ-ÿ]/g) || []).length;
    const digits = (trimmedText.match(/\d/g) || []).length;

    this.logger.log("--- Character Analysis ---");
    this.logger.log(`Total characters: ${totalChars}`);
    this.logger.log(`Letters: ${wordChars} (${((wordChars / totalChars) * 100).toFixed(1)}%) [threshold: >= 60%]`);
    this.logger.log(
      `Special chars: ${specialChars} (${((specialChars / totalChars) * 100).toFixed(1)}%) [threshold: < 15%]`,
    );
    this.logger.log(`Punctuation: ${punctuation} (${(punctuationRatio * 100).toFixed(1)}%) [threshold: < 20%]`);
    this.logger.log(`Digits: ${digits} (${((digits / totalChars) * 100).toFixed(1)}%)`);

    // Check 1: Very high ratio of special/unusual characters (> 15%)
    const specialCharsRatio = specialChars / totalChars;
    if (specialCharsRatio > 0.15) {
      this.logger.warn(
        `❌ REJECTED: Check 1 FAILED - High special char ratio ${(specialCharsRatio * 100).toFixed(1)}%`,
      );
      this.logger.log("==================== GARBAGE DETECTION END ====================");
      return true;
    }
    this.logger.log(`✓ Check 1 PASSED - Special char ratio ${(specialCharsRatio * 100).toFixed(1)}% is acceptable`);

    // Check 2: Very low ratio of actual letters (< 60%)
    const letterRatio = wordChars / totalChars;
    if (letterRatio < 0.6) {
      this.logger.warn(`❌ REJECTED: Check 2 FAILED - Low letter ratio ${(letterRatio * 100).toFixed(1)}%`);
      this.logger.log("==================== GARBAGE DETECTION END ====================");
      return true;
    }
    this.logger.log(`✓ Check 2 PASSED - Letter ratio ${(letterRatio * 100).toFixed(1)}% is acceptable`);

    // Check 3: Excessive punctuation (> 20%)
    if (punctuationRatio > 0.2) {
      this.logger.warn(`❌ REJECTED: Check 3 FAILED - High punctuation ratio ${(punctuationRatio * 100).toFixed(1)}%`);
      this.logger.log("==================== GARBAGE DETECTION END ====================");
      return true;
    }
    this.logger.log(`✓ Check 3 PASSED - Punctuation ratio ${(punctuationRatio * 100).toFixed(1)}% is acceptable`);

    // Check 4: Common OCR garbage patterns
    const garbagePatterns = [
      { pattern: /[§]{3,}/, name: "§§§" },
      { pattern: /[|]{3,}/, name: "|||" },
      { pattern: /[{}[\]]{3,}/, name: "{{{/[[[" },
      { pattern: /[!]{3,}/, name: "!!!" },
      { pattern: /[']{5,}/, name: "'''''" },
    ];

    for (const { pattern, name } of garbagePatterns) {
      if (pattern.test(trimmedText)) {
        this.logger.warn(`❌ REJECTED: Check 4 FAILED - Garbage pattern detected: ${name}`);
        this.logger.log("==================== GARBAGE DETECTION END ====================");
        return true;
      }
    }
    this.logger.log("✓ Check 4 PASSED - No garbage patterns detected");

    // Check 5: Detect gibberish words
    this.logger.log("--- Gibberish Word Analysis ---");
    const words = trimmedText.split(/\s+/).filter((w) => w.length > 2);
    this.logger.log(`Total words (>2 chars): ${words.length}`);

    if (words.length > 0) {
      let gibberishCount = 0;
      const gibberishWords: string[] = [];

      for (const word of words) {
        const hasMixedCase = /[a-z][A-Z]/.test(word);
        const hasNumberMix = /[a-zA-Z]\d|\d[a-zA-Z]/.test(word);
        const specialInWord = (word.match(/[§|{}[\]\\<>«»°^~`!@#$%&*]/g) || []).length;
        const hasSpecialMix = specialInWord / word.length > 0.2;

        if (hasMixedCase || hasNumberMix || hasSpecialMix) {
          gibberishCount++;
          const reasons = [];
          if (hasMixedCase) reasons.push("mixed-case");
          if (hasNumberMix) reasons.push("letter-digit-mix");
          if (hasSpecialMix) reasons.push("special-chars");
          gibberishWords.push(`"${word}" (${reasons.join(", ")})`);
        }
      }

      if (gibberishWords.length > 0) {
        this.logger.log(`Gibberish words found (${gibberishCount}/${words.length}):`);
        gibberishWords.slice(0, 10).forEach((w) => this.logger.log(`  - ${w}`));
        if (gibberishWords.length > 10) {
          this.logger.log(`  ... and ${gibberishWords.length - 10} more`);
        }
      }

      const gibberishRatio = gibberishCount / words.length;
      if (gibberishRatio > 0.3) {
        this.logger.warn(
          `❌ REJECTED: Check 5 FAILED - High gibberish word ratio ${(gibberishRatio * 100).toFixed(1)}% (${gibberishCount}/${words.length} words)`,
        );
        this.logger.log("==================== GARBAGE DETECTION END ====================");
        return true;
      }
      this.logger.log(`✓ Check 5 PASSED - Gibberish word ratio ${(gibberishRatio * 100).toFixed(1)}% is acceptable`);
    }

    this.logger.log("✅ ACCEPTED: All garbage checks passed - text appears valid");
    this.logger.log("==================== GARBAGE DETECTION END ====================");
    return false; // Looks reasonable
  }

  /**
   * Clean up OCR artifacts like stamps, margin text, and other trailing garbage
   * Detects and removes trailing sections with consecutive problematic lines
   * @param text Raw OCR text output
   * @returns Cleaned text with trailing artifacts removed
   */
  private cleanupOcrArtifacts(text: string): string {
    this.logger.log("==================== OCR ARTIFACT CLEANUP START ====================");

    const lines = text.split("\n");
    this.logger.log(`Total lines: ${lines.length}`);

    // Scan backwards to find where garbage section starts
    let firstGarbageLineIndex = lines.length; // Start assuming no garbage
    let consecutiveGarbageLines = 0;
    const MIN_CONSECUTIVE_GARBAGE = 5; // Need at least 5 consecutive bad lines to trigger removal

    // Scan from end backwards
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();

      // Skip empty lines (don't count as garbage or good)
      if (line.length === 0) {
        continue;
      }

      const isProblematicLine = this.isProblematicLine(line);

      if (isProblematicLine) {
        consecutiveGarbageLines++;
        firstGarbageLineIndex = i; // Mark this as potential start of garbage section
      } else {
        // Found a good line - check if we've accumulated enough garbage to remove
        if (consecutiveGarbageLines >= MIN_CONSECUTIVE_GARBAGE) {
          // We have a garbage section from firstGarbageLineIndex to end
          this.logger.log(`Found trailing garbage section starting at line ${firstGarbageLineIndex + 1}`);
          this.logger.log(`Consecutive garbage lines: ${consecutiveGarbageLines}`);
          break;
        } else {
          // Reset counter - not enough consecutive garbage
          consecutiveGarbageLines = 0;
          firstGarbageLineIndex = lines.length;
        }
      }
    }

    // Determine if we should truncate
    if (consecutiveGarbageLines >= MIN_CONSECUTIVE_GARBAGE && firstGarbageLineIndex < lines.length) {
      const cleanedLines = lines.slice(0, firstGarbageLineIndex);
      const cleanedText = cleanedLines.join("\n").trim();

      const removedLines = lines.length - firstGarbageLineIndex;
      const originalLength = text.length;
      const cleanedLength = cleanedText.length;
      const removedChars = originalLength - cleanedLength;

      this.logger.log(`✂️  TRUNCATED: Removed ${removedLines} trailing garbage lines`);
      this.logger.log(
        `Character reduction: ${originalLength} → ${cleanedLength} (removed ${removedChars} chars, ${((removedChars / originalLength) * 100).toFixed(1)}%)`,
      );
      this.logger.log(`Removed content preview (first 200 chars):`);
      this.logger.log(
        `"${lines
          .slice(firstGarbageLineIndex, firstGarbageLineIndex + 10)
          .join("\n")
          .substring(0, 200)}..."`,
      );
      this.logger.log("==================== OCR ARTIFACT CLEANUP END ====================");

      return cleanedText;
    } else {
      this.logger.log("✓ No trailing garbage detected - keeping full text");
      this.logger.log("==================== OCR ARTIFACT CLEANUP END ====================");
      return text;
    }
  }

  /**
   * Check if a line is problematic (likely an artifact/stamp/margin text)
   * @param line Single line of text (trimmed)
   * @returns true if the line looks like garbage/artifact
   */
  private isProblematicLine(line: string): boolean {
    // Check 1: Very short lines (< 5 chars) - likely fragments
    if (line.length < 5) {
      return true;
    }

    // Count character types
    let letters = 0;
    let specialChars = 0;

    for (const char of line) {
      if (/[a-zA-Z\u00C0-\u017F]/.test(char)) {
        letters++;
      } else if (/[!@#$%^&*()_+=\[\]{};':"\\|<>?~`§°]/.test(char)) {
        specialChars++;
      }
    }

    // Check 2: High special character ratio (> 30%)
    const specialRatio = specialChars / line.length;
    if (specialRatio > 0.3) {
      return true;
    }

    // Check 3: Low letter ratio (< 40%) - mostly symbols/punctuation
    const letterRatio = letters / line.length;
    if (letterRatio < 0.4) {
      return true;
    }

    // Check 4: Pattern matching for common stamp/artifact patterns
    // Lines with many brackets, parentheses, or isolated symbols
    const bracketCount = (line.match(/[\[\](){}]/g) || []).length;
    if (bracketCount > 3) {
      return true;
    }

    return false;
  }

  /**
   * Detect and correct image rotation using Tesseract OSD (Orientation and Script Detection)
   * Returns the correctly oriented image buffer
   */
  private async detectAndCorrectRotation(imageBuffer: Buffer): Promise<Buffer> {
    try {
      // Use Tesseract PSM 0 for Orientation and Script Detection only
      // This doesn't do OCR, just detects the page orientation
      const osdResult = await tesseract.recognize(imageBuffer, {
        lang: "osd", // Special language for orientation detection
        psm: 0, // PSM 0: Orientation and script detection only
      });

      // Parse the OSD output to extract rotation angle
      // Example output: "Page number: 0\nOrientation in degrees: 90\n..."
      const rotateMatch = osdResult.match(/Orientation in degrees:\s*(\d+)/i) || osdResult.match(/Rotate:\s*(\d+)/i);

      if (rotateMatch) {
        const rotationAngle = parseInt(rotateMatch[1], 10);

        // Only rotate if angle is significant (90, 180, 270 degrees)
        if (rotationAngle === 90 || rotationAngle === 180 || rotationAngle === 270) {
          this.logger.debug(`Detected rotation: ${rotationAngle}° - correcting orientation`);

          // Rotate the image using Sharp
          // Note: Sharp rotates clockwise, so we need to negate for counter-clockwise correction
          const correctedBuffer = await sharp(imageBuffer).rotate(-rotationAngle).toBuffer();

          return correctedBuffer;
        } else if (rotationAngle === 0) {
          this.logger.debug("Image orientation is correct (0°)");
          return imageBuffer;
        } else {
          this.logger.warn(`Unusual rotation angle detected: ${rotationAngle}° - skipping correction`);
          return imageBuffer;
        }
      } else {
        this.logger.debug("Could not detect rotation angle from OSD output, assuming correct orientation");
        return imageBuffer;
      }
    } catch {
      // OSD can fail on images without clear text orientation
      // Don't fail the entire OCR process - just use original image
      this.logger.debug("Rotation detection failed (image may lack clear text orientation), using original image");
      return imageBuffer;
    }
  }

  /**
   * Assess image quality to determine if preprocessing would help or damage the image
   * High-quality scans with clean text should SKIP preprocessing to avoid damaging text
   * Low-quality scans with noise/blur should USE preprocessing for enhancement
   */
  private async shouldPreprocessImage(imageBuffer: Buffer): Promise<boolean> {
    try {
      const image = sharp(imageBuffer);
      const metadata = await image.metadata();
      const stats = await image.stats();

      // Check 1: High-resolution images (>= 300 DPI or width > 2000px)
      // High-res scans are typically clean and don't need aggressive enhancement
      const isHighResolution =
        (metadata.density && metadata.density >= 300) || (metadata.width && metadata.width > 2000);

      // Check 2: Image sharpness via entropy
      // Entropy > 6.5 suggests sharp, well-defined edges (clean scan)
      // Entropy < 5.0 suggests blurry or degraded image (needs preprocessing)
      const channels = stats.channels || [];
      const avgEntropy =
        channels.length > 0
          ? channels.reduce((sum: number, ch: any) => sum + (ch.entropy || 0), 0) / channels.length
          : 0;
      const isSharp = avgEntropy > 6.5;

      // Check 3: Good contrast (not washed out or too dark)
      // Standard deviation of pixel values indicates contrast
      const avgStdDev =
        channels.length > 0 ? channels.reduce((sum: number, ch: any) => sum + (ch.std || 0), 0) / channels.length : 0;
      const hasGoodContrast = avgStdDev > 40; // Values typically range 0-128

      // Decision: Skip preprocessing if image is already high-quality
      const isHighQuality = isHighResolution && isSharp && hasGoodContrast;

      this.logger.debug(
        `Image quality assessment: resolution=${isHighResolution}, sharp=${isSharp} (entropy=${avgEntropy.toFixed(2)}), contrast=${hasGoodContrast} (stdDev=${avgStdDev.toFixed(2)}) → ${isHighQuality ? "skip" : "apply"} preprocessing`,
      );

      return !isHighQuality; // Return true if preprocessing should be applied
    } catch (error) {
      this.logger.warn("Image quality assessment failed, applying preprocessing as fallback:", error);
      return true; // Default to preprocessing on error
    }
  }

  private async preprocessImageForOCR(imageBuffer: Buffer): Promise<Buffer> {
    try {
      // Apply image enhancements using Sharp
      const processedBuffer = await sharp(imageBuffer)
        // Convert to grayscale for better OCR performance
        .grayscale()
        // Enhance contrast and brightness
        .modulate({
          brightness: 1.1, // Slightly increase brightness
          saturation: 1.0, // Maintain saturation (will be ignored in grayscale)
          lightness: 1.0,
        })
        // Apply contrast enhancement
        .linear(1.2, 0) // Increase contrast by 20%
        // Apply sharpening filter to improve text clarity
        .sharpen({
          sigma: 1, // Sharpening strength
          m1: 1.0, // Sharpen dark areas
          m2: 0.2, // Don't over-sharpen light areas
          x1: 2, // Sharpening threshold
          y2: 10, // Maximum sharpening
          y3: 20, // Minimum sharpening
        })
        // Apply noise reduction
        .median(3) // 3x3 median filter to reduce noise
        // Ensure proper output format
        .png({
          quality: 100,
          compressionLevel: 0, // No compression for OCR
          progressive: false,
        })
        .toBuffer();
      return processedBuffer;
    } catch (error) {
      this.logger.warn("Image preprocessing failed, using original image:", error);
      return imageBuffer; // Return original if preprocessing fails
    }
  }

  async getRawElements(filePath: string, options?: Partial<PdfProcessingOptions>): Promise<any[]> {
    const contentBlocks = await this.extractPdfContent(filePath, options);

    return contentBlocks.map((block) => ({
      type: block.type,
      content: typeof block.content === "string" ? block.content : JSON.stringify(block.content),
    }));
  }

  async load(params: { filePath: string }, options?: Partial<PdfProcessingOptions>): Promise<Document[]> {
    const contentBlocks = await this.extractPdfContent(params.filePath, options);

    return contentBlocks.map(
      (block) =>
        new Document({
          pageContent: block.content,
          metadata: {
            type: block.type,
            pageNumber: block.pageNumber,
            confidence: block.confidence,
          },
        }),
    );
  }
}
