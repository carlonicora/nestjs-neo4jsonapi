import { Injectable, Logger } from "@nestjs/common";
import { TokenAccountingCheck } from "./retrieval-eval.types";

/** Tokens may legitimately differ by rounding; anything larger is a defect. */
const TOLERANCE_TOKENS = 2;

/**
 * Cross-checks a turn's reported token aggregate against the sum of the calls
 * actually observed for it.
 *
 * Spec §6.5. The `2C + A` reducer bug inflated every archived chat figure and
 * went unnoticed for a full measurement cycle; this check is what makes the
 * same class of bug loud instead of silent. Provider-reported per-call figures
 * are the source of truth.
 */
@Injectable()
export class TokenAccountingChecker {
  private readonly logger = new Logger(TokenAccountingChecker.name);
  private observedInput = 0;
  private observedOutput = 0;

  /** Record one provider call's reported usage for the question in flight. */
  observe(params: { input: number; output: number }): void {
    this.observedInput += params.input;
    this.observedOutput += params.output;
  }

  /**
   * Clears the accumulator WITHOUT producing a verdict.
   *
   * For the question that never completed a turn: it has nothing to compare, but
   * it may still have deposited observations before it threw. Leaving them in
   * place attributes them to the NEXT question — which either invents a mismatch
   * that is not there or, worse, masks one that is. `check()` resets as a side
   * effect of comparing; this is the same reset for the path that cannot compare.
   */
  reset(): void {
    this.observedInput = 0;
    this.observedOutput = 0;
  }

  /** Compare and RESET, so the next question starts clean. */
  check(params: { questionId: string; ledger: { input: number; output: number } }): TokenAccountingCheck {
    const result: TokenAccountingCheck = {
      ledgerInput: params.ledger.input,
      observedInput: this.observedInput,
      ledgerOutput: params.ledger.output,
      observedOutput: this.observedOutput,
      agrees:
        Math.abs(params.ledger.input - this.observedInput) <= TOLERANCE_TOKENS &&
        Math.abs(params.ledger.output - this.observedOutput) <= TOLERANCE_TOKENS,
      // The comparison ran. Only this method may set it — every other producer
      // of a `TokenAccountingCheck` is describing a check that did NOT happen.
      checked: true,
    };

    if (!result.agrees) {
      this.logger.error(
        `token accounting MISMATCH on ${params.questionId}: reported ` +
          `${result.ledgerInput}/${result.ledgerOutput} but observed ` +
          `${result.observedInput}/${result.observedOutput}. The baseline is not trustworthy ` +
          `until this is explained.`,
      );
    }

    this.observedInput = 0;
    this.observedOutput = 0;
    return result;
  }
}
