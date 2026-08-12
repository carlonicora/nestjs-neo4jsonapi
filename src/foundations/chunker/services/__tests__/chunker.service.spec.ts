import { Document } from "@langchain/core/documents";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChunkerService } from "../chunker.service";

// Only the temp-file write is stubbed — the downloaded bytes are never read back
// (PdfService is a stub) and the real module stays available to everything else.
vi.mock("fs/promises", async (importOriginal) => ({
  ...((await importOriginal()) as object),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

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

const stubFetchWithBytes = () =>
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      statusText: "OK",
      arrayBuffer: async () => new ArrayBuffer(8),
    }),
  );

const md = { splitMarkdownToChunks: vi.fn() } as any;
const sem = { splitMarkdownToChunks: vi.fn() } as any;
const stub = {} as any;

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

    const docs = await service.generateContentStructureFromFile({ fileType: "pdf", filePath: "s3://bucket/file.pdf" });

    expect(docs).toHaveLength(1);
    expect(docs[0].metadata.totalPages).toBe(1);
  });

  it("stamps the real PDF page count on every chunk", async () => {
    stubFetchWithBytes();
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

    const docs = await service.generateContentStructureFromFile({ fileType: "pdf", filePath: "s3://bucket/file.pdf" });

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
    stubFetchWithBytes();
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

    const docs = await service.generateContentStructureFromFile({ fileType: "pdf", filePath: "s3://bucket/file.pdf" });

    expect(docs.every((doc) => doc.metadata.totalPages === 48)).toBe(true);
    expect(warned(warn, "implausible")).toBe(true);
  });

  it("keeps the reported count when it is plausible", async () => {
    stubFetchWithBytes();
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

    const docs = await service.generateContentStructureFromFile({ fileType: "pdf", filePath: "s3://bucket/file.pdf" });

    expect(docs.every((doc) => doc.metadata.totalPages === 50)).toBe(true);
    expect(docs.every((doc) => doc.metadata.ocrTruncated === undefined)).toBe(true);
  });

  it("flags ocrTruncated when OCR covered fewer pages than the document has", async () => {
    stubFetchWithBytes();
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

    const docs = await service.generateContentStructureFromFile({ fileType: "pdf", filePath: "s3://bucket/scan.pdf" });

    expect(docs.every((doc) => doc.metadata.totalPages === 50)).toBe(true);
    expect(docs.every((doc) => doc.metadata.ocrTruncated === true)).toBe(true);
    expect(warned(warn, "OCR")).toBe(true);
  });

  it("splits an oversized chunk produced by a type service down to the hard cap", async () => {
    stubFetchWithBytes();
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
      filePath: "s3://bucket/file.docx",
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
    stubFetchWithBytes();
    const recorder = { recordTokenUsage: vi.fn().mockResolvedValue(undefined) };
    const service = makeImageService(recorder);

    await service.generateContentStructureFromFile({
      fileType: "png",
      filePath: "http://example.com/image.png",
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
    stubFetchWithBytes();
    const recorder = { recordTokenUsage: vi.fn().mockResolvedValue(undefined) };
    const service = makeImageService(recorder);

    const docs = await service.generateContentStructureFromFile({
      fileType: "png",
      filePath: "http://example.com/image.png",
    });

    expect(recorder.recordTokenUsage).not.toHaveBeenCalled();
    expect(docs.every((doc) => doc.metadata.totalPages === 1)).toBe(true);
  });
});
