/**
 * Provider-truth-driven request repair for OpenAI-compatible endpoints.
 *
 * Model families disagree about which chat-completions parameters they accept:
 * OpenAI's reasoning models (o-series, gpt-5 except gpt-5-chat) reject
 * `max_tokens`, `frequency_penalty` and `presence_penalty` outright, and reject
 * any non-default `temperature` / `top_p`. Encoding that taxonomy here would
 * duplicate knowledge we do not own and would rot on every model release — and
 * it cannot be complete anyway, because an Azure deployment name is chosen by
 * whoever created it ("prod-llm" tells us nothing about the model behind it).
 *
 * So we let the provider tell us. A 400 names the offending parameter exactly:
 *
 *   { error: { code: "unsupported_parameter", param: "max_tokens",
 *              message: "... Use 'max_completion_tokens' instead." } }
 *   { error: { code: "unsupported_value",     param: "temperature",
 *              message: "... Only the default (1) value is supported." } }
 *
 * This middleware removes the named parameter, retries once per rejection, and
 * REMEMBERS the verdict per model for the rest of the process, so only the first
 * call to a given deployment pays the extra round-trip.
 *
 * The two codes are remembered at DIFFERENT scopes, because they say different
 * things. `unsupported_parameter` means the deployment does not know the parameter
 * at all, so it is dropped from every later request. `unsupported_value` means only
 * the value sent was refused — the parameter itself is fine. Remembering the latter
 * as a parameter-level drop is actively harmful: one call sending
 * `reasoning_effort: "none"` to a deployment that only knows low/medium/high would
 * otherwise strip `reasoning_effort` from EVERY later request, silently discarding
 * the `"low"` latency win the triage/retrieval/citation-audit nodes depend on. So a
 * value rejection is memoised against the (parameter, value) pair, and a later
 * request carrying a different value for the same parameter is still sent.
 */

/**
 * Parameters that are not merely unsupported but RENAMED — dropping them would
 * silently discard the caller's intent (an unbounded response instead of a
 * capped one). This is parameter-level knowledge, stable across the whole
 * OpenAI-compatible ecosystem, NOT a per-model taxonomy: it is only ever applied
 * when the provider has already rejected the original name.
 */
const PARAM_SUCCESSORS: Readonly<Record<string, string>> = {
  max_tokens: "max_completion_tokens",
};

/** Bounds the repair loop: the API reports ONE rejected parameter per response,
 *  so a request carrying several needs one round-trip each. */
const MAX_REPAIRS = 6;

const UNSUPPORTED_CODES = new Set(["unsupported_parameter", "unsupported_value"]);

/**
 * Rejections a provider reports in PROSE rather than through `error.code`.
 *
 * Azure answers a gpt-5.6-luna request carrying both function tools and
 * `reasoning_effort` with `param: "reasoning_effort"` but `code: null`, so the
 * code-driven path above never fires and the request fails forever. Observed
 * verbatim on 2026-08-17:
 *
 *   { message: "Function tools with reasoning_effort are not supported for this
 *               model in /v1/chat/completions. Please use /v1/responses instead.",
 *     type: "invalid_request_error", param: "reasoning_effort", code: null }
 *
 * The refusal is CONDITIONAL — the parameter is fine on its own and only clashes
 * with `tools` — so each pattern names the parameter whose presence triggers it.
 * Matching stays narrow on purpose: "not supported" is a capability statement,
 * whereas "must be between 0 and 2" is a validation error that dropping the
 * parameter would silently paper over.
 */
const PROSE_REJECTIONS: ReadonlyArray<{ pattern: RegExp; requiresParam: string }> = [
  { pattern: /\btools?\b[^.]*\bnot supported\b/i, requiresParam: "tools" },
];

