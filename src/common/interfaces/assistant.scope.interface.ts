/**
 * Assistant scope hooks: app-provided behaviour for assistant threads bound
 * to a piece of content.
 *
 * Both tokens are optional. When unbound, assistant turns and bind requests
 * behave exactly as before. Bind them from a `@Global()` application module so
 * the AssistantModule, which imports no app modules, can resolve them.
 */
import { DataLimits } from "../types/data.limits";

/**
 * Parameters handed to the scope hooks for the content a thread is bound to.
 */
export interface AssistantBoundContentParams {
  /** Module/entity type of the bound content. */
  type: string;
  /** Identifier of the bound content. */
  id: string;
  userId: string;
  companyId: string;
}

/**
 * Contract implemented by an application-provided data limits provider.
 *
 * Its result is merged into the `dataLimits` of every turn of a bound thread.
 */
export interface AssistantDataLimitsProvider {
  forBoundContent(params: AssistantBoundContentParams): Promise<Partial<DataLimits>>;
}

/**
 * Optional injection token resolving to an AssistantDataLimitsProvider.
 * When unbound, bound turns run with the default data limits.
 */
export const ASSISTANT_DATA_LIMITS_PROVIDER = Symbol("ASSISTANT_DATA_LIMITS_PROVIDER");

/**
 * Contract implemented by an application-provided bind guard.
 *
 * Return false to refuse binding the thread to the content (HTTP 403).
 */
export interface AssistantBindGuard {
  canBind(params: AssistantBoundContentParams): Promise<boolean>;
}

/**
 * Optional injection token resolving to an AssistantBindGuard.
 * When unbound, every bind request is accepted as before.
 */
export const ASSISTANT_BIND_GUARD = Symbol("ASSISTANT_BIND_GUARD");
