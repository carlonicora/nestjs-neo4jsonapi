import { MembershipDescriptor } from "../membership";

describe("MembershipDescriptor", () => {
  it("is not company scoped", () => {
    expect(MembershipDescriptor.isCompanyScoped).toBe(false);
  });
});
