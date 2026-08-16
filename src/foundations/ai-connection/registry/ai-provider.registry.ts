import { BadRequestException } from "@nestjs/common";
import { AiConnectionType } from "../../../core/llm/interfaces/ai-candidate.interface";
import { validateAiUrl } from "../../../core/llm/services/model.service";

/**
 * How the admin editor renders a provider field, and how the write-side
 * validator interprets it.
 *
 * - `text`    — free-form string input
 * - `secret`  — write-only value, encrypted at rest, never serialised back
 * - `number`  — numeric input
 * - `boolean` — checkbox
 * - `select`  — closed set, constrained by {@link AiProviderFieldDescriptor.options}
 */
export type AiProviderFieldKind = "text" | "secret" | "number" | "boolean" | "select";

/**
 * One configurable field of one provider. Structure only — no display text:
 * the frontend derives its i18n keys from `field`.
 */
export interface AiProviderFieldDescriptor {
  field: string;
  kind: AiProviderFieldKind;
  required?: boolean;
  options?: string[];
  default?: string | number | boolean;
}

/** The complete field set one provider exposes for one connection type. */
export interface AiProviderDescriptor {
  provider: string;
  fields: AiProviderFieldDescriptor[];
}

/**
 * `reasoning_effort` is the same closed set everywhere it is offered — it mirrors
 * REASONING_EFFORTS in `model.service.ts`.
 */
const REASONING_EFFORT_FIELD: AiProviderFieldDescriptor = {
  field: "reasoningEffort",
  kind: "select",
  options: ["none", "minimal", "low", "medium", "high"],
};

const MAX_OUTPUT_TOKENS_FIELD: AiProviderFieldDescriptor = { field: "maxOutputTokens", kind: "number" };

/**
 * Per-connection cost overrides for token-billed modalities. A DB connection
 * carries its own rates so token-usage costing reflects the connection that
 * actually served the call (spec § Decisions — "Costs").
 */
const CHAT_COST_FIELDS: AiProviderFieldDescriptor[] = [
  { field: "inputCostPer1MTokens", kind: "number" },
  { field: "outputCostPer1MTokens", kind: "number" },
  { field: "cachedInputCostPer1MTokens", kind: "number" },
];

/**
 * Providers that go through `ModelService.buildChatModel` — the `ai`, `aiLite`,
 * `aiLarge`, `vision` and `audio` connection types all share this set.
 */
const CHAT_PROVIDERS: AiProviderDescriptor[] = [
  {
    provider: "openrouter",
    fields: [
      { field: "model", kind: "text", required: true },
      { field: "apiKey", kind: "secret", required: true },
      { field: "url", kind: "text", default: "https://openrouter.ai/api/v1" },
      { field: "region", kind: "text" },
      { field: "allowFallbacks", kind: "boolean", default: true },
      REASONING_EFFORT_FIELD,
      MAX_OUTPUT_TOKENS_FIELD,
    ],
  },
  {
    provider: "azure",
    fields: [
      { field: "instance", kind: "text", required: true },
      { field: "model", kind: "text", required: true },
      { field: "apiKey", kind: "secret", required: true },
      { field: "apiVersion", kind: "text", required: true },
      REASONING_EFFORT_FIELD,
      MAX_OUTPUT_TOKENS_FIELD,
    ],
  },
  {
    provider: "vertex",
    fields: [
      { field: "model", kind: "text", required: true },
      { field: "region", kind: "text", required: true },
      { field: "googleCredentialsBase64", kind: "secret", required: true },
      MAX_OUTPUT_TOKENS_FIELD,
    ],
  },
  {
    provider: "requesty",
    fields: [
      { field: "model", kind: "text", required: true },
      { field: "apiKey", kind: "secret", required: true },
      { field: "url", kind: "text", required: true },
      REASONING_EFFORT_FIELD,
      MAX_OUTPUT_TOKENS_FIELD,
    ],
  },
  {
    provider: "ollama",
    fields: [
      { field: "model", kind: "text", required: true },
      { field: "url", kind: "text", default: "http://localhost:11434/v1" },
      MAX_OUTPUT_TOKENS_FIELD,
    ],
  },
  {
    provider: "llamacpp",
    fields: [{ field: "url", kind: "text", default: "http://localhost:8033/v1" }],
  },
  {
    provider: "custom",
    fields: [
      { field: "model", kind: "text", required: true },
      { field: "url", kind: "text", required: true },
      { field: "apiKey", kind: "secret" },
      REASONING_EFFORT_FIELD,
      MAX_OUTPUT_TOKENS_FIELD,
    ],
  },
];

