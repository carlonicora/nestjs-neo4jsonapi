import { Logger } from "@nestjs/common";
import { modelRegistry } from "../../common/registries/registry";
import { DataLimits } from "../../common/types/data.limits";
import { EmbedderAttribution } from "../../core/llm/services/embedder.service";
import { assistantMeta } from "../../foundations/assistant/entities/assistant.meta";
import { howToMeta } from "../../foundations/how-to/entities/how-to.meta";
import { TokenUsageType } from "../../foundations/tokenusage/enums/tokenusage.type";

const logger = new Logger("UsageAttribution");

/**
 * Cost attribution for one assistant LLM call, in the exact shape
 * `LLMService.call` / `LLMService.callStep` accept.
 *
 * The agents carry their run scope as a JSON:API TYPE (`"campaigns"`), but a
 * TokenUsage record's `USED_FOR` edge is matched on the Neo4j LABEL
 * (`"Campaign"`). Passing the type through verbatim writes a record whose edge
 * matches nothing — it looks attributed and silently bills against no entity.
 * The registry is the only mapping that stays correct as entities are added, so
 * every assistant call site goes through this one translation.
 */
export interface ScopeAttribution {
  tokenUsageType: string;
  relationshipId?: string;
  relationshipType?: string;
}

/**
 * JSON:API type ("campaigns") to Neo4j label ("Campaign"); undefined when the
 * type is absent or unregistered.
 *
 * A MISS IS LOUD. An unresolvable type would otherwise leave `relationshipType`
 * undefined while `relationshipId` is set, and `persistUsage` skips silently on
 * exactly that shape — the "looks attributed, records nothing" failure this
 * helper exists to prevent. The caller also falls back to the thread, so a miss
 * degrades to a coarser attribution rather than to no billing at all.
 */
export function resolveScopeLabel(scopeType?: string): string | undefined {
  if (!scopeType) return undefined;
  const labelName = modelRegistry.resolveModel(scopeType)?.labelName;
  if (!labelName) {
    logger.warn(
      `scopeType "${scopeType}" resolves to no registered model — cannot translate it to a Neo4j label. ` +
        `Falling back to thread-level attribution for this call.`,
    );
  }
  return labelName;
}

/**
 * Builds the attribution triple for one assistant call. Spread into the LLM call
 * params so no site can apply half of it.
 *
 * Precedence:
 *  1. the run's SCOPE ROOT (a campaign) — the most useful unit of spend, used
 *     whenever the turn has one AND its label is known. `scopeLabel` is the
 *     label the caller already resolved (the catalog carries `rootLabel`
 *     alongside `rootType`); the registry lookup is the fallback for callers
 *     that only have the JSON:API type.
 *  2. the ASSISTANT THREAD itself — every turn has one, whatever the thread is
 *     bound to, so an unscoped turn still bills instead of running free.
 *  3. nothing — only when the caller supplied neither, in which case
 *     `persistUsage` skips the record.
 */
export function buildScopeAttribution(params: {
  tokenUsageType: string;
  scopeId?: string;
  scopeType?: string;
  /** Neo4j label of the scope root, when the caller already knows it. */
  scopeLabel?: string;
  /** Id of the `Assistant` (thread) node this turn belongs to. */
  assistantId?: string;
}): ScopeAttribution {
  const scopeLabel = params.scopeId ? (params.scopeLabel ?? resolveScopeLabel(params.scopeType)) : undefined;
  if (params.scopeId && scopeLabel) {
    return { tokenUsageType: params.tokenUsageType, relationshipId: params.scopeId, relationshipType: scopeLabel };
  }

  if (params.assistantId) {
    return {
      tokenUsageType: params.tokenUsageType,
      relationshipId: params.assistantId,
      relationshipType: assistantMeta.labelName,
    };
  }

  return { tokenUsageType: params.tokenUsageType };
}

/**
 * The caller's cost attribution, carried through a SUB-AGENT's graph state.
 *
 * The contextualiser and DRIFT are never invoked on their own behalf: another
 * agent calls them, and that agent's ledger entry is the one the spend belongs
 * to. So they own no `TokenUsageType` value of their own and name no entity of
 * their own — they carry the caller's, verbatim, and apply it at every LLM call
 * they make.
 *
 * EVERY FIELD IS OPTIONAL. A direct library consumer that supplies none still
 * runs; its calls simply record nothing (`persistUsage` skips a record with no
 * relationship), exactly like every other unattributed path in the package.
 */
export interface CallerAttributionState {
  /**
   * Ledger category of the CALLING agent (e.g. `TokenUsageType.Responder`).
   * Absent = the library default (`text_generation`); a sub-agent never
   * substitutes an identity of its own here.
   */
  tokenUsageType?: string;
  /** Id of the caller's scope-root node. Absent = the caller ran unscoped. */
  scopeId?: string;
  /** JSON:API type of that scope root, e.g. "campaigns". */
  scopeType?: string;
  /** Neo4j label of that scope root, e.g. "Campaign". */
  scopeLabel?: string;
  /** Id of the caller's `Assistant` (thread) node — the unscoped fallback. */
  assistantId?: string;
}

