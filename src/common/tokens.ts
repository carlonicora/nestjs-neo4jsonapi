import type { ExecutionContext } from "@nestjs/common";
import type { ModelWeight } from "../core/llm/enums/model.weight";
import type { TokenUsageInterface } from "./interfaces/token.usage.interface";

/**
 * Injection tokens for common module dependencies
 *
 * NOTE: Logging is done via AppLoggingService directly, no token needed.
 */

// System roles provider token
export const SYSTEM_ROLES = Symbol("SYSTEM_ROLES");

/**
 * Interface for system roles
 */
export interface SystemRolesInterface {
  Administrator: string;
  [key: string]: string;
}

/**
 * Optional hook invoked by `JwtAuthGuard` after a request has been successfully
 * authenticated. Applications provide it to enrich the request context with
 * application-specific data (extra CLS values, membership lookups, ...) without
 * forking the guard.
 *
 * When no provider is registered the guard behaves exactly as before.
 * Errors thrown by the hook propagate to the caller (e.g. throw
 * `new HttpException("Unauthorised", 401)` to reject the request).
 */
export const AUTH_CONTEXT_HOOK = Symbol("AUTH_CONTEXT_HOOK");

/**
 * Contract implemented by an application-provided authentication context hook.
 */
export interface AuthContextHookInterface {
  onAuthenticated(params: { request: any; context: ExecutionContext }): Promise<void> | void;
}

/**
 * Optional application-provided sink for token-usage records produced INSIDE the
 * package (today: every LLM call persisted by `LLMService.persistUsage`).
 *
 * Why it exists: `LLMModule` imports the package `TokenUsageModule`, so
 * `LLMService` resolves the package `TokenUsageService` from its own module
 * context. An application that subclasses the service and aliases the class
 * token in ITS module (`{ provide: TokenUsageService, useExisting:
 * ExtendedTokenUsageService }`) does NOT change what `LLMService` gets — Nest
 * resolves per injector context — so package-side LLM calls silently bypassed
 * the app's billing logic (a360ai: no `pages` written, no allowance deducted).
 *
 * Binding this token in a `@Global()` application module redirects those writes
 * to the app's implementation. When no provider is registered, `LLMService`
 * falls back to its module-local `TokenUsageService` — i.e. today's behaviour,
 * unchanged, for every consumer that does not opt in.
 *
 * FUTURE PACKAGE CALLERS: any new package code that persists token usage MUST
 * go through this token (`@Optional() @Inject(TOKEN_USAGE_RECORDER)` with the
 * same `?? tokenUsageService` fallback) rather than injecting
 * `TokenUsageService` directly. Injecting the class re-opens the bypass this
 * seam closes. Current callers: `LLMService`, `EmbedderService` and
 * `AudioLLMService`.
 */
export const TOKEN_USAGE_RECORDER = Symbol("TOKEN_USAGE_RECORDER");

/**
 * Contract implemented by an application-provided token-usage recorder.
 *
 * Deliberately minimal — the write path only. Cost/telemetry helpers
 * (`computeCost`) stay on the package `TokenUsageService`, which every consumer
 * keeps resolving as before.
 */
export interface TokenUsageRecorderInterface {
  recordTokenUsage(params: {
    tokens: TokenUsageInterface;
    type: string;
    relationshipId: string;
    relationshipType: string;
    useVisionCosts?: boolean;
    modelWeight?: ModelWeight;
    /** When false the per-record credits floor (`minCreditsPerRecord`) is skipped — sub-cent calls (embeddings) must not be floored. Defaults to true. */
    applyMinimum?: boolean;
    /** Pre-computed cost in euros; when provided `computeCost` is skipped (embeddings: estimated tokens × the embedder rate). */
    costOverride?: number;
    /**
     * The model that served the call. Callers pricing with `costOverride`
     * (embeddings, transcription) MUST supply it — their tier is not derivable
     * from `useVisionCosts`/`modelWeight`. Everyone else omits it and the
     * recorder resolves the tier that priced the call.
     */
    model?: string;
    /** Provider that served the call. Same rule as `model`. */
    provider?: string;
  }): Promise<void>;
}

