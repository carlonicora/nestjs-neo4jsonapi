import { Injectable, Logger } from "@nestjs/common";
import { Document } from "@langchain/core/documents";
import * as fs from "fs/promises";
import * as XLSX from "xlsx-republish";
import { loadZipWithinLimits } from "../../utils/zip-limits";

interface WorksheetData {
  name: string;
  data: any[][];
  range?: XLSX.Range;
}

@Injectable()
export class XlsxService {
  private readonly logger = new Logger(XlsxService.name);

  public convertToMarkdown(worksheetData: WorksheetData[]): string {
    this.logger.debug("🔄 XLSX SERVICE - convertToMarkdown called with intelligent chunking");
    this.logger.debug(`🔄 XLSX SERVICE - Processing ${worksheetData.length} worksheets`);

    if (!worksheetData || worksheetData.length === 0) {
      this.logger.debug("🔄 XLSX SERVICE - Empty worksheet data, returning empty string");
      return "";
    }

    const markdownSections = worksheetData
      .flatMap((worksheet) => {
        this.logger.debug(`🔄 XLSX SERVICE - Processing worksheet: ${worksheet.name}`);

        if (!worksheet.data || worksheet.data.length === 0) {
          this.logger.debug(`🔄 XLSX SERVICE - Empty data in worksheet: ${worksheet.name}`);
          return [];
        }

        // Filter out completely empty rows
        const filteredData = worksheet.data.filter((row) =>
          row.some((cell) => cell !== null && cell !== undefined && cell !== ""),
        );

        if (filteredData.length === 0) {
          this.logger.debug(`🔄 XLSX SERVICE - No data after filtering in worksheet: ${worksheet.name}`);
          return [];
        }

        return this.chunkWorksheetData(worksheet.name, filteredData);
      })
      .filter(Boolean);

    const result = markdownSections.join("\n\n---\n\n");

    this.logger.debug(
      `🔄 XLSX SERVICE - Markdown conversion result: ${markdownSections.length} sections, ${result.length} chars`,
    );
    this.logger.debug(`🔄 XLSX SERVICE - Markdown preview (first 500 chars): ${result.substring(0, 500)}`);

    return result;
  }

  public convertToMarkdownChunks(worksheetData: WorksheetData[]): string[] {
    if (!worksheetData || worksheetData.length === 0) {
      return [];
    }

    const markdownSections = worksheetData
      .flatMap((worksheet) => {
        if (!worksheet.data || worksheet.data.length === 0) {
          return [];
        }

        // Filter out completely empty rows
        const filteredData = worksheet.data.filter((row) =>
          row.some((cell) => cell !== null && cell !== undefined && cell !== ""),
        );

        if (filteredData.length === 0) {
          return [];
        }

        return this.chunkWorksheetData(worksheet.name, filteredData);
      })
      .filter(Boolean);

    return markdownSections;
  }

  private chunkWorksheetData(worksheetName: string, filteredData: any[][]): string[] {
    const MAX_ROWS_PER_CHUNK = 50;
    const MAX_COLS_PER_CHUNK = 20;
    const MAX_CONTENT_SIZE = 5000; // characters

    const numRows = filteredData.length;
    const numCols = filteredData[0]?.length || 0;

    // Estimate content size by creating a small sample
    const sampleSize = Math.min(5, numRows);
    const sampleContent = this.convertDataToMarkdownTable(filteredData.slice(0, sampleSize));
    const estimatedTotalSize = Math.round((sampleContent.length / sampleSize) * numRows);

    const needsRowSplit = numRows > MAX_ROWS_PER_CHUNK + 1;
    const needsColSplit = numCols > MAX_COLS_PER_CHUNK;
    const needsContentSplit = estimatedTotalSize > MAX_CONTENT_SIZE;

    if (!needsRowSplit && !needsColSplit && !needsContentSplit) {
      // Small table - process normally
      const markdownContent = `## ${worksheetName}\n\n` + this.convertDataToMarkdownTable(filteredData);
      return [markdownContent];
    }

    // Large table - need to chunk
    const headerRow = filteredData[0];
    const dataRows = filteredData.slice(1);
    const chunks: string[] = [];

    // Handle column splitting if needed
    const columnChunks = needsColSplit
      ? this.splitTableByColumns(headerRow, MAX_COLS_PER_CHUNK)
      : [{ start: 0, end: numCols - 1, headers: headerRow }];

    // For each column chunk, handle row splitting
    for (const colChunk of columnChunks) {
      const chunkHeaders = headerRow.slice(colChunk.start, colChunk.end + 1);
      const rowChunkSize = needsRowSplit ? MAX_ROWS_PER_CHUNK : dataRows.length;

      for (let i = 0; i < dataRows.length; i += rowChunkSize) {
        const chunkRows = dataRows.slice(i, i + rowChunkSize);
        const chunkRowsWithCols = chunkRows.map((row) => row.slice(colChunk.start, colChunk.end + 1));
        const chunkData = [chunkHeaders, ...chunkRowsWithCols];

        const rowStart = i + 1;
        const rowEnd = Math.min(i + rowChunkSize, dataRows.length);
        const colStart = colChunk.start + 1; // +1 for 1-based indexing
        const colEnd = colChunk.end + 1;

        let chunkTitle = `## ${worksheetName}`;
        if (needsRowSplit && needsColSplit) {
          chunkTitle += ` (Rows ${rowStart}-${rowEnd} of ${dataRows.length}, Cols ${colStart}-${colEnd} of ${numCols})`;
        } else if (needsRowSplit) {
          chunkTitle += ` (Rows ${rowStart}-${rowEnd} of ${dataRows.length})`;
        } else if (needsColSplit) {
          chunkTitle += ` (Cols ${colStart}-${colEnd} of ${numCols})`;
        }

        const markdownTable = this.convertDataToMarkdownTable(chunkData);
        const markdownContent = `${chunkTitle}\n\n${markdownTable}`;

        chunks.push(markdownContent);
      }
    }

    return chunks;
  }

