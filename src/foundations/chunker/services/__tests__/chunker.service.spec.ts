import { Document } from "@langchain/core/documents";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as fs from "fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChunkerService } from "../chunker.service";

// Only the temp-file write and read are stubbed — the downloaded bytes are never real
// (PdfService is a stub) and the real module stays available to everything else. The
// markdown path is the one that reads the temp file back, so it gets a fixed body.
vi.mock("fs/promises", async (importOriginal) => ({
  ...((await importOriginal()) as object),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue("# heading\n\nsome markdown body"),
}));

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const makeConfig = (strategy: string, targetChars = 1500) =>
  ({
    get: vi.fn(() => (strategy ? { strategy, ocrLanguage: "eng", targetChars } : undefined)),
  }) as any;

/** Config stub that answers both the `chunker` and the `ai` sections. */
const makeFullConfig = (opts: { mock?: boolean; strategy?: string } = {}) =>
  ({
    get: vi.fn((key: string) => {
      if (key === "ai") return { mock: opts.mock ?? false };
      if (key === "chunker")
        return { strategy: opts.strategy ?? "markdown-structural", ocrLanguage: "eng", targetChars: 1500 };
      return undefined;
    }),
  }) as any;

const md = { splitMarkdownToChunks: vi.fn() } as any;
const sem = { splitMarkdownToChunks: vi.fn() } as any;
// Stands in for every collaborator a test does not exercise. In the S3Service slot it answers
// `downloadFileBuffer`, so a storage-key source reads eight placeholder bytes.
const stub = {
  downloadFileBuffer: vi.fn(async () => ({ buffer: Buffer.alloc(8), contentType: "application/octet-stream" })),
} as any;

/** A CHUNKER_SOURCE_FETCHER binding that returns eight placeholder bytes for any URL. */
const bytesFetcher = () => ({
  fetch: vi.fn(async () => ({ buffer: Buffer.alloc(8), contentType: "application/octet-stream" })),
});

describe("ChunkerService splitter selection", () => {
  it("uses MarkdownChunkingService when strategy is markdown-structural", () => {
    const s = new ChunkerService(md, sem, stub, stub, stub, stub, stub, stub, stub, makeConfig("markdown-structural"));
    expect((s as any).splitter).toBe(md);
    expect((s as any).targetChars).toBe(1500);
  });
  it("uses SemanticSplitterService when strategy is semantic", () => {
    const s = new ChunkerService(md, sem, stub, stub, stub, stub, stub, stub, stub, makeConfig("semantic"));
    expect((s as any).splitter).toBe(sem);
  });
});

describe("ChunkerService page count", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("stamps totalPages = 1 on mock-mode documents", async () => {
    const splitter = { splitMarkdownToChunks: vi.fn() } as any;
    const service = new ChunkerService(
      splitter,
      splitter,
      stub,
      stub,
      stub,
      stub,
      stub,
      stub,
      stub,
      makeFullConfig({ mock: true }),
    );

    const docs = await service.generateContentStructureFromFile({
      fileType: "pdf",
      filePath: "bucket/file.pdf",
    });

    expect(docs).toHaveLength(1);
    expect(docs[0].metadata.totalPages).toBe(1);
  });

  it("stamps the real PDF page count on every chunk", async () => {
    const splitter = {
      splitMarkdownToChunks: vi
        .fn()
        .mockResolvedValue([
          new Document({ pageContent: "first chunk", metadata: {} }),
          new Document({ pageContent: "second chunk", metadata: {} }),
        ]),
    } as any;
    const pdfService = {
      extractPdfContent: vi.fn().mockResolvedValue({
        content: [{ type: "paragraph", content: "some extracted pdf text" }],
        totalPages: 7,
      }),
      getRawElements: vi.fn(),
    } as any;

    const service = new ChunkerService(
      splitter,
      splitter,
      stub,
      stub,
      pdfService,
      stub,
      stub,
      stub,
      stub,
      makeFullConfig(),
    );

    const docs = await service.generateContentStructureFromFile({
      fileType: "pdf",
      filePath: "bucket/file.pdf",
    });

    expect(docs).toHaveLength(2);
    expect(docs.every((doc) => doc.metadata.totalPages === 7)).toBe(true);
  });
});

/** Text whose 500-words-per-page estimate is exactly `pages` pages. */
const textOfEstimatedPages = (pages: number) => Array.from({ length: pages * 500 }, () => "parola").join(" ");

