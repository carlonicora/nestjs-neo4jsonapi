import { vi, describe, it, expect, beforeEach, afterEach, MockedObject } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { Document } from "@langchain/core/documents";
import { ChunkerService } from "../chunker.service";
import { SemanticSplitterService } from "../types/semanticsplitter.service";
import { DocXService } from "../types/docx.service";
import { PptxService } from "../types/pptx.service";
import { PdfService } from "../types/pdf.service";
import { XlsxService } from "../types/xlsx.service";
import { EmailParserService } from "../types/email.service";
import { S3Service } from "../../../s3/services/s3.service";
import { ModelService } from "../../../../core/llm/services/model.service";

// Mock fs/promises
vi.mock("fs/promises", () => ({
  default: {
    writeFile: vi.fn(),
    readFile: vi.fn(),
  },
  writeFile: vi.fn(),
  readFile: vi.fn(),
}));

// Mock TokenTextSplitter to avoid tiktoken fetch issues
vi.mock("@langchain/textsplitters", async () => {
  const actual = await vi.importActual("@langchain/textsplitters");
  return {
    ...actual,
    TokenTextSplitter: class MockTokenTextSplitter {
      constructor() {}
      async splitDocuments(docs: any[]) {
        return docs.map((doc: any) => ({
          pageContent: doc.pageContent,
          metadata: doc.metadata || {},
        }));
      }
    },
  };
});

// Mock global fetch - needs json() for tiktoken encoding fetch
const createMockFetch = (options: { ok?: boolean; statusText?: string; content?: ArrayBuffer } = {}) => {
  return vi.fn().mockResolvedValue({
    ok: options.ok ?? true,
    statusText: options.statusText ?? "OK",
    arrayBuffer: () => Promise.resolve(options.content ?? new ArrayBuffer(0)),
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(""),
  });
};

global.fetch = createMockFetch();

