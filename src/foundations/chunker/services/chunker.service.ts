import { CSVLoader } from "@langchain/community/document_loaders/fs/csv";
import { BaseDocumentLoader } from "@langchain/core/document_loaders/base";
import { Document } from "@langchain/core/documents";
import { HumanMessage } from "@langchain/core/messages";
import { MarkdownTextSplitter, RecursiveCharacterTextSplitter, TokenTextSplitter } from "@langchain/textsplitters";
import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "crypto";
import * as fs from "fs/promises";
import { ModelService } from "../../../core/llm/services/model.service";
import { isImageFile } from "../../chunker/constants/file.types";
import { DocXService } from "../../chunker/services/types/docx.service";
import { PdfService } from "../../chunker/services/types/pdf.service";
import { PptxService } from "../../chunker/services/types/pptx.service";
import { SemanticSplitterService } from "../../chunker/services/types/semanticsplitter.service";
import { XlsxService } from "../../chunker/services/types/xlsx.service";
import { S3Service } from "../../s3/services/s3.service";
import { JSONLinesLoader, JSONLoader } from "../loaders/json.loader";
import { TextLoader } from "../loaders/text.loader";

@Injectable()
export class ChunkerService {
  private logger: Logger = new Logger(ChunkerService.name);

  constructor(
    private readonly semanticSplitterService: SemanticSplitterService,
    private readonly docxService: DocXService,
    private readonly pptxService: PptxService,
    private readonly pdfService: PdfService,
    private readonly xlsxService: XlsxService,
    private readonly s3Service: S3Service,
    private readonly modelService: ModelService,
  ) {}