/**
 * Application-provided seam for gating AI operations on available company
 * credits. Mirrors `TOKEN_USAGE_RECORDER` above: package code that needs to
 * enforce the credit gate resolves this OPTIONAL token rather than injecting
 * `CompanyService` directly, so consumers that never register a provider see
 * unchanged (ungated) behaviour.
 *
 * `validateCredits` MUST throw `HttpException("NO_CREDITS", HttpStatus.PAYMENT_REQUIRED)`
 * when the company has no available credits, and MUST be a no-op (never throw)
 * when credits are disabled (`creditCost <= 0`).
 *
 * ## THE GATE FAILS OPEN — read this before relying on it
 *
 * Background job processors (`ChunkProcessor`, `ChunkEmbeddingProcessor`,
 * `CommunitySummariserProcessor`) consult this seam through
 * `hasAvailableCreditsVia` (`common/helpers/credit-gate.ts`), which turns the
 * throwing contract above into the non-throwing boolean a processor needs in
 * order to DEFER rather than fail. Its semantics:
 *
 * | Situation                                   | Result                                        |
 * |---------------------------------------------|-----------------------------------------------|
 * | No provider bound for `CREDIT_VALIDATOR`    | `true` — work proceeds UNGATED                 |
 * | Validator throws 402 `NO_CREDITS`           | `false` — job defers (marked `PendingCredits`) |
 * | Validator throws anything else              | rethrown — never read as an empty balance      |
 * | Credits disabled (`creditCost <= 0`)        | `true` — validator is a documented no-op       |
 *
 * The same processors also consult the OPTIONAL `isAiEnabled` method below
 * through `isAiEnabledVia` (`common/helpers/credit-gate.ts`), a separate
 * boolean check for a DIFFERENT question — not "is there balance?" but "does
 * this plan carry AI at all?". It fails OPEN on every uncertain case:
 *
 * | Situation                                   | Result                        |
 * |---------------------------------------------|--------------------------------|
 * | No provider bound for `CREDIT_VALIDATOR`    | `true` — AI treated as enabled |
 * | Validator does not implement `isAiEnabled`  | `true` — AI treated as enabled |
 * | `isAiEnabled` throws                        | `true` — AI treated as enabled |
 * | `isAiEnabled` resolves                      | its answer, as-is              |
 *
 * The first row is the dangerous one: **an application that intends to enforce
 * credits but forgets to bind this token runs entirely ungated, silently.**
 * Failing open is deliberate — it preserves behaviour for consumers that never
 * opted in — but it means the binding, not the package, is what enforces
 * billing. Any consumer enforcing credits MUST register a provider, e.g. from a
 * `@Global()` module so package-internal code can resolve it from its own
 * injector:
 *
 * ```ts
 * { provide: CREDIT_VALIDATOR, useExisting: CreditValidatorService }
 * ```
 *
 * A global registration is required rather than merely convenient: a library
 * module can never import an application feature module, so the binding has to
 * be visible application-wide.
 */
export const CREDIT_VALIDATOR = Symbol("CREDIT_VALIDATOR");

/**
 * Contract implemented by an application-provided credit validator.
 */
export interface CreditValidatorInterface {
  validateCredits(params: { companyId: string }): Promise<void>;

  /**
   * Whether the company's plan carries AI at all. OPTIONAL so existing
   * implementations keep compiling; an implementation that omits it is treated
   * as "AI enabled", matching this seam's documented unbound behaviour.
   *
   * Distinct from validateCredits: a company can have AI and no balance (defer
   * the work) or no AI at all (drop the work).
   */
  isAiEnabled?(params: { companyId: string }): Promise<boolean>;
}
