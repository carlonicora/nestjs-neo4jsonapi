import { Module } from "@nestjs/common";
import { DocxToPdfService } from "./services/docx-to-pdf.service";

/**
 * PdfModule
 *
 * Provides DOCX → PDF conversion via LibreOffice headless.
 *
 * Import this module wherever `DocxToPdfService` is needed. For the full
 * document-generation workflow (template rendering + DOCX post-processing +
 * S3 upload + PDF conversion), import `DocumentModule` instead — it re-exports
 * `PdfModule` transitively.
 *
 * @example
 * ```typescript
 * @Module({
 *   imports: [PdfModule],
 * })
 * export class MyFeatureModule {}
 * ```
 */
@Module({
  providers: [DocxToPdfService],
  exports: [DocxToPdfService],
})
export class PdfModule {}