/** What the provider refused, and how widely that refusal generalises. */
interface Verdict {
  /** Rename target when the parameter has a documented successor, else null (drop). */
  successor: string | null;
  /**
   * Set only for an `unsupported_value` rejection: the exact values (JSON-serialised)
   * the deployment refused. The verdict then applies ONLY to a request carrying one
   * of them. `undefined` means the rejection was parameter-level and applies to every
   * value.
   */
  values?: Set<string>;
  /**
   * Set only for a CONDITIONAL rejection: the verdict applies solely to a request
   * that also carries this parameter. Without it, one tool-using call teaching the
   * deployment "drop reasoning_effort" would also strip thinking from every
   * tool-less call — and `modelKey` is provider|instance|model, so a base tier and
   * a `_LARGE` tier running the same deployment share one entry. That is exactly
   * how a deliberate `AI_REASONING_EFFORT_LARGE=high` would silently stop working.
   */
  requiresParam?: string;
}

/** Canonical key for a parameter value, so `"none"` and `0.2` compare reliably. */
const valueKey = (value: unknown): string => JSON.stringify(value ?? null);

/**
 * Learned verdicts, keyed by model. Module-level on purpose: `ModelService`
 * builds a fresh chat model per call, so anything held on the instance would
 * re-learn (and re-pay the failed round-trip) on every request.
 *
 * model key → (rejected parameter → verdict)
 */
const learned = new Map<string, Map<string, Verdict>>();

/** Test seam — clears everything learned so far. */
export function resetLearnedUnsupportedParams(): void {
  learned.clear();
}

/** Applies the verdicts learned so far for `modelKey`. Returns the body
 *  unchanged when nothing is known yet or the body is not JSON. */
function applyLearned(bodyStr: string, modelKey: string): string {
  const verdicts = learned.get(modelKey);
  if (!verdicts?.size) return bodyStr;
  try {
    const body = JSON.parse(bodyStr);
    let changed = false;
    for (const [param, verdict] of verdicts) {
      if (!(param in body)) continue;
      const value = body[param];
      // A value-scoped verdict must not touch a request carrying a value the
      // deployment has never refused — that value may well be accepted.
      if (verdict.values && !verdict.values.has(valueKey(value))) continue;
      // A conditional verdict must not touch a request that does not reproduce the
      // clash — dropping `reasoning_effort` from a tool-less call would remove
      // thinking the caller deliberately asked for.
      if (verdict.requiresParam && !(verdict.requiresParam in body)) continue;
      delete body[param];
      if (verdict.successor) body[verdict.successor] = value;
      changed = true;
    }
    return changed ? JSON.stringify(body) : bodyStr;
  } catch {
    return bodyStr;
  }
}

/** Records a verdict, widening an existing entry rather than narrowing it: a
 *  parameter-level rejection always supersedes value-level ones, and a second
 *  rejected value joins the set instead of replacing it. */
function rememberVerdict(modelKey: string, param: string, verdict: Verdict): void {
  const verdicts = learned.get(modelKey) ?? new Map<string, Verdict>();
  const existing = verdicts.get(param);
  // BROADEST verdict wins. An unconditional parameter-level rejection (no `values`,
  // no `requiresParam`) covers every request; a value-scoped or conditional one
  // covers a subset. Replacing the broad one with a narrow one would re-send a
  // parameter already known to be refused outright.
  const unconditional = (v: Verdict): boolean => !v.values && !v.requiresParam;
  if (!existing) {
    verdicts.set(param, verdict);
  } else if (unconditional(verdict)) {
    verdicts.set(param, verdict);
  } else if (unconditional(existing)) {
    // Keep the broader verdict.
  } else if (existing.values && verdict.values) {
    for (const value of verdict.values) existing.values.add(value);
  } else if (existing.requiresParam && verdict.requiresParam && existing.requiresParam !== verdict.requiresParam) {
    // Two different conditions both refuse it → the parameter is refused broadly.
    verdicts.set(param, { successor: verdict.successor });
  }
  // existing is parameter-level and the new verdict is value-level → already covered.
  learned.set(modelKey, verdicts);
}