/** Appends per-connection-type extra fields to every provider row of that type. */
const withExtras = (rows: AiProviderDescriptor[], extras: AiProviderFieldDescriptor[]): AiProviderDescriptor[] =>
  rows.map((row) => ({ provider: row.provider, fields: [...row.fields, ...extras] }));

const EMBEDDER_COST_FIELDS: AiProviderFieldDescriptor[] = [{ field: "inputCostPer1MTokens", kind: "number" }];

/**
 * Embedder providers mirror the `buildInnerEmbedder` switch in `model.service.ts`
 * (`openrouter`, `requesty`, `openai`, `azure`, `vertex` — `local` throws there and
 * is therefore not offered).
 */
const EMBEDDER_PROVIDERS: AiProviderDescriptor[] = [
  {
    provider: "openrouter",
    fields: [
      { field: "model", kind: "text", required: true },
      { field: "dimensions", kind: "number", required: true },
      { field: "apiKey", kind: "secret", required: true },
      { field: "url", kind: "text", required: true },
    ],
  },
  {
    provider: "requesty",
    fields: [
      { field: "model", kind: "text", required: true },
      { field: "dimensions", kind: "number", required: true },
      { field: "apiKey", kind: "secret", required: true },
      { field: "url", kind: "text", required: true },
    ],
  },
  {
    provider: "openai",
    fields: [
      { field: "model", kind: "text", required: true },
      { field: "dimensions", kind: "number", required: true },
      { field: "apiKey", kind: "secret", required: true },
    ],
  },
  {
    provider: "azure",
    fields: [
      { field: "model", kind: "text", required: true },
      { field: "dimensions", kind: "number", required: true },
      { field: "apiKey", kind: "secret", required: true },
      { field: "instance", kind: "text", required: true },
      { field: "apiVersion", kind: "text", required: true },
    ],
  },
  {
    provider: "vertex",
    fields: [
      { field: "model", kind: "text", required: true },
      { field: "dimensions", kind: "number", required: true },
      { field: "region", kind: "text", required: true },
      { field: "googleCredentialsBase64", kind: "secret", required: true },
    ],
  },
];

/**
 * SDK-based transcription providers, mirroring the `getTranscriber` switch in
 * `model.service.ts` (`openai` / `azure` — anything else throws there).
 */
const TRANSCRIBER_PROVIDERS: AiProviderDescriptor[] = [
  {
    provider: "openai",
    fields: [
      { field: "apiKey", kind: "secret", required: true },
      { field: "model", kind: "text", required: true },
    ],
  },
  {
    provider: "azure",
    fields: [
      { field: "apiKey", kind: "secret", required: true },
      { field: "model", kind: "text", required: true },
      { field: "url", kind: "text", required: true },
      { field: "apiVersion", kind: "text", required: true },
    ],
  },
];

/**
 * Mistral Document AI (OCR). One generic row: the endpoint is fully described by
 * url + apiVersion, so there is nothing provider-specific to branch on.
 */
const DOCUMENT_AI_PROVIDERS: AiProviderDescriptor[] = [
  {
    provider: "custom",
    fields: [
      { field: "apiKey", kind: "secret" },
      { field: "model", kind: "text" },
      { field: "url", kind: "text" },
      { field: "apiVersion", kind: "text" },
      { field: "costPerPage", kind: "number" },
    ],
  },
];

