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
 *
 * A rejected parameter is not always a top-level key: the Responses API nests
 * `reasoning.effort` inside a `reasoning` object, and the provider reports the
 * dotted path (`param: "reasoning.effort"`) rather than the leaf name. Every
 * body access below goes through the dotted-path helpers, of which a flat
 * name is simply the one-segment case. And some rejected VALUES are not
 * simply unsupported but renamed by generation — see `VALUE_SUCCESSORS`.
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
 * with `tools` — so that pattern names the parameter whose presence triggers it.
 *
 * On the Responses API (`/openai/v1/responses`) the SAME code-null shape also
 * appears for a plain, UNCONDITIONAL capability rejection — no clashing
 * parameter involved. Observed verbatim on 2026-08-18 against gpt-5.6-luna,
 * and fatal in production because every call passes a default `temperature`:
 *
 *   { message: "Unsupported parameter: 'temperature' is not supported with this model.",
 *     type: "invalid_request_error", param: "temperature", code: null }
 *
 * An entry with no `requiresParam` is this unconditional case: the parameter is
 * dropped (or renamed via PARAM_SUCCESSORS) on every request, exactly like a
 * coded `unsupported_parameter` verdict. Matching stays narrow on purpose in both
 * cases: "not supported" is a capability statement, whereas "must be between 0
 * and 2" is a validation error that dropping the parameter would silently paper
 * over — the unconditional pattern below is anchored to the canonical
 * "Unsupported parameter: '<name>' is not supported…" opening so it cannot match
 * a validation message.
 */
const PROSE_REJECTIONS: ReadonlyArray<{ pattern: RegExp; requiresParam?: string }> = [
  { pattern: /\btools?\b[^.]*\bnot supported\b/i, requiresParam: "tools" },
  { pattern: /^unsupported parameter\b/i },
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

/** Dotted-path access for nested rejected parameters ("reasoning.effort").
 *  A flat name is the one-segment case, so every caller uses these. */
const splitPath = (param: string): string[] => param.split(".");

/**
 * Path segments that must never be traversed. A provider's `error.param` is
 * attacker-influenced input (it comes back verbatim from a 400 response), and
 * a naive `key in node` walk follows the PROTOTYPE chain — `"constructor" in
 * {}` and `"prototype" in Object` are both true — so a crafted
 * `param: "constructor.prototype.toString"` would land `deletePath` on the
 * REAL, shared `Object.prototype`, corrupting it process-wide. `hasOwnProperty`
 * below already stops that walk (an ordinary body has no OWN `constructor` or
 * `prototype` key), but this denylist is the explicit, un-bypassable backstop:
 * even a body that legitimately owns one of these keys must not be traversed
 * through it.
 */
const DANGEROUS_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

const isDangerousPath = (param: string): boolean =>
  splitPath(param).some((segment) => DANGEROUS_PATH_SEGMENTS.has(segment));

/** A plain JSON object node — excludes arrays (and null), so the path
 *  helpers never index into a list. */
const isPlainObject = (node: unknown): node is Record<string, unknown> =>
  node !== null && typeof node === "object" && !Array.isArray(node);

function hasPath(body: any, param: string): boolean {
  if (isDangerousPath(param)) return false;
  let node = body;
  for (const key of splitPath(param)) {
    // `Array.isArray` here is deliberate: a coded rejection naming
    // "messages.0.content" must NOT be treated as present — indexing into an
    // array is not what a dotted PARAMETER path means, and letting it through
    // would have `deletePath` mutate `messages[0].content` on every retry
    // without ever converging (the provider keeps rejecting the same array).
    if (!isPlainObject(node) || !Object.prototype.hasOwnProperty.call(node, key)) return false;
    node = node[key];
  }
  return true;
}

function readPath(body: any, param: string): unknown {
  let node = body;
  for (const key of splitPath(param)) node = node?.[key];
  return node;
}

function writePath(body: any, param: string, value: unknown): void {
  const keys = splitPath(param);
  let node = body;
  for (const key of keys.slice(0, -1)) node = node[key];
  node[keys[keys.length - 1]] = value;
}

/** Removes the leaf, then any parent object the removal left empty — sending
 *  `reasoning: {}` where `reasoning.effort` was refused is a new unknown. */
function deletePath(body: any, param: string): void {
  const keys = splitPath(param);
  const parents: any[] = [body];
  for (const key of keys.slice(0, -1)) parents.push(parents[parents.length - 1][key]);
  delete parents[parents.length - 1][keys[keys.length - 1]];
  for (let i = keys.length - 2; i >= 0; i--) {
    const node = parents[i][keys[i]];
    if (node && typeof node === "object" && Object.keys(node).length === 0) delete parents[i][keys[i]];
  }
}

/**
 * Values that are not merely unsupported but GENERATION-RENAMED — "as little
 * thinking as possible" is spelled `none` on gpt-5.1+ models (which reject
 * `minimal`) and `minimal` on gpt-5 models (which reject `none`). Probed live
 * against both on 2026-08-18. Dropping the value on rejection would silently
 * re-enable default thinking a caller explicitly turned off, so a rejected
 * value retries as its sibling — and only when the sibling too is refused
 * does the parameter drop. Keyed by `valueKey` so lookups match the
 * `Verdict.values` bookkeeping.
 *
 * STICKY LATCH, deliberately: `rememberVerdict` only ever WIDENS a value-scoped
 * verdict's `values` set, never narrows it. So if a single transient/spurious
 * 400 rejects `none` and a later one (however unrelated the cause) rejects
 * `minimal` too, the parameter is latched as fully dropped for the rest of the
 * PROCESS — nothing un-teaches it short of a restart. A TTL / re-probe-after-N
 * was considered and rejected as YAGNI: this middleware exists because a 400
 * is expensive and confusing, not because a wrong verdict is expected to be
 * common, and a wrong verdict just means the parameter is dropped rather than
 * substituted — never that a bad VALUE goes out on the wire.
 */
const VALUE_SUCCESSORS: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  "reasoning.effort": { [valueKey("none")]: "minimal", [valueKey("minimal")]: "none" },
};

