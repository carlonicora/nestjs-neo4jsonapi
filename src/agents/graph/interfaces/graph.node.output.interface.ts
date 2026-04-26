import type { ToolCallRecord } from "../tools/tool.factory";

export interface GraphNodeOutput {
  /**
   * Prose reply written by the graph LLM about the data it loaded.
   * The downstream synthesizer treats this as authoritative graph content
   * and weaves it into the unified user-facing answer. May be the empty
   * string when the graph branch was skipped or failed.
   */
  answer: string;
  entities: Array<{
    type: string;
    id: string;
    reason: string;
    foundAtHop: number;
    /**
     * Field values the graph LLM read about this entity that the synthesizer
     * may need to quote (e.g. number, status, name, dates, totals). Optional —
     * empty/missing means the entity was matched only as context.
     */
    fields?: Record<string, unknown>;
  }>;
  toolCalls: ToolCallRecord[];
  tokens: { input: number; output: number };
  status: "success" | "partial" | "failed" | "skipped_no_modules";
  errorMessage?: string;
}