/**
 * Packs a CALLING agent's own attribution into the shape its sub-agents accept.
 *
 * `source` is whatever the caller already holds — its graph state, or the
 * per-turn tool context — both of which carry the scope triple and the thread
 * id under these exact names. `tokenUsageType` is always the caller's own; a
 * sub-agent must never appear in the ledger under a category of its own.
 */
export function buildCallerAttribution(params: {
  tokenUsageType: string;
  source?: { scopeId?: string; scopeType?: string; scopeLabel?: string; assistantId?: string };
}): CallerAttributionState {
  return {
    tokenUsageType: params.tokenUsageType,
    scopeId: params.source?.scopeId,
    scopeType: params.source?.scopeType,
    scopeLabel: params.source?.scopeLabel,
    assistantId: params.source?.assistantId,
  };
}

/**
 * What a caller actually handed a sub-agent, so the sub-agent can log
 * PROPORTIONATELY. These are three different situations and only one of them is
 * a fault:
 *
 *  - `"billable"` — an entity the usage record can point at. Nothing to say.
 *  - `"none"` — the caller named NO entity at all. This is LEGITIMATE and
 *    permanent for some callers: an MCP tool call has no scope root and no
 *    assistant thread (`McpUserContext` carries only userId/companyId/
 *    userModuleIds), and a direct library consumer need not attribute anything.
 *    Nothing is recorded, nothing is wrong, and warning here would mean a
 *    warning on EVERY MCP `search_documents` call forever.
 *  - `"unresolvable"` — the caller DID name something, but it cannot become a
 *    `USED_FOR` edge (a `scopeType` no model claims, a `scopeId` with no label,
 *    a `scopeLabel` with no id). That IS a fault: it looks attributed and bills
 *    nothing, which is the exact failure this whole helper exists to prevent.
 *
 * `tokenUsageType` deliberately does NOT count as "named something": every
 * caller supplies a category unconditionally (`buildCallerAttribution` always
 * sets it), so counting it would collapse `"none"` into `"unresolvable"` and
 * bring the spam straight back.
 *
 * The registry is only consulted once something was named, so the `"none"` path
 * costs nothing and cannot emit `resolveScopeLabel`'s own warning.
 */
export function classifyCallerAttribution(state?: CallerAttributionState): "billable" | "none" | "unresolvable" {
  const namedSomething = !!(state?.scopeId || state?.scopeType || state?.scopeLabel || state?.assistantId);
  if (!namedSomething) return "none";
  return buildInheritedAttribution(state).relationshipId ? "billable" : "unresolvable";
}

/**
 * Attribution for one LLM call made by a SUB-AGENT, derived entirely from the
 * caller's. Spread into the LLM call params — always last — so no site can
 * apply half of it.
 *
 * Identical precedence to {@link buildScopeAttribution} (scope root → assistant
 * thread → nothing); the only addition is the `tokenUsageType` default, which
 * is the LIBRARY's default rather than any sub-agent name. Inventing
 * `"contextualiser"` / `"drift"` here would split one agent's spend across
 * ledger categories the app never asked for.
 */
export function buildInheritedAttribution(state?: CallerAttributionState): ScopeAttribution {
  return buildScopeAttribution({
    tokenUsageType: state?.tokenUsageType ?? TokenUsageType.TextGeneration,
    scopeId: state?.scopeId,
    scopeType: state?.scopeType,
    scopeLabel: state?.scopeLabel,
    assistantId: state?.assistantId,
  });
}

/**
 * Attribution for one EMBEDDING call (`EmbedderService.vectoriseText` /
 * `vectoriseTextBatch`), or `undefined` when the caller holds no entity to bill
 * it to — `EmbedderService.persistUsage` then skips the record entirely rather
 * than writing one whose `USED_FOR` edge matches nothing.
 *
 * `entityIdentifier` is whatever the call site happens to hold: a Neo4j LABEL
 * ("Npc"), a JSON:API type ("npcs"), or a nodeName. `modelRegistry.resolveModel`
 * accepts all three and yields the label the `USED_FOR` edge is matched on —
 * the same translation `resolveScopeLabel` performs for LLM calls.
 *
 * DIFFERENCE FROM `resolveScopeLabel`: an unresolvable identifier FALLS BACK to
 * itself instead of dropping the attribution. That is safe at the INGESTION call
 * sites, which already interpolate the same value into Cypher as a label
 * (`MATCH (nodeType:${params.nodeType} {id: $nodeId})`), so an identifier the
 * registry does not know is still a valid label there — and if it were not, that
 * Cypher would have matched nothing and there would be no chunk to embed.
 * Dropping it would silently lose a real, attributable cost.
 *
 * IT IS NOT SAFE AT THE QUERY-TIME CALL SITES. `GraphSearchService.tierSemantic`
 * passes `scopeType` — always a JSON:API type — and `buildRetrievalAttribution`
 * passes `contentType`, which is whichever of the two the caller set (narr8 sets
 * a JSON:API type; the contextualiser's own chunk-vector node compares it
 * against the LABEL "Conversation"). Either way an UNRESOLVED value is written
 * verbatim into `MATCH (relEntity:${relationshipType} {id: $relationshipId})`
 * and matches nothing — precisely the failure this helper exists to prevent.
 * Every such input is registry-registered today, so the fallback is latent
 * rather than live, which is why it WARNS rather than throws: the warning names
 * the identifier so the regression is visible the moment it appears, instead of
 * surfacing as a TokenUsage row with no `USED_FOR` edge.
 */
