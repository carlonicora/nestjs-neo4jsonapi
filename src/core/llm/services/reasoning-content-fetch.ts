/**
 * Response repair for providers that deliver the answer in `reasoning`.
 *
 * A reasoning-capable model served over an OpenAI-compatible endpoint splits its
 * output into two fields: the hidden trace in `message.reasoning`, the answer in
 * `message.content`. That split is done by the SERVING STACK, not the model — a
 * vLLM reasoning parser looking for the boundary token the model was trained to
 * emit. When the parser is misconfigured for the checkpoint it is hosting, the
 * boundary is never found, EVERYTHING is classified as reasoning, and `content`
 * comes back null.
 *
 * Captured verbatim from OpenRouter → Parasail → minimax/minimax-m3 on
 * 2026-08-21, answering a `response_format: json_schema` request:
 *
 *   { "finish_reason": "stop",
 *     "message": { "content": null,
 *                  "reasoning": "{ \"where\": \"A rain-soaked harbour...\" }" } }
 *
 * The payload was complete and schema-conforming. It was simply in the wrong
 * field, so LangChain — which reads `message.content` and DISCARDS `reasoning`
 * entirely (it survives in neither `additional_kwargs` nor `response_metadata`)
 * — surfaced an empty string, and the whole salvage ladder in `LLMService.call`
 * failed with "No content" on a response that had been generated and billed.
 * That is why this repair lives in the fetch middleware rather than as another
 * rung of that ladder: by the time the ladder runs, the evidence is gone.
 *
 * The rule is deliberately narrow. Reasoning is only promoted when `content` is
 * absent or blank AND the reasoning text is itself a JSON document. Prose
 * reasoning is left exactly where it is: promoting a chain of thought into the
 * answer would leak deliberation into narration, which is far worse than the
 * failure being repaired. A response that already carries content or tool calls
 * is never touched, so a healthy provider is unaffected.
 */

/** Content-types that carry a single JSON document we can rewrite. A streamed
 *  response (`text/event-stream`) is passed through untouched — its chunks are
 *  assembled downstream, and buffering them here would break streaming. */
const isJsonResponse = (res: Response): boolean =>
  (res.headers.get("content-type") ?? "").toLowerCase().includes("json");

/** True when the model produced nothing in the field the caller will read. */
const isBlank = (content: unknown): boolean =>
  content === null || content === undefined || (typeof content === "string" && content.trim() === "");

/**
 * The reasoning text a provider attached to a message, from either spelling:
 * the flat `reasoning` string, or the `reasoning_details` array OpenRouter
 * normalises to. Details are joined in the order the provider sent them.
 */
const reasoningTextOf = (message: any): string => {
  if (typeof message?.reasoning === "string" && message.reasoning.trim() !== "") return message.reasoning;

  const details = message?.reasoning_details;
  if (!Array.isArray(details)) return "";
  return details
    .map((d: any) => (typeof d?.text === "string" ? d.text : ""))
    .filter((t: string) => t !== "")
    .join("");
};

/** Strips a markdown fence, which models wrap payloads in whichever field they
 *  land in. Returns the text unchanged when it carries no fence. */
const stripFence = (text: string): string => {
  const fenced = text.trim().match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  return fenced ? fenced[1] : text;
};

/**
 * Whether the reasoning text IS the answer rather than deliberation about it.
 * The test is parseability as a JSON object or array — the only shapes a
 * structured-output or forced-tool call can legitimately return. A scalar
 * (`"stop"`, `42`) is rejected: those parse, but no schema in this codebase is
 * satisfied by one, and accepting them would let a stray token become an answer.
 */
const isJsonPayload = (text: string): boolean => {
  const candidate = stripFence(text).trim();
  if (!candidate.startsWith("{") && !candidate.startsWith("[")) return false;
  try {
    const value = JSON.parse(candidate);
    return typeof value === "object" && value !== null;
  } catch {
    return false;
  }
};

/**
 * Rewrites the parsed body in place, moving a JSON payload from `reasoning` into
 * `content` for every choice that needs it. Returns true when anything changed,
 * so an untouched body can be passed through as the original Response object.
 *
 * The reasoning field is left in place: it is what the provider billed as
 * reasoning tokens, and usage accounting reads it.
 */
const promoteReasoningToContent = (body: any): boolean => {
  const choices = body?.choices;
  if (!Array.isArray(choices)) return false;

  let changed = false;
  for (const choice of choices) {
    const message = choice?.message;
    if (!message || !isBlank(message.content)) continue;
    // A response that asked for a tool and got one is not the failure this
    // repairs — the caller reads `tool_calls`, and `content` is empty by design.
    if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) continue;

    const reasoning = reasoningTextOf(message);
    if (reasoning === "" || !isJsonPayload(reasoning)) continue;

    message.content = reasoning;
    changed = true;
  }
  return changed;
};

/**
 * A `fetch` middleware that repairs reasoning-only responses. Wraps an inner
 * fetch (the OpenRouter pin, the unsupported-parameter repair) rather than
 * replacing it, and forwards `input`/`init` untouched — it only ever inspects
 * the response.
 */
export function reasoningContentFetch(innerFetch: typeof fetch = fetch): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const response = await innerFetch(input, init);
    if (!response.ok || !isJsonResponse(response)) return response;

    let body: any;
    try {
      body = JSON.parse(await response.clone().text());
    } catch {
      // Not a JSON document after all (a gateway's HTML error page mislabelled,
      // a truncated body) — hand back the original, untouched.
      return response;
    }

    if (!promoteReasoningToContent(body)) return response;

    console.warn(
      "[reasoningContentFetch] provider returned the payload in `reasoning` with empty `content` — promoted it",
    );

    return new Response(JSON.stringify(body), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }) as typeof fetch;
}
