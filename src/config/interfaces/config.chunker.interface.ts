export interface ConfigChunkerInterface {
  /** Markdown-splitting strategy. "markdown-structural" = header-structural (no embeddings);
   *  "semantic" = embedding cosine-shift splitter. */
  strategy: "markdown-structural" | "semantic";
  /** Tesseract OCR language for scanned-PDF extraction, e.g. "ita" | "eng". */
  ocrLanguage: string;
  /** Target chunk size in characters for the markdown/fallback splitters. */
  targetChars: number;
}