export function buildEmbedderAttribution(params: {
  /** Id of the node the spend is billed against. */
  entityId?: string;
  /** Neo4j label, JSON:API type or nodeName of that node. */
  entityIdentifier?: string;
  /** Overrides the recorder's default (`TokenUsageType.Embedding`). */
  tokenUsageType?: string;
}): EmbedderAttribution | undefined {
  if (!params.entityId || !params.entityIdentifier) return undefined;
  const resolved = modelRegistry.resolveModel(params.entityIdentifier)?.labelName;
  if (!resolved) {
    logger.warn(
      `entityIdentifier "${params.entityIdentifier}" resolves to no registered model — using it verbatim as the ` +
        `Neo4j label for this usage record. Correct if it already IS a label; if it is a JSON:API type, the ` +
        `record's USED_FOR edge will match nothing and the spend will be billed against no entity.`,
    );
  }
  return {
    relationshipId: params.entityId,
    relationshipType: resolved ?? params.entityIdentifier,
    ...(params.tokenUsageType ? { tokenUsageType: params.tokenUsageType } : {}),
  };
}

/**
 * Attribution for an EMBEDDING made by a SUB-AGENT, derived from the caller's
 * attribution through the SAME precedence chain as
 * {@link buildInheritedAttribution} (scope root → assistant thread → nothing),
 * so a turn's LLM spend and its embedding spend always land on one entity.
 *
 * `tokenUsageType` is deliberately omitted: the recorder's own default
 * (`embedding`) classifies the OPERATION, and it is not the sub-agent inventing
 * an identity — the caller's identity is already expressed by the entity the
 * record points at.
 */
export function buildInheritedEmbedderAttribution(state?: CallerAttributionState): EmbedderAttribution | undefined {
  const { relationshipId, relationshipType } = buildInheritedAttribution(state);
  if (!relationshipId || !relationshipType) return undefined;
  return { relationshipId, relationshipType };
}

/**
 * Attribution for a QUERY-time (retrieval) embedding — the contextualiser
 * embedding the user's question to search chunks / key concepts.
 *
 * A search has no entity of its own, so it is billed to the SCOPE BEING
 * SEARCHED, in the order the retrieval itself narrows:
 *  1. the CALLER's scope root, when the contextualiser was invoked by another
 *     agent that confined the whole turn to one (`scope`). It is the widest
 *     honest unit of spend and the same entity that agent's own LLM calls bill,
 *     so a turn is not split across two ledger targets;
 *  2. the content the run is bound to (`contentId` + `contentType`, a JSON:API
 *     type resolved to its label) — the retrieval scope the caller passes in;
 *  3. help mode's single HowTo (`dataLimits.limitToHowToId`), which is the only
 *     scope a help-mode run has;
 *  4. nothing — an unbound, non-help run genuinely searches the whole company,
 *     so there is no honest entity to name and `persistUsage` skips the record
 *     rather than inventing one.
 *
 * `dataLimits.howToMode` on its own carries NO id, so it deliberately does not
 * produce an attribution: guessing one would write a `USED_FOR` edge that
 * matches nothing.
 */
export function buildRetrievalAttribution(params: {
  contentId?: string;
  contentType?: string;
  dataLimits?: DataLimits;
  /** The calling agent's attribution, when this retrieval runs inside another agent's turn. */
  scope?: CallerAttributionState;
}): EmbedderAttribution | undefined {
  const inherited = buildInheritedEmbedderAttribution(params.scope);
  if (inherited) return inherited;

  const content = buildEmbedderAttribution({ entityId: params.contentId, entityIdentifier: params.contentType });
  if (content) return content;

  // Built directly rather than via `buildEmbedderAttribution`: `howToMeta.labelName`
  // IS the Neo4j label, so there is nothing to resolve, and routing it through the
  // registry would emit that helper's unresolved-identifier warning whenever the
  // HowTo model happens not to be registered — a false alarm.
  const howToId = params.dataLimits?.limitToHowToId;
  if (howToId) return { relationshipId: howToId, relationshipType: howToMeta.labelName };

  return undefined;
}