  private splitTableByColumns(
    headerRow: any[],
    maxColsPerChunk: number,
  ): Array<{ start: number; end: number; headers: any[] }> {
    const columnChunks = [];

    for (let i = 0; i < headerRow.length; i += maxColsPerChunk) {
      const end = Math.min(i + maxColsPerChunk - 1, headerRow.length - 1);
      columnChunks.push({
        start: i,
        end: end,
        headers: headerRow.slice(i, end + 1),
      });
    }

    return columnChunks;
  }

  private convertDataToMarkdownTable(data: any[][]): string {
    if (data.length === 0) return "";

    // Use first row as headers
    const headers = data[0];
    const dataRows = data.slice(1);

    // Clean and format headers
    const cleanHeaders = headers.map((header) => {
      const cleanHeader = String(header || "").trim();
      return cleanHeader || "Column";
    });

    // Create markdown table header
    const headerRow = `| ${cleanHeaders.join(" | ")} |`;
    const separatorRow = `|${cleanHeaders.map(() => "-------").join("|")}|`;

    // Create data rows
    const markdownRows = dataRows
      .filter((row) => row.some((cell) => cell !== null && cell !== undefined && cell !== ""))
      .map((row) => {
        const cells = row.map((cell, index) => {
          if (index >= cleanHeaders.length) return ""; // Don't exceed header count

          let cellValue = "";
          if (cell !== null && cell !== undefined) {
            // Handle different data types
            if (typeof cell === "number") {
              cellValue = cell.toString();
            } else if (cell instanceof Date) {
              cellValue = cell.toLocaleDateString();
            } else {
              cellValue = String(cell).trim();
            }
          }

          // Escape pipe characters in cell content
          return cellValue.replace(/\|/g, "\\|");
        });

        // Pad with empty cells if row is shorter than headers
        while (cells.length < cleanHeaders.length) {
          cells.push("");
        }

        return `| ${cells.join(" | ")} |`;
      });

    if (markdownRows.length === 0) {
      return `${headerRow}\n${separatorRow}\n| ${cleanHeaders.map(() => "").join(" | ")} |`;
    }

    return [headerRow, separatorRow, ...markdownRows].join("\n");
  }

  async extractXlsxContent(xlsxPath: string): Promise<WorksheetData[]> {
    // An XLSX is a zip: refuse one that expands beyond the zip limits BEFORE SheetJS inflates it
    // (outside the try below, so the refusal reaches the caller instead of reading as "empty").
    // A non-zip spreadsheet (legacy .xls, CSV) has nothing to inflate and is parsed as before.
    const buffer = await fs.readFile(xlsxPath);
    await loadZipWithinLimits({ buffer, label: "XLSX" });

    try {
      // Read the Excel file
      const workbook = XLSX.read(buffer, { type: "buffer" });

      const worksheetData: WorksheetData[] = [];

      // Process each worksheet
      for (const sheetName of workbook.SheetNames) {
        const worksheet = workbook.Sheets[sheetName];
        const range = worksheet["!ref"];

        if (!range) {
          continue;
        }

        // Convert worksheet to array of arrays
        const data = XLSX.utils.sheet_to_json(worksheet, {
          header: 1, // Return array of arrays instead of objects
          defval: "", // Default value for empty cells
          raw: false, // Format values as strings
        });

        if (data.length === 0) {
          continue;
        }

        worksheetData.push({
          name: sheetName,
          data: data as any[][],
          range: XLSX.utils.decode_range(range),
        });
      }

      return worksheetData;
    } catch (error) {
      this.logger.error("💥 XLSX SERVICE - Error extracting XLSX content:", error);
      return [];
    }
  }

  async getRawElements(filePath: string): Promise<string> {
    const worksheetData = await this.extractXlsxContent(filePath);
    return this.convertToMarkdown(worksheetData);
  }

  async load(params: { filePath: string }): Promise<Document[]> {
    const worksheetData = await this.extractXlsxContent(params.filePath);

    if (!worksheetData || worksheetData.length === 0) {
      return [];
    }

    // Create separate documents for each worksheet
    const documents: Document[] = [];

    for (const worksheet of worksheetData) {
      if (!worksheet.data || worksheet.data.length === 0) continue;

      const markdownContent = this.convertToMarkdown([worksheet]);

      if (markdownContent && markdownContent.trim()) {
        documents.push(
          new Document({
            pageContent: markdownContent,
            metadata: {
              type: "xlsx",
              source: params.filePath,
              worksheet: worksheet.name,
              rows: worksheet.data.length,
              range: worksheet.range
                ? `${worksheet.range.s.c},${worksheet.range.s.r}:${worksheet.range.e.c},${worksheet.range.e.r}`
                : undefined,
            },
          }),
        );
      }
    }

    return documents;
  }
}