  private async _downloadFileAsBuffer(params: { url: string; extension: string }): Promise<Buffer> {
    const response = await fetch(params.url);
    if (!response.ok) {
      throw new Error(`Failed to fetch the file: ${response.statusText}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  private async _downloadFile(params: { url: string; extension: string }): Promise<string> {
    const buffer = await this._downloadFileAsBuffer(params);
    const tempFilePath = `/tmp/temp-file.${randomUUID()}.${params.extension}`;
    await fs.writeFile(tempFilePath, buffer);
    return tempFilePath;
  }

  async generateContentStructureFromFile(params: { fileType: string; filePath: string }): Promise<Document[]> {
    if (isImageFile(params.fileType)) return this._createChunksFromImage(params);

    const localFilePath = await this._downloadFile({
      url: params.filePath,
      extension: params.fileType,
    });

    let response: Document[] = [];

    switch (params.fileType.toLowerCase()) {
      case "md":
        response = await this._createFromMarkdown({ filePath: params.filePath, localFilePath });
        break;
      case "docx":
        response = await this._createFromDocX({ filePath: params.filePath, localFilePath });
        break;
      case "pptx":
      case "presentation":
        response = await this._createFromPptx({ filePath: params.filePath, localFilePath });
        break;
      case "xlsx":
      case "spreadsheet":
        response = await this._createFromXlsx({ filePath: params.filePath, localFilePath });
        break;
      case "pdf":
        response = await this._createFromPdf({ filePath: params.filePath, localFilePath });
        break;
      default:
        let loader: BaseDocumentLoader;
        switch (params.fileType.toLowerCase()) {
          case "json":
            loader = new JSONLoader(localFilePath, "/texts");
            break;
          case "jsonl":
            loader = new JSONLinesLoader(localFilePath, "/html");
            break;
          case "csv":
            loader = new CSVLoader(localFilePath, "text") as any;
            break;
          default:
            loader = new TextLoader(localFilePath);
            break;
        }

        const rawDocs = await loader.load();

        const textSplitter = new TokenTextSplitter({
          chunkSize: 1000,
          chunkOverlap: 200,
        });

        response = await textSplitter.splitDocuments(rawDocs);
        break;
    }

    return response;
  }

  async generateContentStructureFromMarkdown(params: { content: string; title?: string }): Promise<Document[]> {
    try {
      const semanticChunks = await this.semanticSplitterService.splitMarkdownToChunks({
        content: params.content,
        title: params.title,
      });

      if (semanticChunks && semanticChunks.length > 0) {
        return semanticChunks;
      }
    } catch (error) {
      this.logger.warn("Semantic markdown splitting failed, falling back to markdown splitter:", error);
    }

    const splitter = new MarkdownTextSplitter({
      chunkSize: 1500,
      chunkOverlap: 200,
    });
    const response = await splitter.createDocuments([params.content]);

    return response;
  }

  async extractContentFromUrl(params: { url: string }): Promise<string> {
    const response = await fetch(params.url);
    if (!response.ok) {
      throw new Error(`Failed to fetch content from URL: ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type") || "";
    const buffer = Buffer.from(await response.arrayBuffer());

    // Determine file type from content-type header
    let fileType = "txt";
    if (contentType.includes("pdf")) {
      fileType = "pdf";
    } else if (contentType.includes("word") || contentType.includes("docx")) {
      fileType = "docx";
    } else if (contentType.includes("markdown") || params.url.endsWith(".md")) {
      fileType = "md";
    } else if (contentType.includes("html")) {
      // For HTML, extract text content
      const text = buffer.toString("utf-8");
      // Simple HTML tag removal for basic content extraction
      return text
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    // For simple text files, return content directly
    if (fileType === "txt" || fileType === "md") {
      return buffer.toString("utf-8");
    }

    // For complex file types, write to temp file and process
    const tempFilePath = `/tmp/temp-file.${randomUUID()}.${fileType}`;
    await fs.writeFile(tempFilePath, buffer);

    try {
      const documents = await this.generateContentStructureFromFile({ fileType, filePath: params.url });
      return documents.map((doc) => doc.pageContent).join("\n\n");
    } finally {
      // Clean up temp file
      await fs.unlink(tempFilePath).catch(() => {});
    }
  }

  private async _createChunksFromImage(params: { filePath: string; fileType: string }): Promise<Document[]> {
    try {
      const imageUrl = params.filePath.toLowerCase().startsWith("http")
        ? params.filePath
        : await this.s3Service.generateSignedUrl({ key: params.filePath });

      const imageBuffer = await this._downloadFileAsBuffer({
        url: imageUrl,
        extension: params.fileType,
      });

      const model = this.modelService.getLLM({ temperature: 0.2 });

      // Analyze the image directly using the LLM
      const imageDescription = await model.invoke([
        new HumanMessage({
          content: [
            {
              type: "text",
              text: "Describe this image in detail, including all visible text, objects, people, scenes, and any relevant information that would be useful for document processing and knowledge extraction.",
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/${params.fileType};base64,${imageBuffer.toString("base64")}`,
              },
            },
          ],
        }),
      ]);

      if (imageDescription?.content) {
        // Create chunks from the image description
        const splitter = new RecursiveCharacterTextSplitter({
          chunkSize: 1000,
          chunkOverlap: 200,
        });
        return await splitter.createDocuments([imageDescription.content.toString()]);
      }

      return [];
    } catch (error) {
      this.logger.error("Error processing image file:", error);
      return [];
    }
  }

  private async _createFromMarkdown(params: { filePath: string; localFilePath: string }): Promise<Document[]> {
    const markdown = await fs.readFile(params.localFilePath, "utf-8");

    const urlParts = params.filePath.split("/");
    const filename = urlParts[urlParts.length - 1];
    const title = filename.replace(/\.md$/i, "");

    try {
      return await this.semanticSplitterService.splitMarkdownToChunks({
        content: markdown,
        title: title,
      });
    } catch (error) {
      this.logger.error("Semantic markdown splitting failed, falling back to markdown splitter:", error);
      const splitter = new MarkdownTextSplitter({
        chunkSize: 1500,
        chunkOverlap: 200,
      });
      return await splitter.createDocuments([markdown]);
    }
  }

  private async _createFromDocX(params: { filePath: string; localFilePath: string }): Promise<Document[]> {
    const rawElements = await this.docxService.getRawElements(params.localFilePath);
    const markdownContent = this.docxService.convertToMarkdown(rawElements);

    if (markdownContent && markdownContent.trim()) {
      try {
        return await this.semanticSplitterService.splitMarkdownToChunks({
          content: markdownContent,
        });
      } catch (error) {
        this.logger.error("Semantic markdown splitting failed, falling back to markdown splitter:", error);
        const splitter = new MarkdownTextSplitter({
          chunkSize: 1500,
          chunkOverlap: 200,
        });
        return await splitter.createDocuments([markdownContent]);
      }
    }

    const response: Document[] = [];
    const documentParts = await this.docxService.load({ filePath: params.localFilePath });

    for (const part of documentParts) {
      if (part.metadata?.type === "paragraphs") {
        const splitter = new RecursiveCharacterTextSplitter({
          chunkSize: 500,
          chunkOverlap: 20,
        });
        const parts = await splitter.createDocuments([part.pageContent]);

        response.push(...parts);
      } else {
        response.push(part);
      }
    }

    return response;
  }

  private async _createFromPptx(params: { filePath: string; localFilePath: string }): Promise<Document[]> {
    const extractedContent = await this.pptxService.getRawElements(params.localFilePath);

    const markdownContent = this.pptxService.convertToMarkdown(extractedContent);

    if (markdownContent && markdownContent.trim()) {
      try {
        return await this.semanticSplitterService.splitMarkdownToChunks({
          content: markdownContent,
          title: undefined,
        });
      } catch (error) {
        this.logger.error("Presentation processing failed:", error);
        const splitter = new MarkdownTextSplitter({
          chunkSize: 1500,
          chunkOverlap: 200,
        });
        return await splitter.createDocuments([markdownContent]);
      }
    }

    const response: Document[] = [];
    const documentParts = await this.pptxService.load({ filePath: params.localFilePath });

    for (const part of documentParts) {
      const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 800,
        chunkOverlap: 100,
      });
      const parts = await splitter.createDocuments([part.pageContent]);
      response.push(...parts);
    }

    return response;
  }

  private async _createFromXlsx(params: { filePath: string; localFilePath: string }): Promise<Document[]> {
    const worksheetData = await this.xlsxService.extractXlsxContent(params.localFilePath);

    if (worksheetData && worksheetData.length > 0) {
      const markdownChunks = this.xlsxService.convertToMarkdownChunks(worksheetData);

      return markdownChunks.map(
        (chunkContent, index) =>
          new Document({
            pageContent: chunkContent,
            metadata: {
              type: "xlsx",
              source: params.filePath,
              chunkIndex: index,
              totalChunks: markdownChunks.length,
            },
          }),
      );
    }

    const response: Document[] = [];
    const documentParts = await this.xlsxService.load({ filePath: params.localFilePath });

    for (const part of documentParts) {
      const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 1000,
        chunkOverlap: 100,
      });
      const parts = await splitter.createDocuments([part.pageContent]);
      response.push(...parts);
    }

    return response;
  }

  private async _createFromPdf(params: { filePath: string; localFilePath: string }): Promise<Document[]> {
    try {
      const pdfContent = await this.pdfService.extractPdfContent(params.localFilePath);

      const markdownContent = pdfContent
        .map((block) => {
          if (block.type === "header") {
            return `# ${block.content}`;
          } else if (block.type === "table") {
            return typeof block.content === "string" ? block.content : JSON.stringify(block.content);
          } else {
            return block.content;
          }
        })
        .join("\n\n");

      if (markdownContent && markdownContent.trim()) {
        try {
          return await this.semanticSplitterService.splitMarkdownToChunks({
            content: markdownContent,
            title: undefined,
          });
        } catch (error) {
          this.logger.error("Presentation processing failed:", error);
          const splitter = new MarkdownTextSplitter({
            chunkSize: 1500,
            chunkOverlap: 200,
          });
          return await splitter.createDocuments([markdownContent]);
        }
      }

      const rawElements = await this.pdfService.getRawElements(params.localFilePath);

      return rawElements.map(
        (element) =>
          new Document({
            pageContent: element.content,
            metadata: {
              type: element.type,
            },
          }),
      );
    } catch (error) {
      this.logger.error("PDF processing failed:", error);
      return [];
    }
  }
}