describe("ChunkerService page-count plausibility, OCR truncation and chunk cap", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  const twoChunkSplitter = () =>
    ({
      splitMarkdownToChunks: vi
        .fn()
        .mockResolvedValue([
          new Document({ pageContent: "first chunk", metadata: {} }),
          new Document({ pageContent: "second chunk", metadata: {} }),
        ]),
    }) as any;

  const warned = (warn: { mock: { calls: unknown[][] } }, needle: string) =>
    warn.mock.calls.some((call) => String(call[0]).includes(needle));

  it("prefers the word estimate when the PDF reports a single page for pages of text", async () => {
    const splitter = twoChunkSplitter();
    const pdfService = {
      // The exact shape of the run's 23 mismatches: a real multi-page PDF whose
      // reported count came back as 1.
      extractPdfContent: vi.fn().mockResolvedValue({
        content: [{ type: "paragraph", content: textOfEstimatedPages(48) }],
        totalPages: 1,
      }),
      getRawElements: vi.fn(),
    } as any;

    const service = new ChunkerService(
      splitter,
      splitter,
      stub,
      stub,
      pdfService,
      stub,
      stub,
      stub,
      stub,
      makeFullConfig(),
    );
    const warn = vi.spyOn((service as any).logger, "warn").mockImplementation(() => undefined);

    const docs = await service.generateContentStructureFromFile({
      fileType: "pdf",
      filePath: "bucket/file.pdf",
    });

    expect(docs.every((doc) => doc.metadata.totalPages === 48)).toBe(true);
    expect(warned(warn, "implausible")).toBe(true);
  });

  it("keeps the reported count when it is plausible", async () => {
    const splitter = twoChunkSplitter();
    const pdfService = {
      extractPdfContent: vi.fn().mockResolvedValue({
        content: [{ type: "paragraph", content: textOfEstimatedPages(48) }],
        totalPages: 50,
      }),
      getRawElements: vi.fn(),
    } as any;

    const service = new ChunkerService(
      splitter,
      splitter,
      stub,
      stub,
      pdfService,
      stub,
      stub,
      stub,
      stub,
      makeFullConfig(),
    );

    const docs = await service.generateContentStructureFromFile({
      fileType: "pdf",
      filePath: "bucket/file.pdf",
    });

    expect(docs.every((doc) => doc.metadata.totalPages === 50)).toBe(true);
    expect(docs.every((doc) => doc.metadata.ocrTruncated === undefined)).toBe(true);
  });

  it("flags ocrTruncated when OCR covered fewer pages than the document has", async () => {
    const splitter = twoChunkSplitter();
    const pdfService = {
      extractPdfContent: vi.fn().mockResolvedValue({
        content: [{ type: "paragraph", content: "scanned page text" }],
        totalPages: 50,
        pagesProcessed: 20,
      }),
      getRawElements: vi.fn(),
    } as any;

    const service = new ChunkerService(
      splitter,
      splitter,
      stub,
      stub,
      pdfService,
      stub,
      stub,
      stub,
      stub,
      makeFullConfig(),
    );
    const warn = vi.spyOn((service as any).logger, "warn").mockImplementation(() => undefined);

    const docs = await service.generateContentStructureFromFile({
      fileType: "pdf",
      filePath: "bucket/scan.pdf",
    });

    expect(docs.every((doc) => doc.metadata.totalPages === 50)).toBe(true);
    expect(docs.every((doc) => doc.metadata.ocrTruncated === true)).toBe(true);
    expect(warned(warn, "OCR")).toBe(true);
  });

  it("splits an oversized chunk produced by a type service down to the hard cap", async () => {
    // 60k chars ≈ 12 000 words → 24 estimated pages, well past MAX_CHUNK_CHARS.
    const oversized = "word ".repeat(12_000).trim();
    const splitter = {
      splitMarkdownToChunks: vi.fn().mockResolvedValue([new Document({ pageContent: oversized, metadata: {} })]),
    } as any;
    const docxService = {
      getRawElements: vi.fn().mockResolvedValue([{ type: "paragraphs", content: oversized }]),
      convertToMarkdown: vi.fn().mockReturnValue(oversized),
      load: vi.fn(),
    } as any;

    const service = new ChunkerService(
      splitter,
      splitter,
      docxService,
      stub,
      stub,
      stub,
      stub,
      stub,
      stub,
      makeFullConfig(),
    );
    const warn = vi.spyOn((service as any).logger, "warn").mockImplementation(() => undefined);

    const docs = await service.generateContentStructureFromFile({
      fileType: "docx",
      filePath: "bucket/file.docx",
    });

    expect(docs.length).toBeGreaterThanOrEqual(3);
    expect(docs.every((doc) => doc.pageContent.length <= 24_000)).toBe(true);
    // The cap must not lose the metadata the stamping put there.
    expect(docs.every((doc) => doc.metadata.totalPages === 24)).toBe(true);
    expect(warned(warn, "MAX_CHUNK_CHARS")).toBe(true);
  });
});

