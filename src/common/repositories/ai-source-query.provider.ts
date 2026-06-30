import { DataLimits } from "../types/data.limits";
import { SecurityService } from "../../core/security/services/security.service";

export interface AiSourceQueryResult {
  /** Cypher binding+scoping `data` (or `keyconcept`), ending with `WITH data`/`WITH keyconcept`. */
  cypher: string;
  /** Parameters the fragment references — bound into queryParams, never interpolated. */
  params?: Record<string, unknown>;
}

export interface AiSourceQueryProvider {
  build(params: {
    dataLimits: DataLimits;
    currentUserId?: string;
    securityService?: SecurityService;
    returnsData?: boolean;
    returnsKeyConcepts?: boolean;
  }): AiSourceQueryResult;
}

export const AI_SOURCE_QUERY = Symbol("AI_SOURCE_QUERY");
