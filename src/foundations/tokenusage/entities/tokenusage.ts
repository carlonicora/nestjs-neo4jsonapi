import { Entity } from "../../../common/abstracts/entity";
import { defineEntity } from "../../../common/helpers/define-entity";
import { Company } from "../../company/entities/company";
import { tokenUsageMeta } from "./tokenusage.meta";

/**
 * TokenUsage Entity Type
 *
 * An accounting record of a single LLM (large-language-model) call made by the
 * platform: how many tokens it consumed and what it cost. Written automatically
 * by the LLM call paths (see `TokenUsageService.recordTokenUsage`) — never
 * created or edited directly by end users.
 */
export type TokenUsage = Entity & {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  cost?: number;
  credits?: number;
  tokenUsageType: string;

  company: Company;
};

/**
 * TokenUsage Entity Descriptor
 *
 * Replaces the hand-written `TokenUsageModel` (`entities/tokenusage.model.ts`,
 * deleted), whose `serialiser` was `undefined` — the entity had no JSON:API
 * wire at all. This descriptor is therefore the FIRST tokenusage serialiser:
 * every attribute below is new on the wire for consuming apps, with no prior
 * consumer to constrain it.
 *
 * Relationship-parity note: the old model declared `childrenTokens: []` and
 * `singleChildrenTokens: [companyMeta.nodeName]`, so no relationships are
 * declared here either (`isCompanyScoped: true` reinstates the company token).
 * Real graph edges exist — BELONGS_TO (company), TRIGGERED_BY (user), USED_FOR
 * (the polymorphic target entity, see `TokenUsageRepository.create()`) — but
 * were never part of the JSON:API surface. USED_FOR in particular is
 * polymorphic (any entity label), which the descriptor's fixed-target
 * `relationships` shape cannot express as a single relationship.
 *
 * `tokenUsageType` stays `type: "string"`: the set of operations that record
 * usage is application-specific, so consuming apps narrow it with their own
 * enum rather than the package pinning one.
 *
 * No top-level `description`/`chat` block: the chatbot copy is
 * application-specific (it describes each app's own operation names and
 * billing model) and is supplied by the consuming app's extended descriptor.
 * Per-field `description`s live here so an extended descriptor can spread
 * `TokenUsageDescriptor.fields` and inherit them.
 */
export const TokenUsageDescriptor = defineEntity<TokenUsage>()({
  ...tokenUsageMeta,

  isCompanyScoped: true,

  fields: {
    inputTokens: {
      type: "number",
      required: true,
      description: "The number of input (prompt) tokens consumed by this LLM call.",
    },
    outputTokens: {
      type: "number",
      required: true,
      description: "The number of output (completion) tokens produced by this LLM call.",
    },
    cachedInputTokens: {
      type: "number",
      description:
        "The subset of the input tokens that was served from the provider's prompt cache. Billed at the configured cached-input rate (falling back to the full input rate when no cached rate is configured) and always clamped to at most `inputTokens`.",
    },
    cost: {
      type: "number",
      description:
        "The computed monetary cost of this LLM call, derived from the configured per-million-token input/cached-input/output rates of the tier the call used. Absent or 0 when cost tracking is disabled (rates set to 0).",
    },
    credits: {
      type: "number",
      description:
        "The number of billing credits this call consumed: max(minCreditsPerRecord, round4(cost / creditCost)). 0 when credits tracking is disabled. Fractional (4 decimals).",
    },
    tokenUsageType: {
      type: "string",
      required: true,
      description:
        'Which internal AI operation triggered this usage (e.g. "summariser", "graph_creator", "ethicist"). See the application\'s TokenUsageType enum for the full list of values.',
    },
  },

  relationships: {},
});

export type TokenUsageDescriptorType = typeof TokenUsageDescriptor;
