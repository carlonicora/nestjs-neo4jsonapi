import { Module } from "@nestjs/common";
import { BlockNoteService } from "./services/blocknote.service";
import { BlockNoteToDocxService } from "./services/blocknote-to-docx.service";

/**
 * BlockNote Module
 *
 * Provides BlockNote/ProseMirror to Markdown conversion utilities
 *
 * Features:
 * - Convert BlockNote JSON to Markdown
 * - Convert Markdown to BlockNote JSON
 * - Support for rich text formatting
 * - Support for lists and code blocks
 * - Convert BlockNote templates to DOCX buffers (Node-side)
 *
 * @example
 * ```typescript
 * @Module({
 *   imports: [BlockNoteModule],
 * })
 * export class AppModule {}
 * ```
 */
@Module({
  providers: [BlockNoteService, BlockNoteToDocxService],
  exports: [BlockNoteService, BlockNoteToDocxService],
})
export class BlockNoteModule {}