/** Reads the rejected-parameter verdict out of a 400 payload. Returns undefined
 *  when the error is anything other than a rejected top-level parameter that the
 *  request actually carried — we only repair what we can prove we caused. */
function readVerdict(
  responseText: string,
  bodyStr: string,
): { param: string; verdict: Verdict; rejectedValue: unknown } | undefined {
  let param: unknown;
  let code: unknown;
  let message: unknown;
  try {
    const error = JSON.parse(responseText)?.error;
    param = error?.param;
    code = error?.code;
    message = error?.message;
  } catch {
    return undefined;
  }
  if (typeof param !== "string" || !param) return undefined;

  // Prose fallback for providers that name the parameter but send no code. Only a
  // capability statement qualifies, and only when the request carries the
  // parameter the message blames the clash on.
  const coded = typeof code === "string" && UNSUPPORTED_CODES.has(code);
  let requiresParam: string | undefined;
  if (!coded) {
    if (typeof message !== "string") return undefined;
    const prose = PROSE_REJECTIONS.find((r) => r.pattern.test(message));
    if (!prose) return undefined;
    try {
      if (!(prose.requiresParam in JSON.parse(bodyStr))) return undefined;
    } catch {
      return undefined;
    }
    requiresParam = prose.requiresParam;
  }

  let rejectedValue: unknown;
  try {
    const body = JSON.parse(bodyStr);
    if (!(param in body)) return undefined;
    rejectedValue = body[param];
  } catch {
    return undefined;
  }

  // The successor rename applies to both codes: a rejected `max_tokens` value still
  // means the cap belongs in `max_completion_tokens`, never that it should vanish.
  const successor = PARAM_SUCCESSORS[param] ?? null;
  return {
    param,
    rejectedValue,
    verdict:
      code === "unsupported_value"
        ? { successor, values: new Set([valueKey(rejectedValue)]) }
        : requiresParam
          ? { successor, requiresParam }
          : { successor },
  };
}

/**
 * Wraps `fetch` so a rejected chat-completions parameter repairs itself.
 *
 * @param modelKey - Identifies the deployment the verdicts belong to. Two
 *   deployments of the same model name on different endpoints get separate
 *   entries, so one provider's rejection never suppresses a parameter another
 *   provider accepts.
 * @param inner - The fetch to wrap. Composes with other middleware — passing
 *   `openRouterEscalatingFetch(...)` keeps its provider pinning intact.
 */
export function unsupportedParamFetch(modelKey: string, inner?: typeof fetch): typeof fetch {
  // Resolved per call, never captured at construction: binding the global here
  // would freeze whatever `fetch` existed when the model was built.
  const send: typeof fetch = (input, init) => (inner ?? fetch)(input, init);

  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    if (typeof init?.body !== "string") return send(input, init);

    let body = applyLearned(init.body, modelKey);
    let response = await send(input, { ...init, body });

    for (let repair = 0; repair < MAX_REPAIRS; repair++) {
      if (response.status !== 400) return response;

      // Safe to drain: a 400 is never a stream. Anything we decide not to repair
      // is handed back as an equivalent Response so the caller still sees it.
      const responseText = await response.text();
      const verdict = readVerdict(responseText, body);
      if (!verdict) {
        return new Response(responseText, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      }

      rememberVerdict(modelKey, verdict.param, verdict.verdict);
      const scope = verdict.verdict.values
        ? `'${verdict.param}: ${JSON.stringify(verdict.rejectedValue)}'`
        : `'${verdict.param}'`;
      console.warn(
        `[ModelService] "${modelKey}" rejected ${scope} — ` +
          `${verdict.verdict.successor ? `sending '${verdict.verdict.successor}' instead` : "dropping it"} ` +
          `for this and later calls${verdict.verdict.values ? " that send the same value" : ""}`,
      );

      body = applyLearned(body, modelKey);
      response = await send(input, { ...init, body });
    }

    return response;
  }) as typeof fetch;
}