/**
 * Parameters whose outright loss must never happen SILENTLY. A gateway that
 * rejects `tools` this way would otherwise turn a loud 400 into a silent
 * capability downgrade — the caller believes function calling is available
 * and it simply never fires again for the rest of the process. `messages` /
 * `input` are the request itself (dropping either empties it); `stream`
 * changes the response SHAPE the caller is expecting; `response_format`
 * silently loses a structured-output contract the caller depends on for
 * parsing. A parameter in this set may still be RENAMED (PARAM_SUCCESSORS) or
 * VALUE-substituted (VALUE_SUCCESSORS) — those are not losses — but an
 * outright drop is refused: `readVerdict` returns undefined instead, so the
 * 400 surfaces to the caller instead of being repaired away.
 */
const NEVER_DROP = new Set(["tools", "stream", "messages", "input", "response_format"]);

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
      if (!hasPath(body, param)) continue;
      const value = readPath(body, param);
      // A value-scoped verdict must not touch a request carrying a value the
      // deployment has never refused — that value may well be accepted.
      if (verdict.values && !verdict.values.has(valueKey(value))) continue;
      // A conditional verdict must not touch a request that does not reproduce the
      // clash — dropping `reasoning_effort` from a tool-less call would remove
      // thinking the caller deliberately asked for.
      if (verdict.requiresParam && !(verdict.requiresParam in body)) continue;

      const substitute = verdict.values ? VALUE_SUCCESSORS[param]?.[valueKey(value)] : undefined;
      // Substitute only toward a value this deployment has not ALSO refused —
      // otherwise the pair would ping-pong until MAX_REPAIRS with no progress.
      if (substitute !== undefined && !verdict.values!.has(valueKey(substitute))) {
        writePath(body, param, substitute);
      } else {
        deletePath(body, param);
        // Flat write, deliberately: PARAM_SUCCESSORS today holds only top-level
        // keys ("max_tokens" → "max_completion_tokens"). If a DOTTED successor
        // is ever added, this line must become `writePath(body, verdict.successor,
        // value)` — writing it flat would land the value at the wrong nesting.
        if (verdict.successor) body[verdict.successor] = value;
      }
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
  // capability statement qualifies. A CONDITIONAL entry (`requiresParam` set) also
  // requires the request to carry the parameter the message blames the clash on;
  // an entry with no `requiresParam` is an unconditional capability statement and
  // applies regardless of what else the request carries.
  const coded = typeof code === "string" && UNSUPPORTED_CODES.has(code);
  let requiresParam: string | undefined;
  if (!coded) {
    if (typeof message !== "string") return undefined;
    const prose = PROSE_REJECTIONS.find((r) => r.pattern.test(message));
    if (!prose) return undefined;
    if (prose.requiresParam) {
      try {
        if (!(prose.requiresParam in JSON.parse(bodyStr))) return undefined;
      } catch {
        return undefined;
      }
      requiresParam = prose.requiresParam;
    }
  }

  let rejectedValue: unknown;
  try {
    const body = JSON.parse(bodyStr);
    if (!hasPath(body, param)) return undefined;
    rejectedValue = readPath(body, param);
  } catch {
    return undefined;
  }

  // The successor rename applies to both codes: a rejected `max_tokens` value still
  // means the cap belongs in `max_completion_tokens`, never that it should vanish.
  const successor = PARAM_SUCCESSORS[param] ?? null;

  // NEVER_DROP guard: a rename or a viable value-substitution is not a loss, so
  // only an outright drop is refused. `splitPath(param)[0]` because the set is
  // keyed by the top-level parameter name even for a nested rejection.
  if (!successor && NEVER_DROP.has(splitPath(param)[0])) {
    const substitute = code === "unsupported_value" ? VALUE_SUCCESSORS[param]?.[valueKey(rejectedValue)] : undefined;
    if (substitute === undefined) return undefined;
  }

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
      // Read back the MERGED verdict `rememberVerdict` just wrote, not the fresh
      // single-rejection one above — a second sibling value rejected on THIS
      // round-trip may already be latched (see VALUE_SUCCESSORS' sticky-latch
      // note) by a value an EARLIER round-trip taught it, and the log must say
      // what `applyLearned` will actually do with the merged set, not what this
      // one rejection alone would suggest.
      const mergedVerdict = learned.get(modelKey)?.get(verdict.param) ?? verdict.verdict;
      // A value-scoped rejection may have a generation-renamed sibling (VALUE_SUCCESSORS)
      // rather than a renamed PARAMETER (PARAM_SUCCESSORS) — check that first, so a
      // substitution is never logged as a drop.
      const substitute = mergedVerdict.values
        ? VALUE_SUCCESSORS[verdict.param]?.[valueKey(verdict.rejectedValue)]
        : undefined;
      const action =
        substitute !== undefined && !mergedVerdict.values!.has(valueKey(substitute))
          ? `sending '${substitute}' instead`
          : mergedVerdict.successor
            ? `sending '${mergedVerdict.successor}' instead`
            : "dropping it";
      console.warn(
        `[ModelService] "${modelKey}" rejected ${scope} — ` +
          `${action} ` +
          `for this and later calls${verdict.verdict.values ? " that send the same value" : ""}`,
      );

      body = applyLearned(body, modelKey);
      response = await send(input, { ...init, body });
    }

    return response;
  }) as typeof fetch;
}
