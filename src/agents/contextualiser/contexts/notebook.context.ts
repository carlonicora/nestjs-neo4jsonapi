import { Annotation } from "@langchain/langgraph";

export const NotebookContext = Annotation.Root({
  chunkId: Annotation<string>,
  content: Annotation<string>,
  reason: Annotation<string>,
  sourceLayer: Annotation<string>,
  metadata: Annotation<Record<string, unknown>>,
  /**
   * Relevance of this entry to the question, 0–1. Drives notebook fill order and
   * what the budget drops first. Absent on app-contributed entries, which are
   * not scored — those sort last but are never dropped before a scored entry of
   * lower relevance.
   */
  score: Annotation<number | undefined>,
  /**
   * The entry's own chunk text, without the ±1 neighbour widening baked into
   * `content`. Present only on case entries built by the two chunk node
   * services; absent (undefined) on app contributions, which are never widened
   * and are kept or dropped whole.
   */
  coreContent: Annotation<string | undefined>,
});
