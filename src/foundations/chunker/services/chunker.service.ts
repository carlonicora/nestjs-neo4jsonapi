import { CSVLoader } from "@langchain/community/document_loaders/fs/csv";
import { BaseDocumentLoader } from "@langchain/core/document_loaders/base";
import { Document } from "@langchain/core/documents";
import { HumanMessage } from "@langchain/core/messages";
import { MarkdownTextSplitter, RecursiveCharacterTextSplitter, TokenTextSplitter } from "@langchain/textsplitters";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "crypto";
import * as fs from "fs/promises";
import { BaseConfigInterface } from "../../../config/interfaces/base.config.interface";
import { ConfigAiInterface } from "../../../config/interfaces/config.ai.interface";
import { ConfigChunkerInterface } from "../../../config/interfaces/config.chunker.interface";
import { ModelService } from "../../../core/llm/services/model.service";
import { S3Service } from "../../s3/services/s3.service";
import { isImageFile } from "../constants/file.types";
import { JSONLinesLoader, JSONLoader } from "../loaders/json.loader";
import { TextLoader } from "../loaders/text.loader";
import { DocXService } from "./types/docx.service";
import { EmailParserService } from "./types/email.service";
import { MarkdownChunkingService } from "./types/markdownchunking.service";
import { PdfService } from "./types/pdf.service";
import { PptxService } from "./types/pptx.service";
import { SemanticSplitterService } from "./types/semanticsplitter.service";
import { XlsxService } from "./types/xlsx.service";

@Injectable()
export class ChunkerService {
  private logger: Logger = new Logger(ChunkerService.name);

  private readonly splitter: { splitMarkdownToChunks(p: { content: string; title?: string }): Promise<Document[]> };
  private readonly targetChars: number;

  constructor(
    private readonly markdownChunkingService: MarkdownChunkingService,
    private readonly semanticSplitterService: SemanticSplitterService,
    private readonly docxService: DocXService,
    private readonly pptxService: PptxService,
    private readonly pdfService: PdfService,
    private readonly xlsxService: XlsxService,
    private readonly modelService: ModelService,
    private readonly s3Service: S3Service,
    private readonly emailParserService: EmailParserService,
    private readonly config: ConfigService<BaseConfigInterface>,
  ) {
    const chunker = this.config.get<ConfigChunkerInterface>("chunker");
    this.splitter = chunker?.strategy === "semantic" ? this.semanticSplitterService : this.markdownChunkingService;
    this.targetChars = chunker?.targetChars ?? 1500;
    // [CHUNKER-PORT] temporary validation log — confirms the active config seam at boot.
    this.logger.log(
      `[CHUNKER-PORT] active config → strategy=${chunker?.strategy ?? "(default)"} ` +
        `splitter=${(this.splitter as object)?.constructor?.name} ` +
        `targetChars=${this.targetChars} ocrLanguage=${chunker?.ocrLanguage ?? "(default)"}`,
    );
  }

  // [CHUNKER-PORT] temporary validation log — summarises what the chunker produced for one file.
  private _logChunkResult(fileType: string, docs: Document[]): void {
    const methods = [...new Set(docs.map((d) => d.metadata?.split_method ?? d.metadata?.type ?? "?"))];
    const sizes = docs.map((d) => d.pageContent.length);
    const max = sizes.length ? Math.max(...sizes) : 0;
    const min = sizes.length ? Math.min(...sizes) : 0;
    this.logger.log(
      `[CHUNKER-PORT] file=${fileType} chunks=${docs.length} ` +
        `split_methods=[${methods.join(",")}] sizes(min/max)=${min}/${max} (targetChars=${this.targetChars})`,
    );
  }

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
    if (this.config.get<ConfigAiInterface>("ai").mock) {
      return [
        new Document({
          pageContent: "mock chunk content for smoke testing",
          metadata: { source: params.filePath, mock: true },
        }),
      ];
    }

    if (isImageFile(params.fileType)) return this._createChunksFromImage(params);

    const localFilePath = await this._downloadFile({
      url: params.filePath,
      extension: params.fileType,
    });

    // Email files need special handling (attachment extraction)
    if (params.fileType.toLowerCase() === "eml" || params.fileType.toLowerCase() === "msg") {
      return this._createFromEmail({
        filePath: params.filePath,
        localFilePath,
        fileType: params.fileType.toLowerCase(),
      });
    }

