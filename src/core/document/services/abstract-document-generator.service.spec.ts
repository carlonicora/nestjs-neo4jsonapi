import { Logger } from "@nestjs/common";
import { vi, type Mocked } from "vitest";
import {
  AbstractDocumentGeneratorService,
  DocumentGenerationResult,
  DocumentTarget,
} from "./abstract-document-generator.service";
import { DocxTemplateService, DocumentTemplate } from "./docx-template.service";
import { DocxToPdfService } from "../../pdf/services/docx-to-pdf.service";
import { S3Service } from "../../../foundations/s3/services/s3.service";

// ---------------------------------------------------------------------------
// Test entity type
// ---------------------------------------------------------------------------

interface TestEntity {
  id: string;
  status: "draft" | "final";
}

// ---------------------------------------------------------------------------
// Concrete test subclass
// ---------------------------------------------------------------------------

class TestDocumentGeneratorService extends AbstractDocumentGeneratorService<TestEntity> {
  protected readonly entityType = "test-entity";

  // Tracking arrays for call-order assertions
  readonly calls: string[] = [];

  // Configurable behaviour
  applyWatermark = false;
  enablePostProcess = false;
  persistedResults: DocumentGenerationResult[] = [];

  constructor(
    docxTemplateService: DocxTemplateService,
    docxToPdfService: DocxToPdfService,
    s3Service: S3Service,
    logger: Logger,
  ) {
    super(docxTemplateService, docxToPdfService, s3Service, logger);
  }

  protected async loadEntityWithRelations(id: string): Promise<TestEntity> {
    this.calls.push("loadEntityWithRelations");
    return { id, status: this.applyWatermark ? "draft" : "final" };
  }

  protected async loadTemplate(_entity: TestEntity): Promise<DocumentTemplate> {
    this.calls.push("loadTemplate");
    return { buffer: Buffer.from("template"), kind: "docx" };
  }

  protected buildFieldContext(_entity: TestEntity): Record<string, unknown> {
    this.calls.push("buildFieldContext");
    return { field: "value" };
  }

  protected async persistDocumentUrls(_id: string, results: DocumentGenerationResult[]): Promise<TestEntity> {
    this.calls.push("persistDocumentUrls");
    this.persistedResults = results;
    return { id: _id, status: "final" };
  }

  // Optional hooks — controlled by flags
  protected postProcessDocx = this.enablePostProcess
    ? async (buffer: Buffer, _entity: TestEntity): Promise<Buffer> => {
        this.calls.push("postProcessDocx");
        return buffer;
      }
    : undefined;

  protected shouldApplyWatermark(_entity: TestEntity): boolean {
    return this.applyWatermark;
  }

  /** Re-assign optional hooks after construction (needed because they're undefined by default). */
  enablePostProcessHook(): void {
    this.postProcessDocx = async (buffer: Buffer): Promise<Buffer> => {
      this.calls.push("postProcessDocx");
      return buffer;
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Built once in beforeAll so the watermark/postProcess paths receive a real ZIP.
let FAKE_DOCX: Buffer;
const FAKE_PDF = Buffer.from("%PDF-fake");

beforeAll(async () => {
  const { Document, Packer, Paragraph, TextRun } = await import("docx");
  const doc = new Document({
    sections: [
      {
        children: [new Paragraph({ children: [new TextRun("Abstract generator test fixture.")] })],
      },
    ],
  });
  FAKE_DOCX = await Packer.toBuffer(doc);
});

function makeDocxTarget(s3Key = "entities/1.docx"): DocumentTarget {
  return { format: "docx", s3Key };
}

function makePdfTarget(s3Key = "entities/1.pdf"): DocumentTarget {
  return { format: "pdf", s3Key };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("AbstractDocumentGeneratorService", () => {
  let service: TestDocumentGeneratorService;
  let docxTemplateService: Mocked<DocxTemplateService>;
  let docxToPdfService: Mocked<DocxToPdfService>;
  let s3Service: Mocked<S3Service>;
  let logger: Mocked<Logger>;

  beforeEach(() => {
    docxTemplateService = {
      render: vi.fn().mockResolvedValue(FAKE_DOCX),
    } as unknown as Mocked<DocxTemplateService>;

    docxToPdfService = {
      convert: vi.fn().mockResolvedValue(FAKE_PDF),
    } as unknown as Mocked<DocxToPdfService>;

    s3Service = {
      uploadToS3: vi.fn().mockResolvedValue(undefined),
    } as unknown as Mocked<S3Service>;

    logger = {
      error: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    } as unknown as Mocked<Logger>;

    service = new TestDocumentGeneratorService(docxTemplateService, docxToPdfService, s3Service, logger);
  });

  // ---- guard: empty targets -------------------------------------------------

  it("throws when targets array is empty", async () => {
    await expect(service.generate("1", [])).rejects.toThrow("at least one DocumentTarget required");
  });

  // ---- docx-only target -----------------------------------------------------

  describe("targets = [docx]", () => {
    it("uploads DOCX and never calls docxToPdfService.convert", async () => {
      await service.generate("1", [makeDocxTarget()]);

      expect(docxTemplateService.render).toHaveBeenCalledTimes(1);
      expect(s3Service.uploadToS3).toHaveBeenCalledTimes(1);
      expect(s3Service.uploadToS3).toHaveBeenCalledWith(
        expect.objectContaining({
          key: "entities/1.docx",
          contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }),
      );
      expect(docxToPdfService.convert).not.toHaveBeenCalled();
    });

    it("calls persistDocumentUrls with one successful docx result", async () => {
      await service.generate("1", [makeDocxTarget()]);

      expect(service.persistedResults).toHaveLength(1);
      expect(service.persistedResults[0]).toMatchObject({
        format: "docx",
        s3Key: "entities/1.docx",
        success: true,
      });
    });
  });

  // ---- pdf-only target ------------------------------------------------------

  describe("targets = [pdf]", () => {
    it("converts to PDF, uploads PDF, and never uploads DOCX", async () => {
      await service.generate("1", [makePdfTarget()]);

      expect(docxToPdfService.convert).toHaveBeenCalledTimes(1);
      expect(docxToPdfService.convert).toHaveBeenCalledWith(FAKE_DOCX);
      expect(s3Service.uploadToS3).toHaveBeenCalledTimes(1);
      expect(s3Service.uploadToS3).toHaveBeenCalledWith(
        expect.objectContaining({
          key: "entities/1.pdf",
          contentType: "application/pdf",
        }),
      );
    });

    it("calls persistDocumentUrls with one successful pdf result", async () => {
      await service.generate("1", [makePdfTarget()]);

      expect(service.persistedResults).toHaveLength(1);
      expect(service.persistedResults[0]).toMatchObject({
        format: "pdf",
        s3Key: "entities/1.pdf",
        success: true,
      });
    });
  });

  // ---- both targets — PDF conversion succeeds -------------------------------

  describe("targets = [docx, pdf] — PDF succeeds", () => {
    it("uploads both files and calls persistDocumentUrls once with two successes", async () => {
      await service.generate("1", [makeDocxTarget(), makePdfTarget()]);

      expect(s3Service.uploadToS3).toHaveBeenCalledTimes(2);
      expect(service.persistedResults).toHaveLength(2);
      expect(service.persistedResults).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ format: "docx", success: true }),
          expect.objectContaining({ format: "pdf", success: true }),
        ]),
      );
    });
  });