/**
 * The single source of truth for which providers each connection type accepts and
 * which fields each provider exposes. Drives (a) write-side validation, (b) the
 * admin editor form (served as top-level JSON:API `meta.providerRegistry`), and
 * (c) resolver normalisation.
 */
export const AI_PROVIDER_REGISTRY: Record<AiConnectionType, AiProviderDescriptor[]> = {
  ai: withExtras(CHAT_PROVIDERS, CHAT_COST_FIELDS),
  aiLite: withExtras(CHAT_PROVIDERS, CHAT_COST_FIELDS),
  aiLarge: withExtras(CHAT_PROVIDERS, CHAT_COST_FIELDS),
  vision: withExtras(CHAT_PROVIDERS, CHAT_COST_FIELDS),
  audio: withExtras(CHAT_PROVIDERS, [
    ...CHAT_COST_FIELDS,
    { field: "costPerMinute", kind: "number" },
    { field: "directUrl", kind: "text" },
    { field: "language", kind: "text" },
    { field: "directFormat", kind: "select", options: ["multipart", "json"] },
    { field: "directProvider", kind: "text" },
  ]),
  embedder: withExtras(EMBEDDER_PROVIDERS, EMBEDDER_COST_FIELDS),
  transcriber: TRANSCRIBER_PROVIDERS,
  documentAi: DOCUMENT_AI_PROVIDERS,
};

/** Fields owned by the base entity, always allowed regardless of provider. */
const BASE_FIELDS = new Set(["name", "connectionType", "provider", "position", "enabled"]);

/**
 * Write-side gate for an AiConnection: the provider must be legal for the type,
 * every required field must be present, no unsupported field may be set, closed
 * sets must be respected, and any URL must survive {@link validateAiUrl} (HTTPS or
 * loopback, plus the optional AI_URL_ALLOWLIST).
 *
 * A PUT that keeps a stored secret sends no secret value, so the caller (the
 * AiConnection service) merges stored secrets back in BEFORE calling this — the
 * validator itself needs no special case.
 *
 * @throws {BadRequestException} on any registry violation.
 * @throws {Error} when a url/directUrl fails {@link validateAiUrl}.
 */
export function validateAiConnectionAttributes(params: {
  connectionType: string;
  provider: string;
  attributes: Record<string, unknown>;
}): void {
  const rows = AI_PROVIDER_REGISTRY[params.connectionType as AiConnectionType];
  if (!rows) throw new BadRequestException(`Unknown connection type "${params.connectionType}"`);

  const row = rows.find((r) => r.provider === params.provider);
  if (!row)
    throw new BadRequestException(
      `Provider "${params.provider}" is not available for connection type "${params.connectionType}"`,
    );

  const allowed = new Set([...BASE_FIELDS, ...row.fields.map((f) => f.field)]);
  const present = (name: string): boolean => {
    const value = params.attributes[name];
    return value !== undefined && value !== null && value !== "";
  };

  const missing = row.fields.filter((f) => f.required && !present(f.field)).map((f) => f.field);
  if (missing.length)
    throw new BadRequestException(`Missing required field(s) for ${params.provider}: ${missing.join(", ")}`);

  const unknown = Object.keys(params.attributes).filter((key) => present(key) && !allowed.has(key));
  if (unknown.length)
    throw new BadRequestException(`Field(s) not supported by ${params.provider}: ${unknown.join(", ")}`);

  for (const field of row.fields) {
    if (field.options && present(field.field) && !field.options.includes(String(params.attributes[field.field])))
      throw new BadRequestException(`"${params.attributes[field.field]}" is not a valid value for ${field.field}`);
  }

  for (const urlField of ["url", "directUrl"]) {
    if (present(urlField)) validateAiUrl(String(params.attributes[urlField]), params.provider);
  }
}
