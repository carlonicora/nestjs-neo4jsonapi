import type { Document } from "@langchain/core/documents";

/**
 * Drops chunk `Document`s whose `pageContent` is empty or whitespace-only.
 *
 * Every "chunk on create" flow in `apps/api` (Memo, Document, File,
 * LegalResearchDocument, Article, Hyperlink, HowTo, Email) follows the same
 * two-step shape: `ChunkerService.generateContentStructureFrom{Markdown,File}()`
 * (packages/nestjs-neo4jsonapi) turns raw content into `Document[]`, then
 * `ChunkService.createChunks()` (same package) persists one `:Chunk` node per
 * document AND embeds its `pageContent` unconditionally via
 * `EmbedderService.vectoriseText()` — which has no empty-string guard.
 * Azure's embeddings endpoint rejects an empty input with a 400
 * ("input cannot be an empty string"), and since nothing in that package
 * chain catches it, it escapes as an unhandled 500 to whatever request is
 * still awaiting the create/update call (confirmed for Memo: creating a memo
 * with no body 500s because `MemoService.create()` awaits the whole chunking
 * pipeline before the controller sends its response).
 *
 * The single correct fix is a guard inside `EmbedderService.vectoriseText()`/
 * `vectoriseTextBatch()` (packages/nestjs-neo4jsonapi) — that would protect
 * every embed call site in the app, not just chunk creation. Until that
 * lands, every `apps/api` caller that chunks user-submitted content MUST
 * filter the chunker's output through this helper before calling
 * `ChunkService.createChunks()`, so an empty/blank body is treated as
 * "nothing to process" instead of reaching the embedder at all.
 */
export function dropEmptyChunkDocuments(documents: Document[]): Document[] {
  return documents.filter((document) => document.pageContent.trim().length > 0);
}