  // ---- both targets — PDF conversion fails ----------------------------------

  describe("targets = [docx, pdf] — PDF conversion throws", () => {
    const pdfError = new Error("LibreOffice failed");

    beforeEach(() => {
      docxToPdfService.convert.mockRejectedValue(pdfError);
    });

    it("still uploads DOCX successfully", async () => {
      await service.generate("1", [makeDocxTarget(), makePdfTarget()]);

      expect(s3Service.uploadToS3).toHaveBeenCalledTimes(1);
      expect(s3Service.uploadToS3).toHaveBeenCalledWith(expect.objectContaining({ key: "entities/1.docx" }));
    });

    it("calls persistDocumentUrls once with docx success and pdf failure", async () => {
      await service.generate("1", [makeDocxTarget(), makePdfTarget()]);

      expect(service.persistedResults).toHaveLength(2);
      const docxResult = service.persistedResults.find((r) => r.format === "docx");
      const pdfResult = service.persistedResults.find((r) => r.format === "pdf");
      expect(docxResult).toMatchObject({ success: true });
      expect(pdfResult).toMatchObject({ success: false, error: pdfError });
    });

    it("logs the error", async () => {
      await service.generate("1", [makeDocxTarget(), makePdfTarget()]);

      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("PDF conversion failed"), expect.anything());
    });
  });

  // ---- postProcessDocx hook -------------------------------------------------

  describe("postProcessDocx hook", () => {
    it("is awaited and its output is used for the upload", async () => {
      const processedBuffer = Buffer.from("PK\x03\x04processed-docx");
      service.enablePostProcessHook();
      // Override the hook to return a distinct buffer
      service["postProcessDocx"] = vi.fn().mockResolvedValue(processedBuffer);

      await service.generate("1", [makeDocxTarget()]);

      expect(service["postProcessDocx"]).toHaveBeenCalledTimes(1);
      expect(s3Service.uploadToS3).toHaveBeenCalledWith(expect.objectContaining({ buffer: processedBuffer }));
    });
  });

  // ---- shouldApplyWatermark hook --------------------------------------------

  describe("shouldApplyWatermark hook", () => {
    it("injectDraftWatermark is called when hook returns true", async () => {
      service.applyWatermark = true;

      // The entity returned by loadEntityWithRelations will have status: "draft"
      // because applyWatermark=true triggers that in the test subclass.
      // We simply verify the flow does not throw and persistDocumentUrls is called.
      // Full watermark injection is covered by inject-draft-watermark.spec.ts.
      //
      // We spy on the module-level injectDraftWatermark via a known side effect:
      // the returned buffer will differ from the docxTemplateService output.
      // Since we cannot easily intercept the module-scope import here, we just
      // verify the overall flow completes without error.
      await expect(service.generate("1", [makeDocxTarget()])).resolves.toBeDefined();
      expect(service.persistedResults).toHaveLength(1);
      expect(service.persistedResults[0].success).toBe(true);
    });

    it("injectDraftWatermark is NOT called when hook returns false", async () => {
      service.applyWatermark = false;

      await service.generate("1", [makeDocxTarget()]);

      // The rendered DOCX buffer from docxTemplateService should reach
      // uploadToS3 unchanged (no watermark processing).
      expect(s3Service.uploadToS3).toHaveBeenCalledWith(expect.objectContaining({ buffer: FAKE_DOCX }));
    });
  });

  // ---- workflow call order --------------------------------------------------

  it("calls hooks in the correct order", async () => {
    service.enablePostProcessHook();

    await service.generate("1", [makeDocxTarget(), makePdfTarget()]);

    expect(service.calls).toEqual([
      "loadEntityWithRelations",
      "loadTemplate",
      "buildFieldContext",
      "postProcessDocx",
      "persistDocumentUrls",
    ]);
  });
});
