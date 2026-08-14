/**
 * Vertex AI location handling.
 *
 * Google exposes three kinds of Vertex endpoint, and the hostname pattern is
 * DIFFERENT for each — you cannot derive all three from the location string by
 * prefixing it:
 *
 * | Kind         | Location            | Hostname                                  |
 * | ------------ | ------------------- | ----------------------------------------- |
 * | Regional     | `europe-west4`      | `europe-west4-aiplatform.googleapis.com`  |
 * | Multi-region | `eu` / `us`         | `aiplatform.eu.rep.googleapis.com`        |
 * | Global       | `global`            | `aiplatform.googleapis.com`               |
 *
 * `@langchain/google-common` only knows two of them: it special-cases `global`
 * and otherwise builds `${location}-aiplatform.googleapis.com`. So a
 * multi-region location silently produces `eu-aiplatform.googleapis.com`, which
 * is not a Vertex endpoint at all — the request 404s.
 *
 * This resolves the hostname the LangChain `endpoint` option needs so callers
 * can put EITHER a region or a multi-region in their configuration.
 *
 * Why anyone picks a multi-region: it pools capacity across every region in the
 * jurisdiction (fewer 429s, one Provisioned Throughput commitment) while
 * keeping ML processing inside that jurisdiction. It is NOT a stronger data
 * residency guarantee than a pinned regional location — a regional endpoint
 * already keeps processing in its own country/jurisdiction, and `eu` is in fact
 * BROADER (any EU member state; the UK and Switzerland are excluded).
 *
 * @see https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/locations
 * @see https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/data-residency
 */

/** Vertex multi-region locations, which route through the `.rep.` hostnames. */
export const VERTEX_MULTI_REGIONS = ["us", "eu"] as const;

export type VertexMultiRegion = (typeof VERTEX_MULTI_REGIONS)[number];

/** True when `location` is a jurisdictional multi-region rather than a region. */
export function isVertexMultiRegion(location?: string): location is VertexMultiRegion {
  return VERTEX_MULTI_REGIONS.includes(location?.trim().toLowerCase() as VertexMultiRegion);
}

/**
 * The Vertex hostname for a location, or `undefined` when LangChain's own
 * computation is already correct (regional locations, `global`, and unset).
 *
 * Returning `undefined` rather than the regional hostname is deliberate: it
 * leaves the default path untouched, so this only ever ADDS multi-region
 * support instead of taking over endpoint construction for every caller.
 */
export function vertexEndpointFor(location?: string): string | undefined {
  const normalised = location?.trim().toLowerCase();
  return isVertexMultiRegion(normalised) ? `aiplatform.${normalised}.rep.googleapis.com` : undefined;
}

/**
 * Spreadable LangChain client params for a location that may be a region, a
 * multi-region, or `global`. Yields `{}` for everything but a multi-region, so
 * the `endpoint` key is absent (not `undefined`) on the default path.
 *
 * ```ts
 * new ChatVertexAI({ model, location: cfg.region, ...vertexLocationParams(cfg.region) });
 * ```
 */
export function vertexLocationParams(location?: string): { endpoint?: string } {
  const endpoint = vertexEndpointFor(location);
  return endpoint ? { endpoint } : {};
}