    const docs = await this._processLocalFile({
      localFilePath,
      fileType: params.fileType,
      filePath: params.filePath,
    });
    this._logChunkResult(params.fileType, docs);
    return docs;
  }

  private async _processLocalFile(params: {
    localFilePath: string;
    fileType: string;
    filePath: string;
  }): Promise<Document[]> {
    switch (params.fileType.toLowerCase()) {
      case "md":
        return this._createFromMarkdown({ filePath: params.filePath, localFilePath: params.localFilePath });
      case "docx":
        return this._createFromDocX({ filePath: params.filePath, localFilePath: params.localFilePath });
      case "pptx":
      case "presentation":
        return this._createFromPptx({ filePath: params.filePath, localFilePath: params.localFilePath });
      case "xlsx":
      case "spreadsheet":
        return this._createFromXlsx({ filePath: params.filePath, localFilePath: params.localFilePath });
      case "pdf":
        return this._createFromPdf({ filePath: params.filePath, localFilePath: params.localFilePath });
      default: {
        let loader: BaseDocumentLoader;
        switch (params.fileType.toLowerCase()) {
          case "json":
            loader = new JSONLoader(params.localFilePath, "/texts");
            break;
          case "jsonl":
            loader = new JSONLinesLoader(params.localFilePath, "/html");
            break;
          case "csv":
            loader = new CSVLoader(params.localFilePath, "text") as any;
            break;
          default:
            loader = new TextLoader(params.localFilePath);
            break;
        }
        const rawDocs = await loader.load();
        const textSplitter = new TokenTextSplitter({
          chunkSize: 1000,
          chunkOverlap: 200,
        });
        return textSplitter.splitDocuments(rawDocs);
      }
    }
  }

  private async _createFromEmail(params: {
    filePath: string;
    localFilePath: string;
    fileType: string;
  }): Promise<Document[]> {
    try {
      const buffer = await fs.readFile(params.localFilePath);

      const parsed =
        params.fileType === "eml"
          ? await this.emailParserService.parseEml(buffer)
          : await this.emailParserService.parseMsg(buffer);

      // Process attachments to extract their content
      const attachmentContents: { filename: string; content: string }[] = [];

      for (const att of parsed.attachments) {
        try {
          const content = await this._extractAttachmentContent(att);
          if (content) {
            attachmentContents.push({ filename: att.filename, content });
          }
        } catch (error) {
          this.logger.warn(`Failed to extract content from attachment ${att.filename}:`, error);
        }
      }

      const markdown = this.emailParserService.assembleMarkdown({
        ...parsed,
        attachmentContents,
      });

      if (markdown && markdown.trim()) {
        // Use MarkdownTextSplitter for emails instead of semantic splitter.
        // The semantic splitter can produce oversized chunks that exceed the embedding model's
        // 8192 token limit when email content lacks clear semantic shift points.
        const splitter = new MarkdownTextSplitter({
          chunkSize: this.targetChars,
          chunkOverlap: 200,
        });
        return await splitter.createDocuments([markdown]);
      }

      return [];
    } catch (error) {
      this.logger.error(`Email processing failed for ${params.fileType}:`, error);
      return [];
    }
  }

  private async _extractAttachmentContent(
    attachment: { filename: string; contentType: string; content: Buffer },
    depth: number = 0,
  ): Promise<string | null> {
    if (depth >= 3) {
      this.logger.warn(`Max email nesting depth reached for ${attachment.filename}`);
      return null;
    }

    const extension = attachment.filename.split(".").pop()?.toLowerCase() || "";

    // For nested emails, parse recursively
    if (extension === "eml" || extension === "msg") {
      const parsed =
        extension === "eml"
          ? await this.emailParserService.parseEml(attachment.content)
          : await this.emailParserService.parseMsg(attachment.content);

      const nestedAttContents: { filename: string; content: string }[] = [];
      for (const att of parsed.attachments) {
        const content = await this._extractAttachmentContent(att, depth + 1);
        if (content) nestedAttContents.push({ filename: att.filename, content });
      }

      return this.emailParserService.assembleMarkdown({ ...parsed, attachmentContents: nestedAttContents });
    }

    // For images, use the image chunker
    if (isImageFile(extension)) {
      const tempPath = `/tmp/temp-att.${randomUUID()}.${extension}`;
      await fs.writeFile(tempPath, attachment.content);
      try {
        const docs = await this._createChunksFromImage({ filePath: tempPath, fileType: extension });
        return docs.map((d) => d.pageContent).join("\n\n");
      } finally {
        await fs.unlink(tempPath).catch(() => {});
      }
    }

    // For other file types, write to temp and delegate to existing handlers
    const tempPath = `/tmp/temp-att.${randomUUID()}.${extension}`;
    await fs.writeFile(tempPath, attachment.content);
    try {
      const docs = await this._processLocalFile({ localFilePath: tempPath, fileType: extension, filePath: tempPath });
      return docs.map((d) => d.pageContent).join("\n\n");
    } finally {
      await fs.unlink(tempPath).catch(() => {});
    }
  }

  async generateContentStructureFromMarkdown(params: { content: string; title?: string }): Promise<Document[]> {
    try {
      const semanticChunks = await this.splitter.splitMarkdownToChunks({
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
      chunkSize: this.targetChars,
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
          chunkSize: this.targetChars,
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
      return await this.splitter.splitMarkdownToChunks({
        content: markdown,
        title: title,
      });
    } catch (error) {
      this.logger.error("Semantic markdown splitting failed, falling back to markdown splitter:", error);
      const splitter = new MarkdownTextSplitter({
        chunkSize: this.targetChars,
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
        return await this.splitter.splitMarkdownToChunks({
          content: markdownContent,
        });
      } catch (error) {
        this.logger.error("Semantic markdown splitting failed, falling back to markdown splitter:", error);
        const splitter = new MarkdownTextSplitter({
          chunkSize: this.targetChars,
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
          chunkSize: this.targetChars,
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
        return await this.splitter.splitMarkdownToChunks({
          content: markdownContent,
          title: undefined,
        });
      } catch (error) {
        this.logger.error("Presentation processing failed:", error);
        const splitter = new MarkdownTextSplitter({
          chunkSize: this.targetChars,
          chunkOverlap: 200,
        });
        return await splitter.createDocuments([markdownContent]);
      }
    }

    const response: Document[] = [];
    const documentParts = await this.pptxService.load({ filePath: params.localFilePath });

    for (const part of documentParts) {
      const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: this.targetChars,
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
        chunkSize: this.targetChars,
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
          return await this.splitter.splitMarkdownToChunks({
            content: markdownContent,
            title: undefined,
          });
        } catch (error) {
          this.logger.error("Presentation processing failed:", error);
          const splitter = new MarkdownTextSplitter({
            chunkSize: this.targetChars,
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
