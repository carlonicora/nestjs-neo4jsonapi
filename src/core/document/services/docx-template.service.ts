import { Injectable } from "@nestjs/common";
import createReport from "docx-templates";
import { BlockNoteToDocxService } from "../../blocknote/services/blocknote-to-docx.service";

/**
 * Describes a template that can be rendered into a DOCX buffer.
 *
 * - `kind: "docx"` — a Word `.docx` file processed by `docx-templates`
 *   (field placeholders use `[[fieldName]]` syntax with cmdDelimiter `["[[", "]]"]`)
 * - `kind: "blocknote"` — a BlockNote / Markdown template processed by
 *   `BlockNoteToDocxService`
 */
export interface DocumentTemplate {
  buffer: Buffer;
  kind: "docx" | "blocknote";
}

/**
 * Single entry-point for rendering a document template against a field context.
 *
 * Routes by `template.kind`:
 * - `"docx"` → `docx-templates` `createReport`
 * - `"blocknote"` → `BlockNoteToDocxService.render`
 *
 * Returns a DOCX `Buffer` either way. Callers (e.g. `AbstractDocumentGeneratorService`)
 * do not need to know which rendering path was taken.
 */
@Injectable()
export class DocxTemplateService {
  constructor(private readonly blockNoteToDocxService: BlockNoteToDocxService) {}

  /**
   * Render `template` against `fieldContext` and return a DOCX Buffer.
   *
   * @param template     - The template descriptor (buffer + kind).
   * @param fieldContext - Key/value pairs whose keys match template placeholders.
   * @returns A DOCX Buffer.
   */
  async render(template: DocumentTemplate, fieldContext: Record<string, unknown>): Promise<Buffer> {
    if (template.kind === "docx") {
      const result = await createReport({
        template: template.buffer,
        data: fieldContext,
        cmdDelimiter: ["[[", "]]"],
        failFast: false,
      });
      return Buffer.from(result);
    }

    return this.blockNoteToDocxService.render(template.buffer, fieldContext);
  }
}
