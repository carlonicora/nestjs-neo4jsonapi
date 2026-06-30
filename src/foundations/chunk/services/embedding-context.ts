/**
 * Default Italian temporal labels (the a360 fork's strings).
 *
 * These are the defaults consumed by the chunk service's temporal-propagation
 * logic when an app does not configure `embeddingContext` templates. Apps that
 * extract dates (e.g. a360) keep the Italian wording; apps that do not extract
 * dates (neural-erp/phlow) never emit a temporal prefix at all, because their
 * GraphCreator yields no dates and the temporal branch is skipped entirely.
 */
export const DEFAULT_TEMPORAL_CONTEXT_LABEL = "Contesto temporale";
export const DEFAULT_TEMPORAL_REFERENCES_LABEL = "Riferimenti temporali";

export function buildEmbeddingContext(params: {
  typeLabel?: string;
  parentName?: string;
  heading?: string;
  dateContext?: string;
  content: string;
}): string {
  const lines: string[] = [];
  if (params.parentName?.trim()) lines.push(`[${params.typeLabel ?? "Documento"}: ${params.parentName.trim()}]`);
  if (params.heading?.trim()) lines.push(`[Sezione: ${params.heading.trim()}]`);
  if (params.dateContext?.trim()) lines.push(params.dateContext.trim());
  const prefix = lines.join("\n");
  return prefix ? `${prefix}\n\n${params.content}` : params.content;
}
