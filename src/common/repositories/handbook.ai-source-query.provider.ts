import { Inject, Injectable, Optional } from "@nestjs/common";
import { Neo4jService } from "../../core/neo4j/services/neo4j.service";
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
 *
 * It also refuses an inner fragment that uses the request's `company` or
 * `currentUser` when the app's Neo4j config sets `bindRequestContext: false`:
 * initQuery does not bind them there, so `(company)` would match every company.
 */
@Injectable()
export class HandbookAiSourceQueryProvider implements AiSourceQueryProvider {
  constructor(
    @Inject(INNER_AI_SOURCE_QUERY) private readonly inner: AiSourceQueryProvider,
    @Optional() private readonly neo4j?: Neo4jService,
  ) {}

  build(params: {
    dataLimits: DataLimits;
    currentUserId?: string;
    securityService?: SecurityService;
    returnsData?: boolean;
    returnsKeyConcepts?: boolean;
  }): AiSourceQueryResult {
    const { handbookMode, limitToHandbookPageId } = params.dataLimits;

    if (!handbookMode && !limitToHandbookPageId) {
      const result = this.inner.build(params);
      if (this.neo4j?.bindsRequestContext === false && /\((company|currentUser)\)/.test(result.cypher))
        throw new Error(
          "AI source query uses the request's company or user, but this app's Neo4j config sets bindRequestContext: false.",
        );
      return result;
    }

    const withClause = params.returnsKeyConcepts ? "WITH keyconcept" : "WITH data";
    const where = limitToHandbookPageId ? `\n      WHERE data.id = $limitToHandbookPageId` : "";

    return {
      cypher: `MATCH (data:HandbookPage)${where}\n      ${withClause}`,
      params: limitToHandbookPageId ? { limitToHandbookPageId } : {},
    };
  }
}
