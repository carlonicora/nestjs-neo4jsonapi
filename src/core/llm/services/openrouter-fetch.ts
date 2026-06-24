/** Inject OpenRouter's `provider` routing block into a JSON request body.
 *  OpenRouter routes to ANY provider unless the body carries this block. Returns
 *  the body unchanged if it is not JSON. */
export function injectOpenRouterProvider(bodyStr: string, region: string, allowFallbacks: boolean): string {
  try {
    const body = JSON.parse(bodyStr);
    body.provider = { order: [region], allow_fallbacks: allowFallbacks, require_parameters: true };
    return JSON.stringify(body);
  } catch {
    return bodyStr;
  }
}

/** A `fetch` middleware that pins OpenRouter routing, ESCALATING fallbacks across
 *  retries: the FIRST request honours `firstAttemptAllowFallbacks` (the configured
 *  pin — false hard-pins the required provider), every RETRY allows fallbacks so a
 *  transient provider error (429/502) can reroute at OpenRouter's discretion.
 *  `order:[region]` is always kept, so the required provider stays the preference. */
export function openRouterEscalatingFetch(region: string, firstAttemptAllowFallbacks: boolean): typeof fetch {
  let attempt = 0;
  return ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    if (init?.body && typeof init.body === "string") {
      const allowFallbacks = attempt === 0 ? firstAttemptAllowFallbacks : true;
      init = { ...init, body: injectOpenRouterProvider(init.body, region, allowFallbacks) };
      attempt++;
    }
    return fetch(input, init);
  }) as typeof fetch;
}
