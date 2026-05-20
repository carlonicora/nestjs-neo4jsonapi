import { Logger, Module } from "@nestjs/common";
import { BlockNoteModule } from "../blocknote/blocknote.module";
import { PdfModule } from "../pdf/pdf.module";
import { DocxTemplateService } from "./services/docx-template.service";

/**
 * DocumentModule
 *
 * Provides everything a `AbstractDocumentGeneratorService` subclass needs:
 * - `DocxTemplateService` (DOCX rendering via docx-templates or BlockNote)
 * - `PdfModule` → `DocxToPdfService` (DOCX → PDF via LibreOffice)
 * - `BlockNoteModule` → `BlockNoteToDocxService` (BlockNote → DOCX)
 * - `Logger` (consumed by `AbstractDocumentGeneratorService`)
 *
 * Feature modules that extend `AbstractDocumentGeneratorService` should import
 * this module. They must also provide the concrete subclass and inject `Logger`
 * into its constructor.
 *
 * @example
 * ```typescript
 * @Module({
 *   imports: [DocumentModule, S3Module],
 *   providers: [InvoiceDocumentGeneratorService, Logger],
 * })
 * export class InvoiceModule {}
 * ```
 */
@Module({
  imports: [PdfModule, BlockNoteModule],
  providers: [DocxTemplateService, Logger],
  exports: [DocxTemplateService, PdfModule, BlockNoteModule, Logger],
})
export class DocumentModule {}