describe("ChunkerService image usage recording", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  const makeImageService = (recorder?: { recordTokenUsage: ReturnType<typeof vi.fn> }) => {
    const splitter = { splitMarkdownToChunks: vi.fn() } as any;
    const modelService = {
      getLLM: vi.fn().mockReturnValue({
        invoke: vi.fn().mockResolvedValue({
          content: "desc",
          usage_metadata: { input_tokens: 100, output_tokens: 50 },
        }),
      }),
    } as any;

    return new ChunkerService(
      splitter,
      splitter,
      stub,
      stub,
      stub,
      stub,
      modelService,
      stub,
      stub,
      makeFullConfig(),
      undefined,
      recorder as any,
    );
  };

  it("records image analysis usage when attribution is provided", async () => {
    const recorder = { recordTokenUsage: vi.fn().mockResolvedValue(undefined) };
    const service = makeImageService(recorder);

    await service.generateContentStructureFromFile({
      fileType: "png",
      filePath: "companies/c1/image.png",
      attribution: { relationshipId: "doc-1", relationshipType: "Document" },
    });

    expect(recorder.recordTokenUsage).toHaveBeenCalledWith({
      tokens: { input: 100, output: 50 },
      type: "image_analysis",
      relationshipId: "doc-1",
      relationshipType: "Document",
      useVisionCosts: true,
    });
  });

  it("records nothing when attribution is absent", async () => {
    const recorder = { recordTokenUsage: vi.fn().mockResolvedValue(undefined) };
    const service = makeImageService(recorder);

    const docs = await service.generateContentStructureFromFile({
      fileType: "png",
      filePath: "companies/c1/image.png",
    });

    expect(recorder.recordTokenUsage).not.toHaveBeenCalled();
    expect(docs.every((doc) => doc.metadata.totalPages === 1)).toBe(true);
  });
});

describe("ChunkerService markdown title", () => {
  const SIGNED_URL =
    "http://minio.test:9000/bucket/judgements/3f6b3794-c6d6-441c-940d-db84d41b0984/" +
    "3f6b3794-c6d6-441c-940d-db84d41b0984.md?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
    "&X-Amz-Credential=minioadmin%2F20260918%2Flocal%2Fs3%2Faws4_request" +
    "&X-Amz-Signature=0b0d887592e6620deadbeef";

  // The title is derived from a presigned URL here, so the source is read through a bound fetcher.
  const makeService = (splitter: any) =>
    new ChunkerService(
      splitter,
      splitter,
      stub,
      stub,
      stub,
      stub,
      stub,
      stub,
      stub,
      makeFullConfig(),
      undefined,
      undefined,
      undefined,
      bytesFetcher(),
    );

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("uses the caller's title rather than anything derived from the file path", async () => {
    const splitter = { splitMarkdownToChunks: vi.fn().mockResolvedValue([]) } as any;

    await makeService(splitter).generateContentStructureFromFile({
      fileType: "md",
      filePath: SIGNED_URL,
      title: "Garante, provv. n. 398/2026",
    });

    expect(splitter.splitMarkdownToChunks).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Garante, provv. n. 398/2026" }),
    );
  });

  // Regression: the title used to be `filePath.split("/").pop()` with a `.md` strip that
  // never matched, because a presigned URL ends in its query string. The signature and
  // credential were written into chunk 0, and from there into embeddings and prompts.
  it("never leaks the presigned query string into the title when no title is given", async () => {
    const splitter = { splitMarkdownToChunks: vi.fn().mockResolvedValue([]) } as any;

    await makeService(splitter).generateContentStructureFromFile({ fileType: "md", filePath: SIGNED_URL });

    const { title } = splitter.splitMarkdownToChunks.mock.calls[0][0];
    expect(title).toBe("3f6b3794-c6d6-441c-940d-db84d41b0984");
    expect(title).not.toContain("X-Amz-Signature");
    expect(title).not.toContain("X-Amz-Credential");
    expect(title).not.toContain("?");
  });
});

describe("ChunkerService source reading", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  const KEY = "companies/c1/d.txt";

  const makeS3 = () => ({
    downloadFileBuffer: vi.fn().mockResolvedValue({ buffer: Buffer.from("stored bytes"), contentType: "text/plain" }),
    generateSignedUrl: vi.fn().mockResolvedValue("http://signed.test/should-not-be-used"),
  });

  const makeService = (s3: ReturnType<typeof makeS3>, modelService: any = stub) => {
    const splitter = { splitMarkdownToChunks: vi.fn().mockResolvedValue([]) } as any;
    return new ChunkerService(
      splitter,
      splitter,
      stub,
      stub,
      stub,
      stub,
      modelService,
      s3 as any,
      stub,
      makeFullConfig(),
    );
  };

  it("reads a key through S3Service.downloadFileBuffer", async () => {
    const s3 = makeS3();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await makeService(s3).generateContentStructureFromFile({ fileType: "md", filePath: KEY });

    expect(s3.downloadFileBuffer).toHaveBeenCalledWith({ key: KEY });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(s3.generateSignedUrl).not.toHaveBeenCalled();
    // The bytes read from storage are what lands in the chunker's temp file.
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^${escapeRegExp(join(tmpdir(), "temp-file."))}`)),
      Buffer.from("stored bytes"),
    );
  });

  it("_createChunksFromImage reads a key without signing a URL", async () => {
    const s3 = makeS3();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const invoke = vi.fn().mockResolvedValue({ content: "an image description" });
    const modelService = { getLLM: vi.fn().mockReturnValue({ invoke }) } as any;

    const docs = await makeService(s3, modelService).generateContentStructureFromFile({
      fileType: "png",
      filePath: "companies/c1/scan.png",
    });

    expect(s3.downloadFileBuffer).toHaveBeenCalledWith({ key: "companies/c1/scan.png" });
    expect(s3.generateSignedUrl).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalled();
    expect(docs.map((d) => d.pageContent).join(" ")).toContain("an image description");
  });
});
