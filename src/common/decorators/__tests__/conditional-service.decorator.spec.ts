import { Inject, Injectable, Optional } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { APP_MODE_TOKEN, createApiProvider, createWorkerProvider } from "../conditional-service.decorator";

const OPTIONAL_SEAM = Symbol("OPTIONAL_SEAM");

class RequiredDep {}

@Injectable()
class WithOptionalSeam {
  constructor(
    readonly required: RequiredDep,
    @Optional() @Inject(OPTIONAL_SEAM) readonly seam?: { validate(): void },
  ) {}
}

@Injectable()
class WithoutOptionalSeam {
  constructor(readonly required: RequiredDep) {}
}

/**
 * Regression guard. `createConditionalProvider` builds a FACTORY provider, and a
 * factory's `inject` array expresses optionality as `{ token, optional: true }`
 * — a bare token is always required. Before this was handled, `@Optional()` was
 * silently dropped when a class was wrapped by `createWorkerProvider`, so any
 * consumer that did NOT bind the seam crashed at boot with
 * `UnknownDependenciesException`. Consumers that DID bind it resolved fine,
 * which is why the bug could not be caught by those apps' test suites.
 */
describe("createConditionalProvider — @Optional() propagation", () => {
  it("marks an @Optional() @Inject() parameter as optional in the factory inject array", () => {
    const provider = createWorkerProvider(WithOptionalSeam) as { inject: unknown[] };

    // inject[0] is always APP_MODE_TOKEN; constructor params follow in order.
    expect(provider.inject[0]).toBe(APP_MODE_TOKEN);
    expect(provider.inject[1]).toBe(RequiredDep);
    expect(provider.inject[2]).toEqual({ token: OPTIONAL_SEAM, optional: true });
  });

  it("leaves required parameters as bare tokens", () => {
    const provider = createApiProvider(WithoutOptionalSeam) as { inject: unknown[] };

    expect(provider.inject).toEqual([APP_MODE_TOKEN, RequiredDep]);
  });

  it("still resolves the custom @Inject() token, not the reflected design type", () => {
    const provider = createWorkerProvider(WithOptionalSeam) as { inject: unknown[] };

    // Without self:paramtypes handling this would be Object (the erased type).
    expect(provider.inject[2]).not.toBe(Object);
  });
});
