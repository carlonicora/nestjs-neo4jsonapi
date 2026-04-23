import { toPermissionsJson } from "../to-permissions-json";
import { perm } from "../perm";

describe("toPermissionsJson", () => {
  it("emits all four actions in fixed order with value=false when absent", () => {
    const json = toPermissionsJson([]);
    expect(JSON.parse(json)).toEqual([
      { type: "read", value: false },
      { type: "create", value: false },
      { type: "update", value: false },
      { type: "delete", value: false },
    ]);
  });

  it("emits true for unconditional tokens", () => {
    const json = toPermissionsJson([perm.read, perm.create]);
    expect(JSON.parse(json)).toEqual([
      { type: "read", value: true },
      { type: "create", value: true },
      { type: "update", value: false },
      { type: "delete", value: false },
    ]);
  });

  it("emits path strings for scoped tokens", () => {
    const json = toPermissionsJson([perm.update("warehouse.managedBy")]);
    expect(JSON.parse(json)).toEqual([
      { type: "read", value: false },
      { type: "create", value: false },
      { type: "update", value: "warehouse.managedBy" },
      { type: "delete", value: false },
    ]);
  });

  it("unconditional wins over scoped when both present for the same action", () => {
    const json = toPermissionsJson([perm.update, perm.update("createdBy")]);
    expect(JSON.parse(json)).toMatchObject([
      expect.anything(),
      expect.anything(),
      { type: "update", value: true },
      expect.anything(),
    ]);
  });

  it("output is byte-stable for semantically equal inputs regardless of token order", () => {
    const a = toPermissionsJson([perm.read, perm.update]);
    const b = toPermissionsJson([perm.update, perm.read]);
    expect(a).toBe(b);
  });
});
