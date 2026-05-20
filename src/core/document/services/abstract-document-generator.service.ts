import { Injectable, Logger } from "@nestjs/common";
import { S3Service } from "../../../foundations/s3/services/s3.service";
import { DocxTemplateService, DocumentTemplate } from "./docx-template.service";
import { DocxToPdfService } from "../../pdf/services/docx-to-pdf.service";
import { injectDraftWatermark } from "../utils/inject-draft-watermark";

export type DocumentFormat = "docx" | "pdf";

export interface DocumentTarget {
  /** The output format to produce. */
  format: DocumentFormat;
  /** S3 key where the produced file should be stored. Caller supplies this; the library never decides key names. */
  s3Key: string;
}

export interface DocumentGenerationResult {
  format: DocumentFormat;
  s3Key: string;
  success: boolean;
  /** Populated only when `success` is false. */
  error?: Error;
}

const MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MIME_PDF = "application/pdf";

/**
 * Template-method base class for backend document generation.
 *
 * Subclasses supply all domain knowledge (how to load the entity, which
 * template to use, how to build the field context, where to persist URLs).
 * The algorithm — render → post-process → watermark → upload DOCX → convert
 * → upload PDF → persist — is fixed here and cannot be overridden.
 *
 * ### Error semantics
 *
 * | Failure point | Behaviour |
 * |---|---|
 * | `loadEntityWithRelations` / `loadTemplate` / DOCX render | Whole call throws. No persistence. |
 * | DOCX upload | Whole call throws. No persistence. |
 * | PDF conversion or PDF upload | DOCX result stays successful. PDF result added with `success: false`. `persistDocumentUrls` is still called. |
 *
 * ### Edge cases
 *
 * - Caller passes only `[{ format: "pdf", … }]`: DOCX is rendered as an
 *   in-memory intermediate but never uploaded.
 * - Caller passes only `[{ format: "docx", … }]`: PDF conversion is skipped.
 * - Caller passes both: both run; PDF failure leaves DOCX untouched.
 */
@Injectable()
export abstract class AbstractDocumentGeneratorService<T> {
  /** Human-readable entity type name used in log messages (e.g. `"invoice"`). */
  protected abstract readonly entityType: string;

  constructor(
    protected readonly docxTemplateService: DocxTemplateService,
    protected readonly docxToPdfService: DocxToPdfService,
    protected readonly s3Service: S3Service,
    protected readonly logger: Logger,
  ) {}

  // ---- domain hooks — must be implemented by subclass -------------------------

  /** Load the entity and all relationships needed to build the field context. */
  protected abstract loadEntityWithRelations(id: string): Promise<T>;

  /** Resolve the document template to render (DOCX or BlockNote). */
  protected abstract loadTemplate(entity: T): Promise<DocumentTemplate>;

  /**
   * Build the flat field-context object whose keys match template placeholders.
   * Must be a pure function of `entity` and `template` — no async work here.
   *
   * `template` is provided so subclasses can branch on `template.kind` to choose
   * between (a) plain markdown values for the BlockNote path (inlined directly
   * into the rendered document) and (b) sentinel strings for the DOCX-file path
   * that are subsequently replaced by `postProcessDocx` with raw WordprocessingML.
   */
  protected abstract buildFieldContext(entity: T, template: DocumentTemplate): Record<string, unknown>;

  /**
   * Persist the S3 keys that were successfully produced.
   * Called exactly once per `generate()` invocation, even when PDF conversion
   * failed (best-effort semantic for PDF).
   * Must return the updated entity.
   */
  protected abstract persistDocumentUrls(id: string, results: DocumentGenerationResult[]): Promise<T>;

  // ---- optional hooks — override if needed ------------------------------------

  /**
   * Post-process the rendered DOCX buffer before upload/conversion.
   * Typical use: inject a line-item table via `injectXml`.
   */
  protected postProcessDocx?(buffer: Buffer, entity: T): Promise<Buffer>;

  /**
   * Return `true` if a draft watermark should be applied to this entity.
   * Defaults to no watermark when not overridden.
   */
  protected shouldApplyWatermark?(entity: T): boolean;

  // ---- the workflow (final) ---------------------------------------------------

  /**
   * Generate document artifacts for the given entity and upload them to S3.
   *
   * @param id      - Entity ID.
   * @param targets - One or more `{ format, s3Key }` descriptors. At least one required.
   * @returns The entity after `persistDocumentUrls` has been called.
   */
  async generate(id: string, targets: DocumentTarget[]): Promise<T> {
    if (targets.length === 0) {
      throw new Error("AbstractDocumentGeneratorService.generate: at least one DocumentTarget required");
    }

    const docxTarget = targets.find((t) => t.format === "docx");
    const pdfTarget = targets.find((t) => t.format === "pdf");

    // --- step 1: load entity + template + field context ----------------------
    const entity = await this.loadEntityWithRelations(id);
    const template = await this.loadTemplate(entity);
    const fieldContext = this.buildFieldContext(entity, template);

    // --- step 2: render DOCX (always — even if only PDF is requested) --------
    let docx = await this.docxTemplateService.render(template, fieldContext);

    if (this.postProcessDocx) {
      docx = await this.postProcessDocx(docx, entity);
    }

    if (this.shouldApplyWatermark?.(entity)) {
      docx = await injectDraftWatermark(docx);
    }

    // --- step 3: upload DOCX (if requested) ----------------------------------
    const results: DocumentGenerationResult[] = [];

    if (docxTarget) {
      await this.s3Service.uploadToS3({
        key: docxTarget.s3Key,
        buffer: docx,
        contentType: MIME_DOCX,
      });
      results.push({ format: "docx", s3Key: docxTarget.s3Key, success: true });
    }

    // --- step 4: convert + upload PDF (if requested, best-effort) ------------
    if (pdfTarget) {
      try {
        const pdf = await this.docxToPdfService.convert(docx);
        await this.s3Service.uploadToS3({
          key: pdfTarget.s3Key,
          buffer: pdf,
          contentType: MIME_PDF,
        });
        results.push({ format: "pdf", s3Key: pdfTarget.s3Key, success: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `PDF conversion failed for ${this.entityType} ${id}: ${message}`,
          err instanceof Error ? err.stack : undefined,
        );
        results.push({
          format: "pdf",
          s3Key: pdfTarget.s3Key,
          success: false,
          error: err as Error,
        });
      }
    }

    // --- step 5: persist and return ------------------------------------------
    return this.persistDocumentUrls(id, results);
  }
}
