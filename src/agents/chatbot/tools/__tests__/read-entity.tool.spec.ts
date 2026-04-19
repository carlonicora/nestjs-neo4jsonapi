import { ReadEntityTool } from "../read-entity.tool";

describe("ReadEntityTool", () => {
  const accounts = {
    type: "accounts",
    module: "crm",
    description: "A",
    fields: [{ name: "name", type: "string" }],
    nodeName: "account",
    labelName: "Account",
    relationships: [
      {
        name: "orders",
        targetType: "orders",
        cardinality: "many",
        description: "x",
        cypherDirection: "out",
        cypherLabel: "PLACED",
        isReverse: false,
        sourceType: "accounts",
      },
    ],
    summary: (d: any) => d.name,
  };
  const ctx = { companyId: "c", userId: "u", userModules: ["crm", "sales"] };
  const svc = { findRecordById: vi.fn(async () => ({ id: "a1", name: "Acme" })) };
  const factory: any = {
    resolveEntity: (t: string) => (t === "accounts" ? accounts : { error: "nope" }),
    resolveService: () => svc,
    capture: async (_r: any, fn: any, rec: any[]) => {
      const v = await fn();
      rec.push({});
      return v;
    },
  };

  it("reads entity by id and returns described fields only", async () => {
    const tool = new ReadEntityTool(factory);
    const out: any = await tool.invoke({ type: "accounts", id: "a1" }, ctx, [
      { tool: "describe_entity", input: { type: "accounts" }, durationMs: 0 },
    ]);
    expect(out).toMatchObject({ id: "a1", type: "accounts", fields: { name: "Acme" } });
  });

  it("rejects include for undescribed relationship", async () => {
    const tool = new ReadEntityTool(factory);
    const out: any = await tool.invoke({ type: "accounts", id: "a1", include: ["ghost"] }, ctx, [
      { tool: "describe_entity", input: { type: "accounts" }, durationMs: 0 },
    ]);
    expect(out.error).toMatch(/ghost/);
  });
});
