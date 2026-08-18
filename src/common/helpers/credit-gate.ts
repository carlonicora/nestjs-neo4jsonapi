import { HttpException, HttpStatus } from "@nestjs/common";
import { CreditValidatorInterface } from "../tokens";

/**
 * Non-throwing credit probe for background work.
 *
 * Job processors must DEFER rather than fail when a company is out of credits,
 * so they need a boolean answer. The `CREDIT_VALIDATOR` seam
 * (`common/tokens.ts`) deliberately exposes only the throwing
 * `validateCredits`, because its other consumers (HTTP controllers) want the
 * 402 to propagate. This adapts one to the other.
 *
 * Why the seam rather than injecting `CompanyService` directly: `CompanyModule`
 * declares `CompanyController`, so importing it into a processor's module
 * mounts `companies/*` into every consumer and crashes any app that replaces
 * the company foundation with its own controller (the same reasoning already
 * documented in `agents/drift/drift.module.ts`).
 *
 * Semantics:
 * - No validator bound (app never registered one) → `true`, i.e. ungated,
 *   matching the "unchanged behaviour for consumers that opt out" contract.
 * - Validator throws 402 `NO_CREDITS` → `false`, caller defers.
 * - Validator throws anything else (company lookup failed, Neo4j down, …) →
 *   RETHROWN. Those are real errors and must not be silently mistaken for an
 *   empty balance, which would defer the job forever instead of retrying it.
 * - Credits disabled (`creditCost <= 0`) → the validator is a documented no-op,
 *   so this returns `true`.
 */
export async function hasAvailableCreditsVia(
  validator: CreditValidatorInterface | undefined,
  params: { companyId: string },
): Promise<boolean> {
  if (!validator) return true;

  try {
    await validator.validateCredits({ companyId: params.companyId });
    return true;
  } catch (error) {
    if (error instanceof HttpException && error.getStatus() === HttpStatus.PAYMENT_REQUIRED) return false;
    throw error;
  }
}

/**
 * Boolean AI-capability check for background jobs.
 *
 * Fails OPEN in every uncertain case — unbound validator, unimplemented
 * method, or a thrown error — because wrongly reporting "no AI" would silently
 * drop work for a paying customer, which is unrecoverable. Wrongly reporting
 * "AI enabled" only means the credit gate downstream handles it.
 */
export async function isAiEnabledVia(
  validator: CreditValidatorInterface | undefined,
  params: { companyId: string },
): Promise<boolean> {
  if (!validator?.isAiEnabled) return true;
  try {
    return await validator.isAiEnabled({ companyId: params.companyId });
  } catch {
    return true;
  }
}
