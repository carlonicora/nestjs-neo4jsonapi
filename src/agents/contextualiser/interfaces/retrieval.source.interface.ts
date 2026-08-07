import { DataLimits } from "../../../common/types/data.limits";

/**
 * A single retrieved item contributed by an app-side retrieval source.
 * The package treats `content` and `metadata` as opaque: whatever the app puts
 * there is carried, unchanged, into the notebook and (later) into the responder
 * sources payload.
 */
export interface RetrievalSourceEntry {
  /** id of the retrieved item (chunk id or app-side id) */
  chunkId: string;
  /** text handed to the answer synthesiser (may carry an app-chosen prefix) */
  content: string;
  reason: string;
  /** app-defined provenance tag; package default is "case" */
  sourceLayer?: string;
  /** opaque app payload, carried through to ResponderResponseInterface.sources */
  metadata?: Record<string, unknown>;
}

/** Everything the contextualiser knows about the current turn when it fans out retrieval. */
export interface RetrievalSourceContext {
  question: string;
  rationalPlan: string;
  companyId: string;
  dataLimits: DataLimits;
}

/**
 * Contract for app-contributed retrieval sources.
 * Called in parallel with the package's own vector search; a rejected promise is
 * logged and treated as an empty contribution so one bad source cannot fail the turn.
 */
export interface RetrievalSourceContribution {
  search(ctx: RetrievalSourceContext): Promise<RetrievalSourceEntry[]>;
}

/** Multi-provider DI token: consuming apps contribute RetrievalSourceContribution instances. */
export const RETRIEVAL_SOURCES = Symbol("RETRIEVAL_SOURCES");

/** Multi-provider DI token: consuming apps contribute DynamicStructuredTool[] to the chunk node. */
export const CONTEXTUALISER_TOOLS = Symbol("CONTEXTUALISER_TOOLS");
