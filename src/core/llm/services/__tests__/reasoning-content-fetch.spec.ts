import { describe, expect, it, vi } from "vitest";

import { reasoningContentFetch } from "../reasoning-content-fetch";

/** The exact shape Parasail's MiniMax-M3 endpoint returned on 2026-08-21: a
 *  schema-conforming payload delivered in `reasoning`, with `content: null`. */
const reasoningOnly = (reasoning: string, content: string | null = null) =>
  new Response(
    JSON.stringify({
      id: "gen-1",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content, reasoning } }],
      usage: { completion_tokens: 147, completion_tokens_details: { reasoning_tokens: 170 } },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

/** Builds a fake fetch that returns `response` and records the calls it saw. */
function fakeFetch(response: Response) {
  const fn = vi.fn(async () => response);
  return fn as unknown as typeof fetch;
}

const bodyOf = async (res: Response) => JSON.parse(await res.text());
const messageOf = async (res: Response) => (await bodyOf(res)).choices[0].message;

describe("reasoningContentFetch", () => {
  it("lifts a JSON payload out of `reasoning` when content is null", async () => {
    const payload = '{\n  "where": "a rain-soaked harbour",\n  "tension": "the pursuers are closing in"\n}';
    const res = await reasoningContentFetch(fakeFetch(reasoningOnly(payload)))("u", {} as any);

    expect((await messageOf(res)).content).toBe(payload);
  });

  it("lifts a payload wrapped in a markdown fence", async () => {
    const fenced = '```json\n{"where": "the quay", "tension": "a debt called in"}\n```';
    const res = await reasoningContentFetch(fakeFetch(reasoningOnly(fenced)))("u", {} as any);

    expect((await messageOf(res)).content).toBe(fenced);
  });

  it("lifts a JSON array payload", async () => {
    const payload = '[{"name": "Vera"}, {"name": "Ilse"}]';
    const res = await reasoningContentFetch(fakeFetch(reasoningOnly(payload)))("u", {} as any);

    expect((await messageOf(res)).content).toBe(payload);
  });

  it("reads `reasoning_details` when the provider omits the flat `reasoning` field", async () => {
    const payload = '{"where": "Pier 9", "tension": "the crane is rigged"}';
    const upstream = new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              reasoning_details: [{ type: "reasoning.text", text: payload, index: 0 }],
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
    const res = await reasoningContentFetch(fakeFetch(upstream))("u", {} as any);

    expect((await messageOf(res)).content).toBe(payload);
  });

  it("leaves prose reasoning alone — chain of thought must never become the answer", async () => {
    const prose = "Let me think about this. The harbour should feel oppressive, so I will open on the rain.";
    const res = await reasoningContentFetch(fakeFetch(reasoningOnly(prose)))("u", {} as any);

    expect((await messageOf(res)).content).toBeNull();
  });

  it("leaves a well-behaved response untouched when content is already present", async () => {
    const payload = '{"where": "the quay"}';
    const res = await reasoningContentFetch(fakeFetch(reasoningOnly(payload, '{"where": "the real answer"}')))(
      "u",
      {} as any,
    );

    expect((await messageOf(res)).content).toBe('{"where": "the real answer"}');
  });

  it("leaves a response whose content is blank-but-present untouched only when reasoning has no payload", async () => {
    const res = await reasoningContentFetch(fakeFetch(reasoningOnly("thinking out loud", "")))("u", {} as any);

    expect((await messageOf(res)).content).toBe("");
  });

  it("salvages when content is an empty string rather than null", async () => {
    const payload = '{"where": "Marrow Cove"}';
    const res = await reasoningContentFetch(fakeFetch(reasoningOnly(payload, "   ")))("u", {} as any);

    expect((await messageOf(res)).content).toBe(payload);
  });

  it("leaves a response carrying tool calls untouched", async () => {
    const upstream = new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              reasoning: '{"where": "the quay"}',
              tool_calls: [{ id: "c1", type: "function", function: { name: "stage", arguments: "{}" } }],
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
    const res = await reasoningContentFetch(fakeFetch(upstream))("u", {} as any);

    expect((await messageOf(res)).content).toBeNull();
  });

  it("passes a streaming response through untouched", async () => {
    const stream = new Response("data: {}\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });
    const res = await reasoningContentFetch(fakeFetch(stream))("u", {} as any);

    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(await res.text()).toBe("data: {}\n\n");
  });

  it("passes an error response through untouched", async () => {
    const err = new Response(JSON.stringify({ error: { message: "nope" } }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
    const res = await reasoningContentFetch(fakeFetch(err))("u", {} as any);

    expect(res.status).toBe(400);
    expect(await bodyOf(res)).toEqual({ error: { message: "nope" } });
  });

  it("passes a non-JSON body through untouched", async () => {
    const html = new Response("<html>gateway</html>", { status: 200, headers: { "content-type": "text/html" } });
    const res = await reasoningContentFetch(fakeFetch(html))("u", {} as any);

    expect(await res.text()).toBe("<html>gateway</html>");
  });

  it("preserves the rest of the body, including usage", async () => {
    const payload = '{"where": "the quay"}';
    const res = await reasoningContentFetch(fakeFetch(reasoningOnly(payload)))("u", {} as any);
    const body = await bodyOf(res);

    expect(body.id).toBe("gen-1");
    expect(body.usage.completion_tokens_details.reasoning_tokens).toBe(170);
    expect(body.choices[0].finish_reason).toBe("stop");
  });

  /** The production failure this file's single-read rule exists for (2026-08-31,
   *  game creation): the OpenAI SDK's request timeout fires WHILE the middleware
   *  is reading the body of a slow generation. A `clone()` tees the stream, so
   *  the failed read leaves the ORIGINAL disturbed; handing that back made the
   *  caller's `response.text()` throw undici's opaque "Body is unusable: Body has
   *  already been read", burying the real AbortError 120s upstream. */
  const abortingBody = () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"choices":[{"message":{"content":'));
          setTimeout(() => controller.error(new Error("This operation was aborted")), 5);
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  it("propagates a failed body read instead of handing back a consumed response", async () => {
    const wrapped = reasoningContentFetch(fakeFetch(abortingBody()));

    await expect(wrapped("u", {} as any)).rejects.toThrow(/aborted/i);
  });

  it("never surfaces undici's 'Body is unusable' in place of the real read failure", async () => {
    const wrapped = reasoningContentFetch(fakeFetch(abortingBody()));

    await expect(wrapped("u", {} as any)).rejects.not.toThrow(/Body is unusable/i);
  });

  it("hands back a readable body when the payload is not JSON after all", async () => {
    const mislabelled = new Response("<html>gateway timeout</html>", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const res = await reasoningContentFetch(fakeFetch(mislabelled))("u", {} as any);

    expect(await res.text()).toBe("<html>gateway timeout</html>");
  });

  it("drops transfer headers that no longer describe the body it rebuilt", async () => {
    // The wire response is gzipped and chunked; what we hand on is decoded text,
    // so carrying `content-encoding: gzip` forward would describe it wrongly.
    const gzipped = new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "hi" } }] }), {
      status: 200,
      headers: { "content-type": "application/json", "content-encoding": "gzip", "content-length": "412" },
    });
    const res = await reasoningContentFetch(fakeFetch(gzipped))("u", {} as any);

    expect(res.headers.get("content-encoding")).toBeNull();
    expect(res.headers.get("content-length")).toBeNull();
    expect(res.headers.get("content-type")).toBe("application/json");
    expect((await messageOf(res)).content).toBe("hi");
  });

  it("wraps an inner fetch, forwarding input and init unchanged", async () => {
    const inner = vi.fn(async () => reasoningOnly('{"a": 1}'));
    const init = { method: "POST", body: "{}" };
    await reasoningContentFetch(inner as unknown as typeof fetch)("https://x/y", init as any);

    expect(inner).toHaveBeenCalledWith("https://x/y", init);
  });
});
