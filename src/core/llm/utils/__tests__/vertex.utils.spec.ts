import { describe, expect, it } from "vitest";
import { isVertexMultiRegion, vertexEndpointFor, vertexLocationParams } from "../vertex.utils";

/**
 * The observed failure this exists for: `AI_REGION=eu` is a valid Vertex
 * location, but `@langchain/google-common` builds the hostname as
 * `${location}-aiplatform.googleapis.com`, so it produced
 * `eu-aiplatform.googleapis.com` — which is not a Vertex endpoint and answers
 * 404 (verified against the live host, vs 401 for the real endpoints).
 */
describe("vertexEndpointFor", () => {
  it("maps each multi-region to its .rep. hostname", () => {
    expect(vertexEndpointFor("eu")).toBe("aiplatform.eu.rep.googleapis.com");
    expect(vertexEndpointFor("us")).toBe("aiplatform.us.rep.googleapis.com");
  });

  it("leaves regional locations to LangChain's own computation", () => {
    // Returning undefined (not the regional hostname) is what keeps this change
    // additive: the default endpoint path stays untouched.
    expect(vertexEndpointFor("europe-west4")).toBeUndefined();
    expect(vertexEndpointFor("us-central1")).toBeUndefined();
  });

  it("leaves the global endpoint alone", () => {
    // LangChain already special-cases "global" → aiplatform.googleapis.com.
    expect(vertexEndpointFor("global")).toBeUndefined();
  });

  it("treats unset and empty locations as no override", () => {
    expect(vertexEndpointFor(undefined)).toBeUndefined();
    expect(vertexEndpointFor("")).toBeUndefined();
    expect(vertexEndpointFor("   ")).toBeUndefined();
  });

  it("tolerates the casing and padding an env var picks up", () => {
    expect(vertexEndpointFor(" EU ")).toBe("aiplatform.eu.rep.googleapis.com");
  });

  it("does not mistake a region that merely starts with a multi-region name", () => {
    // "europe-west4" starts with "eu"; a prefix test would wrongly rewrite it.
    expect(vertexEndpointFor("europe-west4")).toBeUndefined();
    expect(vertexEndpointFor("us-east4")).toBeUndefined();
  });
});

describe("isVertexMultiRegion", () => {
  it("distinguishes multi-regions from regions and global", () => {
    expect(isVertexMultiRegion("eu")).toBe(true);
    expect(isVertexMultiRegion("us")).toBe(true);
    expect(isVertexMultiRegion("europe-west3")).toBe(false);
    expect(isVertexMultiRegion("global")).toBe(false);
    expect(isVertexMultiRegion(undefined)).toBe(false);
  });
});

describe("vertexLocationParams", () => {
  it("omits the key entirely on the default path", () => {
    // Spreading `{ endpoint: undefined }` would hand LangChain an explicit
    // undefined; the contract is that the key is absent.
    expect(vertexLocationParams("europe-west4")).toEqual({});
    expect("endpoint" in vertexLocationParams("europe-west4")).toBe(false);
  });

  it("yields a spreadable endpoint for a multi-region", () => {
    expect(vertexLocationParams("eu")).toEqual({ endpoint: "aiplatform.eu.rep.googleapis.com" });
  });
});
