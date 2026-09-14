import { Inject, Injectable } from "@nestjs/common";
import { SecurityService } from "../../core/security/services/security.service";
import { DataLimits } from "../types/data.limits";
import { AiSourceQueryProvider, AiSourceQueryResult } from "./ai-source-query.provider";

/** Token the app-configured (or default) provider is bound to, behind this decorator. */
export const INNER_AI_SOURCE_QUERY = Symbol("INNER_AI_SOURCE_QUERY");

/**
 * Handbook scoping, applied in FRONT of whatever AI_SOURCE_QUERY an application
 * configured.
 *
 * WHY A DECORATOR AND NOT A BRANCH IN EACH PROVIDER
 * -------------------------------------------------
 * `aiSourceQuery` is an app-overridable bootstrap option (core.module.ts), and
 * apps do override it. A handbook branch written into a provider would
 * therefore be present in exactly the applications that remembered to write it,
 * and absent — silently, with developer documentation leaking into tenant
 * retrieval — everywhere else. Wrapping makes the isolation a property of the
 * framework rather than of each app's diligence.
 *
 * Handbook content is GLOBAL: HandbookPage nodes have no BELONGS_TO Company
 * edge, so the fragment carries no company filter, exactly as the HowTo branch
 * of DefaultAiSourceQueryProvider does.
 */
@Injectable()
export class HandbookAiSourceQueryProvider implements AiSourceQueryProvider {
  constructor(@Inject(INNER_AI_SOURCE_QUERY) private readonly inner: AiSourceQueryProvider) {}

  build(params: {
    dataLimits: DataLimits;
    currentUserId?: string;
    securityService?: SecurityService;
    returnsData?: boolean;
    returnsKeyConcepts?: boolean;
  }): AiSourceQueryResult {
    const { handbookMode, limitToHandbookPageId } = params.dataLimits;

    if (!handbookMode && !limitToHandbookPageId) return this.inner.build(params);

    const withClause = params.returnsKeyConcepts ? "WITH keyconcept" : "WITH data";
    const where = limitToHandbookPageId ? `\n      WHERE data.id = $limitToHandbookPageId` : "";

    return {
      cypher: `MATCH (data:HandbookPage)${where}\n      ${withClause}`,
      params: limitToHandbookPageId ? { limitToHandbookPageId } : {},
    };
  }
}