describe("ChunkerService", () => {
  let service: ChunkerService;
  let semanticSplitterService: MockedObject<SemanticSplitterService>;
  let docxService: MockedObject<DocXService>;
  let pptxService: MockedObject<PptxService>;
  let pdfService: MockedObject<PdfService>;
  let xlsxService: MockedObject<XlsxService>;
  let s3Service: MockedObject<S3Service>;
  let modelService: MockedObject<ModelService>;

  const createMockSemanticSplitterService = () => ({
    splitMarkdownToChunks: vi.fn(),
  });

  const createMockDocXService = () => ({
    getRawElements: vi.fn(),
    convertToMarkdown: vi.fn(),
    load: vi.fn(),
  });

  const createMockPptxService = () => ({
    getRawElements: vi.fn(),
    convertToMarkdown: vi.fn(),
    load: vi.fn(),
  });

  const createMockPdfService = () => ({
    extractPdfContent: vi.fn(),
    getRawElements: vi.fn(),
  });

  const createMockXlsxService = () => ({
    extractXlsxContent: vi.fn(),
    convertToMarkdownChunks: vi.fn(),
    load: vi.fn(),
  });

  const createMockS3Service = () => ({
    generateSignedUrl: vi.fn(),
    uploadFile: vi.fn(),
  });

  const createMockModelService = () => {
    const mockLLM = {
      invoke: vi.fn(),
    };
    return {
      getLLM: vi.fn().mockReturnValue(mockLLM),
      getEmbeddings: vi.fn(),
    };
  };

  const createMockDocument = (content: string, metadata = {}): Document => ({
    pageContent: content,
    metadata,
    id: undefined,
  });

  beforeEach(async () => {
    vi.clearAllMocks();

    const mockSemanticSplitterService = createMockSemanticSplitterService();
    const mockDocxService = createMockDocXService();
    const mockPptxService = createMockPptxService();
    const mockPdfService = createMockPdfService();
    const mockXlsxService = createMockXlsxService();
    const mockS3Service = createMockS3Service();
    const mockModelService = createMockModelService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChunkerService,
        { provide: SemanticSplitterService, useValue: mockSemanticSplitterService },
        { provide: DocXService, useValue: mockDocxService },
        { provide: PptxService, useValue: mockPptxService },
        { provide: PdfService, useValue: mockPdfService },
        { provide: XlsxService, useValue: mockXlsxService },
        { provide: EmailParserService, useValue: { parseEml: vi.fn(), parseMsg: vi.fn() } },
        { provide: S3Service, useValue: mockS3Service },
        { provide: ModelService, useValue: mockModelService },
      ],
    }).compile();

    service = module.get<ChunkerService>(ChunkerService);
    semanticSplitterService = module.get(SemanticSplitterService) as MockedObject<SemanticSplitterService>;
    docxService = module.get(DocXService) as MockedObject<DocXService>;
    pptxService = module.get(PptxService) as MockedObject<PptxService>;
    pdfService = module.get(PdfService) as MockedObject<PdfService>;
    xlsxService = module.get(XlsxService) as MockedObject<XlsxService>;
    s3Service = module.get(S3Service) as MockedObject<S3Service>;
    modelService = module.get(ModelService) as MockedObject<ModelService>;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create the service", () => {
      expect(service).toBeDefined();
    });
  });

  describe("generateContentStructureFromMarkdown", () => {
    it("should use semantic splitter when available", async () => {
      // Arrange
      const content = "# Header\n\nSome markdown content here.";
      const expectedChunks = [createMockDocument("# Header\n\nSome markdown content here.")];
      semanticSplitterService.splitMarkdownToChunks.mockResolvedValue(expectedChunks);

      // Act
      const result = await service.generateContentStructureFromMarkdown({ content });

      // Assert
      expect(semanticSplitterService.splitMarkdownToChunks).toHaveBeenCalledWith({
        content,
        title: undefined,
      });
      expect(result).toEqual(expectedChunks);
    });

    it("should pass title to semantic splitter when provided", async () => {
      // Arrange
      const content = "# Header\n\nContent";
      const title = "My Document";
      const expectedChunks = [createMockDocument(content)];
      semanticSplitterService.splitMarkdownToChunks.mockResolvedValue(expectedChunks);

      // Act
      await service.generateContentStructureFromMarkdown({ content, title });

      // Assert
      expect(semanticSplitterService.splitMarkdownToChunks).toHaveBeenCalledWith({
        content,
        title,
      });
    });

    it("should fall back to markdown splitter when semantic splitter fails", async () => {
      // Arrange
      const content = "# Header\n\nSome markdown content.";
      semanticSplitterService.splitMarkdownToChunks.mockRejectedValue(new Error("Semantic splitting failed"));

      // Act
      const result = await service.generateContentStructureFromMarkdown({ content });

      // Assert
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].pageContent).toBeDefined();
    });

    it("should fall back to markdown splitter when semantic splitter returns empty", async () => {
      // Arrange
      const content = "# Header\n\nContent here.";
      semanticSplitterService.splitMarkdownToChunks.mockResolvedValue([]);

      // Act
      const result = await service.generateContentStructureFromMarkdown({ content });

      // Assert
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
    });

    it("should fall back to markdown splitter when semantic splitter returns null", async () => {
      // Arrange
      const content = "# Header\n\nContent here.";
      semanticSplitterService.splitMarkdownToChunks.mockResolvedValue(null as any);

      // Act
      const result = await service.generateContentStructureFromMarkdown({ content });

      // Assert
      expect(result).toBeDefined();
    });
  });

  describe("generateContentStructureFromFile", () => {
    beforeEach(() => {
      // Mock fetch for file download
      (global.fetch as any).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
      });
    });

    describe("markdown files", () => {
      it("should process markdown files with semantic splitter", async () => {
        // Arrange
        const fs = await import("fs/promises");
        (fs.readFile as any).mockResolvedValue("# Test\n\nContent");
        const expectedChunks = [createMockDocument("# Test\n\nContent")];
        semanticSplitterService.splitMarkdownToChunks.mockResolvedValue(expectedChunks);

        // Act
        const result = await service.generateContentStructureFromFile({
          fileType: "md",
          filePath: "https://example.com/test.md",
        });

        // Assert
        expect(semanticSplitterService.splitMarkdownToChunks).toHaveBeenCalled();
        expect(result).toEqual(expectedChunks);
      });
    });

    describe("docx files", () => {
      it("should process docx files with docx service", async () => {
        // Arrange
        const markdownContent = "# Document Title\n\nDocument content here.";
        const expectedChunks = [createMockDocument(markdownContent)];

        docxService.getRawElements.mockResolvedValue([{ type: "paragraph", content: "Test" }]);
        docxService.convertToMarkdown.mockReturnValue(markdownContent);
        semanticSplitterService.splitMarkdownToChunks.mockResolvedValue(expectedChunks);

        // Act
        const result = await service.generateContentStructureFromFile({
          fileType: "docx",
          filePath: "https://example.com/test.docx",
        });

        // Assert
        expect(docxService.getRawElements).toHaveBeenCalled();
        expect(docxService.convertToMarkdown).toHaveBeenCalled();
        expect(result).toEqual(expectedChunks);
      });

      it("should fall back to docx load when convertToMarkdown returns empty", async () => {
        // Arrange
        docxService.getRawElements.mockResolvedValue([]);
        docxService.convertToMarkdown.mockReturnValue("");
        docxService.load.mockResolvedValue([createMockDocument("Paragraph content", { type: "paragraphs" })]);

        // Act
        const result = await service.generateContentStructureFromFile({
          fileType: "docx",
          filePath: "https://example.com/test.docx",
        });

        // Assert
        expect(docxService.load).toHaveBeenCalled();
        expect(result.length).toBeGreaterThan(0);
      });
    });

    describe("pptx files", () => {
      it("should process pptx files with pptx service", async () => {
        // Arrange
        const markdownContent = "# Slide 1\n\nSlide content";
        const expectedChunks = [createMockDocument(markdownContent)];

        pptxService.getRawElements.mockResolvedValue([{ slideNumber: 1, content: "Slide 1" }]);
        pptxService.convertToMarkdown.mockReturnValue(markdownContent);
        semanticSplitterService.splitMarkdownToChunks.mockResolvedValue(expectedChunks);

        // Act
        const result = await service.generateContentStructureFromFile({
          fileType: "pptx",
          filePath: "https://example.com/test.pptx",
        });

        // Assert
        expect(pptxService.getRawElements).toHaveBeenCalled();
        expect(pptxService.convertToMarkdown).toHaveBeenCalled();
        expect(result).toEqual(expectedChunks);
      });

      it("should also handle presentation file type", async () => {
        // Arrange
        const markdownContent = "# Slide";
        pptxService.getRawElements.mockResolvedValue([]);
        pptxService.convertToMarkdown.mockReturnValue(markdownContent);
        semanticSplitterService.splitMarkdownToChunks.mockResolvedValue([createMockDocument(markdownContent)]);

        // Act
        const result = await service.generateContentStructureFromFile({
          fileType: "presentation",
          filePath: "https://example.com/test.pptx",
        });

        // Assert
        expect(pptxService.getRawElements).toHaveBeenCalled();
      });
    });

    describe("xlsx files", () => {
      it("should process xlsx files with xlsx service", async () => {
        // Arrange
        const worksheetData = [
          {
            name: "Sheet1",
            data: [
              ["A", "B"],
              ["1", "2"],
            ],
          },
        ];
        const markdownChunks = ["| A | B |\n|---|---|\n| 1 | 2 |"];

        xlsxService.extractXlsxContent.mockResolvedValue(worksheetData);
        xlsxService.convertToMarkdownChunks.mockReturnValue(markdownChunks);

        // Act
        const result = await service.generateContentStructureFromFile({
          fileType: "xlsx",
          filePath: "https://example.com/test.xlsx",
        });

        // Assert
        expect(xlsxService.extractXlsxContent).toHaveBeenCalled();
        expect(xlsxService.convertToMarkdownChunks).toHaveBeenCalledWith(worksheetData);
        expect(result.length).toBe(1);
        expect(result[0].metadata.type).toBe("xlsx");
      });

      it("should also handle spreadsheet file type", async () => {
        // Arrange
        xlsxService.extractXlsxContent.mockResolvedValue([]);
        xlsxService.load.mockResolvedValue([createMockDocument("Sheet data")]);

        // Act
        const result = await service.generateContentStructureFromFile({
          fileType: "spreadsheet",
          filePath: "https://example.com/test.xlsx",
        });

        // Assert
        expect(xlsxService.extractXlsxContent).toHaveBeenCalled();
      });
    });

    describe("pdf files", () => {
      it("should process pdf files with pdf service", async () => {
        // Arrange
        const pdfContent = [
          { type: "header", content: "Document Title" },
          { type: "paragraph", content: "Some content here." },
        ];
        const expectedChunks = [createMockDocument("# Document Title\n\nSome content here.")];

        pdfService.extractPdfContent.mockResolvedValue(pdfContent);
        semanticSplitterService.splitMarkdownToChunks.mockResolvedValue(expectedChunks);

        // Act
        const result = await service.generateContentStructureFromFile({
          fileType: "pdf",
          filePath: "https://example.com/test.pdf",
        });

        // Assert
        expect(pdfService.extractPdfContent).toHaveBeenCalled();
        expect(result).toEqual(expectedChunks);
      });

      it("should fall back to getRawElements when extractPdfContent returns empty", async () => {
        // Arrange
        pdfService.extractPdfContent.mockResolvedValue([]);
        pdfService.getRawElements.mockResolvedValue([{ type: "paragraph", content: "PDF text content" }]);

        // Act
        const result = await service.generateContentStructureFromFile({
          fileType: "pdf",
          filePath: "https://example.com/test.pdf",
        });

        // Assert
        expect(pdfService.getRawElements).toHaveBeenCalled();
      });

      it("should return empty array when pdf processing fails", async () => {
        // Arrange
        pdfService.extractPdfContent.mockRejectedValue(new Error("PDF parse error"));

        // Act
        const result = await service.generateContentStructureFromFile({
          fileType: "pdf",
          filePath: "https://example.com/test.pdf",
        });

        // Assert
        expect(result).toEqual([]);
      });
    });

    describe("other file types", () => {
      it("should process text files with TextLoader", async () => {
        // Arrange - mock file download with all required methods for tiktoken
        (global.fetch as any).mockResolvedValue({
          ok: true,
          arrayBuffer: () => Promise.resolve(new TextEncoder().encode("Plain text content").buffer),
          json: () => Promise.resolve({}),
          text: () => Promise.resolve("Plain text content"),
        });

        // Act
        const result = await service.generateContentStructureFromFile({
          fileType: "txt",
          filePath: "https://example.com/test.txt",
        });

        // Assert
        expect(result).toBeDefined();
      });
    });

    describe("file download", () => {
      it("should throw error when file download fails", async () => {
        // Arrange
        (global.fetch as any).mockResolvedValue({
          ok: false,
          statusText: "Not Found",
        });

        // Act & Assert
        await expect(
          service.generateContentStructureFromFile({
            fileType: "txt",
            filePath: "https://example.com/notfound.txt",
          }),
        ).rejects.toThrow("Failed to fetch the file: Not Found");
      });
    });

    describe("image files", () => {
      it("should process image files with LLM", async () => {
        // Arrange
        const mockLLM = modelService.getLLM({ temperature: 0.2 });
        (mockLLM.invoke as any).mockResolvedValue({
          content: "This image shows a diagram of a system architecture.",
        });

        // Act
        const result = await service.generateContentStructureFromFile({
          fileType: "png",
          filePath: "https://example.com/image.png",
        });

        // Assert
        expect(modelService.getLLM).toHaveBeenCalledWith({ temperature: 0.2 });
        expect(result.length).toBeGreaterThan(0);
      });

      it("should use S3 signed URL for non-http image paths", async () => {
        // Arrange
        s3Service.generateSignedUrl.mockResolvedValue("https://s3.example.com/signed-url");
        const mockLLM = modelService.getLLM({});
        (mockLLM.invoke as any).mockResolvedValue({
          content: "Image description",
        });

        // Act
        await service.generateContentStructureFromFile({
          fileType: "jpg",
          filePath: "s3://bucket/image.jpg",
        });

        // Assert
        expect(s3Service.generateSignedUrl).toHaveBeenCalledWith({ key: "s3://bucket/image.jpg" });
      });

      it("should return empty array when image processing fails", async () => {
        // Arrange
        const mockLLM = modelService.getLLM({});
        (mockLLM.invoke as any).mockRejectedValue(new Error("LLM error"));

        // Act
        const result = await service.generateContentStructureFromFile({
          fileType: "png",
          filePath: "https://example.com/image.png",
        });

        // Assert
        expect(result).toEqual([]);
      });

      it("should return empty array when LLM returns no content", async () => {
        // Arrange
        const mockLLM = modelService.getLLM({});
        (mockLLM.invoke as any).mockResolvedValue({ content: null });

        // Act
        const result = await service.generateContentStructureFromFile({
          fileType: "png",
          filePath: "https://example.com/image.png",
        });

        // Assert
        expect(result).toEqual([]);
      });
    });
  });
});
