import { describe, it, expect } from "vitest";
import { TokenAccountingChecker } from "../token-accounting.check";

describe("TokenAccountingChecker", () => {
  it("agrees when the aggregate equals the sum of observed calls", () => {
    const checker = new TokenAccountingChecker();
    checker.observe({ input: 4531, output: 167 });
    checker.observe({ input: 8296, output: 2650 });

    const result = checker.check({ questionId: "q1", ledger: { input: 12827, output: 2817 } });

    expect(result.agrees).toBe(true);
    expect(result.observedInput).toBe(12827);
  });

  it("disagrees on the 2C + A double-count shape", () => {
    const checker = new TokenAccountingChecker();
    checker.observe({ input: 52618, output: 10809 }); // contextualiser
    checker.observe({ input: 8296, output: 2650 }); // answer

    const result = checker.check({ questionId: "q1", ledger: { input: 113532, output: 24268 } });

    expect(result.agrees).toBe(false);
    expect(result.observedInput).toBe(60914);
    expect(result.ledgerInput).toBe(113532);
  });

  it("resets between questions so one turn cannot pollute the next", () => {
    const checker = new TokenAccountingChecker();
    checker.observe({ input: 100, output: 10 });
    checker.check({ questionId: "q1", ledger: { input: 100, output: 10 } });

    checker.observe({ input: 200, output: 20 });
    const second = checker.check({ questionId: "q2", ledger: { input: 200, output: 20 } });

    expect(second.agrees).toBe(true);
    expect(second.observedInput).toBe(200);
  });
});
