import { afterEach, describe, expect, it, vi } from "vitest";
import { modelRegistry } from "../../../../common/registries/registry";
import { DescriptorBasedSerialiser } from "../descriptor.based.serialiser";

/**
 * Edge fields reach JsonApiService through `edgeFields` on both cardinalities, so one rule
 * (absent when not stored, no empty meta) applies to both. A to-one relationship no longer
 * gets a generic `meta` map.
 */
const relatedModel = { type: "accounts", endpoint: "accounts", nodeName: "account", labelName: "Account" } as any;
const accountMeta = { type: "accounts", endpoint: "accounts", nodeName: "account", labelName: "Account" };

const descriptor = {
  model: { type: "persons", endpoint: "persons", nodeName: "person", labelName: "Person" },
  fields: {},
  computed: {},
  virtualFields: {},
  relationships: {
    account: {
      model: accountMeta,
      direction: "out",
      relationship: "HAS_ACCOUNT",
      cardinality: "one",
      fields: [{ name: "role", type: "string" }],
    },
    accounts: {
      model: accountMeta,
      direction: "out",
      relationship: "FOLLOWS",
      cardinality: "many",
      fields: [{ name: "since", type: "datetime" }],
    },
  },
} as any;

class PersonSerialiser extends DescriptorBasedSerialiser {
  constructor() {
    super(
      { create: vi.fn().mockReturnValue({ type: "accounts" }) } as any,
      {} as any,
      { get: vi.fn().mockReturnValue({ url: "https://api.example.com" }) } as any,
    );
    this.setDescriptor(descriptor);
  }
}

describe("DescriptorBasedSerialiser edge fields", () => {
  afterEach(() => vi.restoreAllMocks());

  it("a to-one relationship with edge fields carries edgeFields and no generic meta map", () => {
    vi.spyOn(modelRegistry, "getByType").mockReturnValue(relatedModel);

    const built: any = new PersonSerialiser().create();

    expect(built.relationships.account.edgeFields).toEqual([{ name: "role", type: "string" }]);
    expect(built.relationships.account.meta).toBeUndefined();
    expect(built.relationships.account.perItemMeta).toBeUndefined();
  });

  it("a to-many relationship keeps its per-item edge meta", () => {
    vi.spyOn(modelRegistry, "getByType").mockReturnValue(relatedModel);

    const built: any = new PersonSerialiser().create();

    expect(built.relationships.accounts).toMatchObject({
      perItemMeta: true,
      edgePropsKey: "accountsEdgeProps",
      edgeFields: [{ name: "since", type: "datetime" }],
    });
  });
});
