import { CSVLoader } from "@langchain/community/document_loaders/fs/csv";
import { BaseDocumentLoader } from "@langchain/core/document_loaders/base";
import { Document } from "@langchain/core/documents";
import { HumanMessage } from "@langchain/core/messages";
import { MarkdownTextSplitter, RecursiveCharacterTextSplitter, TokenTextSplitter } from "@langchain/textsplitters";
import { BadRequestException, Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "crypto";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { TOKEN_USAGE_RECORDER, TokenUsageRecorderInterface } from "../../../common/tokens";
import { isWellFormedS3Key } from "../../../common/interfaces/s3.key-access.policy.interface";
import { BaseConfigInterface } from "../../../config/interfaces/base.config.interface";
import { ConfigApiInterface } from "../../../config/interfaces/config.api.interface";
import { ConfigAiInterface } from "../../../config/interfaces/config.ai.interface";
import { ConfigChunkerInterface } from "../../../config/interfaces/config.chunker.interface";
import { ModelService } from "../../../core/llm/services/model.service";
import { S3_OBJECTS_SEGMENT, s3Meta } from "../../s3/entities/s3.meta";
import { S3CipherService } from "../../s3/services/s3-cipher.service";
import { S3Service } from "../../s3/services/s3.service";
import { TokenUsageType } from "../../tokenusage/enums/tokenusage.type";
import { TokenUsageService } from "../../tokenusage/services/tokenusage.service";
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

/**
 * Opt-in cost attribution for the LLM calls the chunker makes while reading a
 * file (today: image analysis). Without both `relationshipId` and
 * `relationshipType` no usage record is written — the package stays
 * domain-agnostic and the caller decides what the usage is billed against.
 * Mirrors `EmbedderAttribution`.
 */
export interface ChunkerAttribution {
  relationshipId: string;
  relationshipType: string;
}

/**
 * Fetches an http(s) source for the chunker. The chunker NEVER fetches an arbitrary URL on its
 * own: a caller-supplied URL reaching a server-side `fetch` is an SSRF (cloud metadata, internal
 * hosts, the response reflected into chunks and summaries). An application that genuinely needs
 * the chunker to read remote URLs binds an implementation under `CHUNKER_SOURCE_FETCHER` that
 * vets the destination itself (public addresses only, the resolved address pinned, every redirect
 * re-vetted, a byte cap). Without a binding every http(s) source other than this API's own signed
 * object link is refused.
 */
export interface ChunkerSourceFetcher {
  fetch(params: { url: string }): Promise<{ buffer: Buffer; contentType?: string }>;
}

export const CHUNKER_SOURCE_FETCHER = Symbol("CHUNKER_SOURCE_FETCHER");

/** Words per page used to estimate page counts for formats that have no real pagination. */
const WORDS_PER_ESTIMATED_PAGE = 500;

/**
 * Hard ceiling on the size of a chunk leaving the chunker. A splitter that fails
 * to find a boundary can emit a chunk far past its target, which then blows the
 * embedding model's context window at the far end of the pipeline. Anything
 * longer is split (with a WARN) rather than passed on.
 */
const MAX_CHUNK_CHARS = 24_000;

/**
 * A PDF that reports one page but holds more than this many estimated pages of
 * text is not believed: the reported count is treated as broken metadata and the
 * estimate is used instead. Three pages of slack keeps genuinely short documents
 * (a one-page letter whose estimate rounds to 2) on their real count.
 */
const IMPLAUSIBLE_SINGLE_PAGE_ESTIMATE = 3;

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
    // Both usage dependencies are @Optional() so consumers that never mount the
    // tokenusage module (and apps that bind no TOKEN_USAGE_RECORDER) keep
    // booting and simply record nothing.
    @Optional() private readonly tokenUsageService?: TokenUsageService,
    @Optional() @Inject(TOKEN_USAGE_RECORDER) private readonly tokenUsageRecorder?: TokenUsageRecorderInterface,
    // Verifies this API's own signed object links (`<api>/s3/objects/<token>`), so a consumer that
    // passes a signed link instead of the key is read straight from storage, with no HTTP request.
    @Optional() private readonly s3Cipher?: S3CipherService,
    // Opt-in remote reads; see ChunkerSourceFetcher. Absent = remote URLs are refused.
    @Optional() @Inject(CHUNKER_SOURCE_FETCHER) private readonly sourceFetcher?: ChunkerSourceFetcher,
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

  /**
   * Reads the bytes behind a `filePath`. A storage key is the normal source and is read through
   * `S3Service` (which decrypts flagged objects), with no URL signed and no HTTP round trip.
   * An http(s) URL goes through `_readUrl`, which never makes a bare request. A local absolute
   * path is refused: no caller passes one, and reading any path a caller names is a file-disclosure
   * primitive.
   */
  private async _readSource(params: { filePath: string }): Promise<Buffer> {
    if (/^https?:\/\//i.test(params.filePath)) {
      return (await this._readUrl({ url: params.filePath })).buffer;
    }

    if (path.isAbsolute(params.filePath) || path.win32.isAbsolute(params.filePath) || /^file:/i.test(params.filePath)) {
      throw new BadRequestException("The chunker does not read local file paths; pass a storage key");
    }

    if (!isWellFormedS3Key(params.filePath)) {
      throw new BadRequestException("Invalid storage key");
    }

    return (await this.s3Service.downloadFileBuffer({ key: params.filePath })).buffer;
  }

  /**
   * An http(s) source:
   * - this API's own signed object link (`<api.url>s3/objects/<token>`, what
   *   `S3Service.generateSignedUrl` returns) is verified and read from storage by its key, with no
   *   HTTP request: consumers that sign a key before chunking keep working;
   * - any other URL goes to the application's `CHUNKER_SOURCE_FETCHER`, which owns the SSRF vetting;
   * - with no fetcher bound, it is refused.
   */
  private async _readUrl(params: { url: string }): Promise<{ buffer: Buffer; contentType?: string }> {
    const ownKey = this._ownObjectKey(params.url);
    if (ownKey) return this.s3Service.downloadFileBuffer({ key: ownKey });

    if (!this.sourceFetcher) {
      throw new BadRequestException(
        "The chunker does not fetch remote URLs; pass a storage key, or bind CHUNKER_SOURCE_FETCHER",
      );
    }

    return this.sourceFetcher.fetch({ url: params.url });
  }

  /** The storage key behind this API's own signed `get` link, or undefined for any other URL. */
  private _ownObjectKey(url: string): string | undefined {
    const apiUrl = this.config.get<ConfigApiInterface>("api")?.url;
    if (!apiUrl || !this.s3Cipher) return undefined;

    let candidate: URL;
    let prefix: URL;
    try {
      candidate = new URL(url);
      prefix = new URL(`${apiUrl}${s3Meta.endpoint}/${S3_OBJECTS_SEGMENT}/`);
    } catch {
      return undefined;
    }
    if (candidate.origin !== prefix.origin || !candidate.pathname.startsWith(prefix.pathname)) return undefined;

    const token = candidate.pathname.slice(prefix.pathname.length);
    if (!token || token.includes("/")) return undefined;

    try {
      const payload = this.s3Cipher.verifyObjectToken(decodeURIComponent(token), "get");
      return isWellFormedS3Key(payload.k) ? payload.k : undefined;
    } catch {
      // Not a token this server signed (or expired): treat it as a foreign URL.
      return undefined;
    }
  }

  /** A fresh path under the OS temp directory for a decrypted working copy. Callers unlink it in a `finally`. */
  private _tempPath(prefix: string, extension: string): string {
    const safeExtension = extension.replace(/[^a-z0-9]/gi, "").slice(0, 16) || "bin";
    return path.join(os.tmpdir(), `${prefix}.${randomUUID()}.${safeExtension}`);
  }

  private async _downloadFile(params: { filePath: string; extension: string }): Promise<string> {
    const buffer = await this._readSource({ filePath: params.filePath });
    const tempFilePath = this._tempPath("temp-file", params.extension);
    await fs.writeFile(tempFilePath, buffer);
    return tempFilePath;
  }

  /**
   * Page count for formats that carry no pagination of their own (everything
   * except PDFs and images). Deliberately coarse — it exists so per-page costs
   * (OCR, document AI) can be attributed to a document of any format.
   */
  private _estimatePageCountFromText(text: string): number {
    const words = text.split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.round(words / WORDS_PER_ESTIMATED_PAGE));
  }

  private _estimatePageCount(docs: Document[]): number {
    return this._estimatePageCountFromText(docs.map((doc) => doc.pageContent ?? "").join(" "));
  }

  /**
   * Stamps the document's page count on every chunk it produced. The count
   * travels on metadata because the return type of the public entry point is
   * `Document[]` and must stay that way for existing callers. `extra` carries the
   * optional read-quality flags (today: `ocrTruncated`) alongside it.
   */
  private _stampTotalPages(docs: Document[], totalPages: number, extra?: Record<string, unknown>): Document[] {
    for (const doc of docs) {
      doc.metadata = { ...doc.metadata, ...extra, totalPages };
    }
    return docs;
  }

  /**
   * Enforces `MAX_CHUNK_CHARS` on the chunks about to leave the chunker.
   *
   * Splitters are best-effort: given text with no separator near the target size
   * they emit a single huge chunk, which only fails much later (embedding call,
   * LLM context). Splitting here is the last point where the oversize is still
   * cheap to fix. `splitDocuments` carries the metadata onto the pieces, so the
   * page count stamped upstream survives; the slice is a guarantee for text with
   * no boundary to split on at all.
   */
  private async _capChunkChars(docs: Document[]): Promise<Document[]> {
    if (!docs.some((doc) => (doc.pageContent?.length ?? 0) > MAX_CHUNK_CHARS)) return docs;

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: MAX_CHUNK_CHARS,
      chunkOverlap: 0,
    });

    const capped: Document[] = [];
    for (const doc of docs) {
      const length = doc.pageContent?.length ?? 0;
      if (length <= MAX_CHUNK_CHARS) {
        capped.push(doc);
        continue;
      }

      const partsBefore = capped.length;
      const pieces = await splitter.splitDocuments([doc]);
      for (const piece of pieces) {
        if (piece.pageContent.length <= MAX_CHUNK_CHARS) {
          capped.push(piece);
          continue;
        }
        for (let offset = 0; offset < piece.pageContent.length; offset += MAX_CHUNK_CHARS) {
          capped.push(
            new Document({
              pageContent: piece.pageContent.slice(offset, offset + MAX_CHUNK_CHARS),
              metadata: { ...piece.metadata },
            }),
          );
        }
      }

      this.logger.warn(
        `Chunk of ${length} chars exceeds MAX_CHUNK_CHARS=${MAX_CHUNK_CHARS} — ` +
          `split into ${capped.length - partsBefore} parts`,
      );
    }

    return capped;
  }

  async generateContentStructureFromFile(params: {
    fileType: string;
    /**
     * Storage key. An http(s) URL is read only when it is this API's own signed object link or the
     * application binds `CHUNKER_SOURCE_FETCHER`; a local path is refused.
     */
    filePath: string;
    attribution?: ChunkerAttribution;
    /**
     * Human-readable name of the document, used as the markdown title. Pass it whenever
     * the caller knows it: a legacy `filePath` can be a PRESIGNED URL, and deriving a title
     * from it put the signature and credential into the chunk text (and into every prompt
     * and embedding built from it). Falls back to the file name when omitted.
     */
    title?: string;
  }): Promise<Document[]> {
    if (this.config.get<ConfigAiInterface>("ai").mock) {
      return [
        new Document({
          pageContent: "mock chunk content for smoke testing",
          metadata: { source: params.filePath, mock: true, totalPages: 1 },
        }),
      ];
    }

    if (isImageFile(params.fileType)) {
      const imageDocs = await this._createChunksFromImage({
        filePath: params.filePath,
        fileType: params.fileType,
        attribution: params.attribution,
      });
      return this._capChunkChars(this._stampTotalPages(imageDocs, 1));
    }

    const localFilePath = await this._downloadFile({
      filePath: params.filePath,
      extension: params.fileType,
    });

    // The working copy is the decrypted file: it is removed on every path, success or failure.
    try {
      // Email files need special handling (attachment extraction)
      if (params.fileType.toLowerCase() === "eml" || params.fileType.toLowerCase() === "msg") {
        const emailDocs = await this._createFromEmail({
          filePath: params.filePath,
          localFilePath,
          fileType: params.fileType.toLowerCase(),
          attribution: params.attribution,
        });
        return await this._capChunkChars(emailDocs);
      }

      const docs = await this._capChunkChars(
        await this._processLocalFile({
          localFilePath,
          fileType: params.fileType,
          filePath: params.filePath,
          title: params.title,
        }),
      );
      this._logChunkResult(params.fileType, docs);
      return docs;
    } finally {
      await fs.unlink(localFilePath).catch(() => {});
    }
  }

  private async _processLocalFile(params: {
    localFilePath: string;
    fileType: string;
    filePath: string;
    title?: string;
  }): Promise<Document[]> {
    const docs = await this._loadLocalFileDocuments(params);
    // PDFs already carry their real page count (stamped by `_createFromPdf`);
    // every other format has none to read, so it is estimated from the text.
    const stamped = docs.find((doc) => typeof doc.metadata?.totalPages === "number");
    const totalPages = stamped ? (stamped.metadata.totalPages as number) : this._estimatePageCount(docs);
    return this._stampTotalPages(docs, totalPages);
  }

  private async _loadLocalFileDocuments(params: {
    localFilePath: string;
    fileType: string;
    filePath: string;
    title?: string;
  }): Promise<Document[]> {
    switch (params.fileType.toLowerCase()) {
      case "md":
        return this._createFromMarkdown({
          filePath: params.filePath,
          localFilePath: params.localFilePath,
          title: params.title,
        });
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
    attribution?: ChunkerAttribution;
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
          const content = await this._extractAttachmentContent(att, 0, params.attribution);
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
        const emailDocs = await splitter.createDocuments([markdown]);
        // Emails have no pagination: estimate from the assembled markdown itself
        // (chunk overlap would otherwise inflate a count taken from the chunks).
        return this._stampTotalPages(emailDocs, this._estimatePageCountFromText(markdown));
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
    attribution?: ChunkerAttribution,
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
        const content = await this._extractAttachmentContent(att, depth + 1, attribution);
        if (content) nestedAttContents.push({ filename: att.filename, content });
      }

      return this.emailParserService.assembleMarkdown({ ...parsed, attachmentContents: nestedAttContents });
    }

    // For images, use the image chunker on the attachment bytes (no working copy needed)
    if (isImageFile(extension)) {
      const docs = await this._createChunksFromImage({
        buffer: attachment.content,
        filePath: attachment.filename,
        fileType: extension,
        attribution,
      });
      return docs.map((d) => d.pageContent).join("\n\n");
    }

    // For other file types, write to temp and delegate to existing handlers
    const tempPath = this._tempPath("temp-att", extension);
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

  /**
   * Reads a URL through the same gate as `generateContentStructureFromFile`: this API's own signed
   * object link, or the application's `CHUNKER_SOURCE_FETCHER`. Any other URL is refused.
   */
  async extractContentFromUrl(params: { url: string }): Promise<string> {
    if (!/^https?:\/\//i.test(params.url)) throw new BadRequestException("Not an http(s) URL");

    const { buffer, contentType: fetchedContentType } = await this._readUrl({ url: params.url });
    const contentType = fetchedContentType || "";

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

    // For complex file types, process through the file pipeline (it re-reads the URL through the
    // same gate and removes its own working copy)
    const documents = await this.generateContentStructureFromFile({ fileType, filePath: params.url });
    return documents.map((doc) => doc.pageContent).join("\n\n");
  }

  /**
   * Image analysis is a vision LLM call made inside the package, so — exactly
   * like `EmbedderService.persistUsage` — its usage is written through the
   * optional `TOKEN_USAGE_RECORDER` seam, attribution is opt-in, and a failure
   * to record never fails the chunking itself.
   */
  private async _persistImageUsage(params: {
    tokens: { input: number; output: number };
    attribution?: ChunkerAttribution;
  }): Promise<void> {
    if (!params.attribution?.relationshipId || !params.attribution?.relationshipType) return;
    const recorder = this.tokenUsageRecorder ?? this.tokenUsageService;
    if (!recorder) return;
    try {
      await recorder.recordTokenUsage({
        tokens: params.tokens,
        type: TokenUsageType.ImageAnalysis,
        relationshipId: params.attribution.relationshipId,
        relationshipType: params.attribution.relationshipType,
        useVisionCosts: true,
      });
    } catch (err) {
      this.logger.warn(`Image analysis usage persistence failed — continuing: ${String(err)}`);
    }
  }

  private async _createChunksFromImage(params: {
    /** The image bytes when the caller already holds them (an email attachment); otherwise `filePath` is read. */
    buffer?: Buffer;
    filePath: string;
    fileType: string;
    attribution?: ChunkerAttribution;
  }): Promise<Document[]> {
    try {
      const imageBuffer = params.buffer ?? (await this._readSource({ filePath: params.filePath }));

      /*
       * NO USAGE IS RECORDED FOR THIS CALL, DELIBERATELY.
       *
       * It takes the raw model from `ModelService` and calls `invoke` on it
       * directly, bypassing `LLMService` — the only place LLM spend is metered.
       * It is also handed nothing to attribute the spend to: file chunking
       * receives a path and a file type, no entity id or label, so a usage row
       * written here would carry no `USED_FOR` edge and bill nobody.
       *
       * UNREACHABLE FROM narr8, which never ingests files through the chunker,
       * so no narr8 spend goes unrecorded. It IS live for library consumers that
       * do ingest files; metering it needs an attribution parameter threaded
       * through the chunker's public entry points, which is out of scope here.
       */
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

      const usage = (imageDescription as { usage_metadata?: { input_tokens?: number; output_tokens?: number } })
        ?.usage_metadata;
      await this._persistImageUsage({
        tokens: { input: usage?.input_tokens ?? 0, output: usage?.output_tokens ?? 0 },
        attribution: params.attribution,
      });

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

  private async _createFromMarkdown(params: {
    filePath: string;
    localFilePath: string;
    title?: string;
  }): Promise<Document[]> {
    const markdown = await fs.readFile(params.localFilePath, "utf-8");

    // The caller's own name for the document wins. Otherwise fall back to the file
    // name — with the query string dropped FIRST, because `filePath` is routinely a
    // presigned URL: `…/<id>.md?X-Amz-Credential=…&X-Amz-Signature=…` never matched
    // the `.md` strip, so the whole signed URL became the title and was written into
    // the chunk text, the embeddings and every prompt built from them.
    const title = params.title?.trim() || fileNameOf(params.filePath).replace(/\.md$/i, "");

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

  /**
   * A PDF's own page count is authoritative — except when it clearly is not.
   * Broken or unreadable document metadata surfaces as "1 page", and a 50-page
   * PDF billed as one page under-reports per-page cost by a factor of 50, so a
   * reported single page carrying pages of text is replaced by the estimate.
   */
  private _resolvePdfPageCount(params: { reported: number; estimated: number; source: string }): number {
    if (params.reported <= 1 && params.estimated > IMPLAUSIBLE_SINGLE_PAGE_ESTIMATE) {
      this.logger.warn(
        `PDF reported ${params.reported} page(s) but holds ~${params.estimated} pages of text — ` +
          `reported count is implausible, using the estimate (${params.source})`,
      );
      return params.estimated;
    }
    return params.reported;
  }

  private async _createFromPdf(params: { filePath: string; localFilePath: string }): Promise<Document[]> {
    try {
      const {
        content: pdfContent,
        totalPages: reportedPages,
        pagesProcessed,
      } = await this.pdfService.extractPdfContent(params.localFilePath);

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

      const totalPages = this._resolvePdfPageCount({
        reported: reportedPages,
        estimated: this._estimatePageCountFromText(markdownContent),
        source: params.filePath,
      });

      // Only the OCR route reports `pagesProcessed`; reading fewer pages than the
      // document has means the extracted text — and every cost derived from it —
      // covers only part of the document.
      const ocrTruncated = typeof pagesProcessed === "number" && pagesProcessed < totalPages;
      if (ocrTruncated) {
        this.logger.warn(
          `OCR read ${pagesProcessed} of ${totalPages} pages for ${params.filePath} — ` +
            `chunks are flagged ocrTruncated`,
        );
      }
      const readQuality = ocrTruncated ? { ocrTruncated: true } : undefined;

      if (markdownContent && markdownContent.trim()) {
        try {
          const chunks = await this.splitter.splitMarkdownToChunks({
            content: markdownContent,
            title: undefined,
          });
          return this._stampTotalPages(chunks, totalPages, readQuality);
        } catch (error) {
          this.logger.error("Presentation processing failed:", error);
          const splitter = new MarkdownTextSplitter({
            chunkSize: this.targetChars,
            chunkOverlap: 200,
          });
          const chunks = await splitter.createDocuments([markdownContent]);
          return this._stampTotalPages(chunks, totalPages, readQuality);
        }
      }

      const rawElements = await this.pdfService.getRawElements(params.localFilePath);

      return rawElements.map(
        (element) =>
          new Document({
            pageContent: element.content,
            metadata: {
              type: element.type,
              ...readQuality,
              totalPages,
            },
          }),
      );
    } catch (error) {
      this.logger.error("PDF processing failed:", error);
      return [];
    }
  }
}

/**
 * The file name of a path or URL, with any query string or fragment removed.
 *
 * `filePath` reaching the chunker is frequently a presigned URL whose last segment is
 * `<name>.<ext>?X-Amz-Algorithm=…&X-Amz-Credential=…&X-Amz-Signature=…`. Splitting on
 * "/" alone therefore yields a "file name" carrying the credential and signature, and
 * no extension strip matches it because the string no longer ends in the extension.
 */
export function fileNameOf(filePath: string): string {
  const withoutQuery = filePath.split(/[?#]/)[0];
  const segments = withoutQuery.split("/");
  return segments[segments.length - 1];
}
