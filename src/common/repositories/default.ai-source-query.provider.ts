import { Injectable } from "@nestjs/common";
import { DataLimits } from "../types/data.limits";
import { SecurityService } from "../../core/security/services/security.service";
import { AiSourceQueryProvider, AiSourceQueryResult } from "./ai-source-query.provider";

/**
 * Default source-scoping: generic company-scoped retrieval with a global-content
 * (HowTo) bypass. Reproduces the package's pre-seam behavior exactly so existing
 * consumers (neural-erp/phlow) are unchanged. Apps override via the
 * `aiSourceQuery` bootstrap option (see CoreModule.forRoot).
 */
@Injectable()
export class DefaultAiSourceQueryProvider implements AiSourceQueryProvider {
  build(params: {
    dataLimits: DataLimits;
    currentUserId?: string;
    securityService?: SecurityService;
    returnsData?: boolean;
    returnsKeyConcepts?: boolean;
  }): AiSourceQueryResult {
    const withClause = params.returnsKeyConcepts ? "WITH keyconcept" : "WITH data";

    // SECURITY: HowTo retrieval intentionally bypasses company filtering —
    // `(data:HowTo)` nodes are global and have no BELONGS_TO Company edge.
    if (params.dataLimits.howToMode || params.dataLimits.limitToHowToId) {
      const where = params.dataLimits.limitToHowToId ? `\n      WHERE data.id = $limitToHowToId` : "";
      return {
        cypher: `MATCH (data:HowTo)${where}\n      ${withClause}`,
        params: params.dataLimits.limitToHowToId ? { limitToHowToId: params.dataLimits.limitToHowToId } : {},
      };
    }

    return { cypher: `MATCH (data)-[:BELONGS_TO]->(company)\n      ${withClause}`, params: {} };
  }
}
