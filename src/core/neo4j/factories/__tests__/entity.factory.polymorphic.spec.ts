import { describe, it, expect, beforeEach, vi } from "vitest";
import { EntityFactory } from "../entity.factory";
import { TokenResolverService } from "../../services/token-resolver.service";
import { modelRegistry } from "../../../../common/registries/registry";
import { DataModelInterface, RelationshipInfo } from "../../../../common/interfaces/datamodel.interface";
import { PolymorphicConfig } from "../../../../common/interfaces/entity.schema.interface";

// Lightweight Neo4j record mock: behaves like neo4j-driver's `Record`
// for the few fields the factory reads (`has`, `get`, `keys`).
function makeRecord(cols: Record<string, unknown>): any {
  return {
    keys: Object.keys(cols),
    has: (k: string) => k in cols,
    get: (k: string) => cols[k],
  };
}

function makeNode(labels: string[], properties: Record<string, any>) {
  return { labels, properties };
}

// Captures which mapper was invoked so we can assert selection per row.
function trackedModel(
  nodeName: string,
  labelName: string,
  opts: {
    childrenRelationships?: RelationshipInfo[];
  } = {},
): DataModelInterface<any> {
  const mapper = vi.fn((params: { data: any; name?: string }) => {
    return {
      id: params.data.id,
      type: nodeName,
      labels: params.data.labels,
      __mappedBy: nodeName, // marker to assert which mapper ran
      [nodeName + "Props"]: { ...params.data },
    };
  });
  return {
    type: `${nodeName}s`,
    endpoint: `${nodeName}s`,
    nodeName,
    labelName,
    entity: undefined as any,
    mapper,
    childrenRelationships: opts.childrenRelationships ?? [],
    singleChildrenRelationships: [],
  };
}

describe("EntityFactory.createGraphList — polymorphic mapper selection", () => {
  let factory: EntityFactory;

  beforeEach(() => {
    // Fresh registry per test
    (modelRegistry as any).models = new Map();
    (modelRegistry as any).labelNameIndex = new Map();
    (modelRegistry as any).typeIndex = new Map();
    factory = new EntityFactory(new TokenResolverService());
  });

  it("non-polymorphic MANY relationship: uses the descriptor's target model mapper (baseline)", () => {
    const topicModel = trackedModel("topic", "Topic");
    modelRegistry.register(topicModel);

    const hostModel = trackedModel("host", "Host", {
      childrenRelationships: [{ nodeName: "topic", relationshipName: "topics" }],
    });

    const record = makeRecord({
      host: makeNode(["Host"], { id: "h1" }),
      host_topics: makeNode(["Topic"], { id: "t1", name: "Urgent" }),
    });

    const [hostEntity] = factory.createGraphList({ model: hostModel, records: [record] });

    expect(hostEntity.topics).toHaveLength(1);
    expect(hostEntity.topics[0].__mappedBy).toBe("topic");
    // Topic model's mapper was called for the child
    expect(topicModel.mapper).toHaveBeenCalledTimes(1);
  });

  it("polymorphic with discriminatorRelationship (phlow): still uses descriptor's target model mapper", () => {
    // Phlow's taxonomy case: both candidates share the :Taxonomy Neo4j label,
    // so one mapper handles them. Resolution only affects JSON:API type at
    // serialization time, not entity mapping.
    const taxonomyModel = trackedModel("taxonomy", "Taxonomy");
    modelRegistry.register(taxonomyModel);

    const poly: PolymorphicConfig = {
      candidates: [
        { type: "taxonomies", endpoint: "taxonomies", nodeName: "taxonomy", labelName: "Taxonomy" },
        { type: "leaf-taxonomies", endpoint: "leaf-taxonomies", nodeName: "leafTaxonomy", labelName: "Taxonomy" },
      ],
      discriminator: vi.fn((d: any) =>
        d.hasParent
          ? { type: "leaf-taxonomies", endpoint: "leaf-taxonomies", nodeName: "leafTaxonomy", labelName: "Taxonomy" }
          : { type: "taxonomies", endpoint: "taxonomies", nodeName: "taxonomy", labelName: "Taxonomy" },
      ),
      discriminatorRelationship: "SPECIALISES",
      discriminatorDirection: "out",
    };

    const hostModel = trackedModel("host", "Host", {
      childrenRelationships: [{ nodeName: "taxonomy", relationshipName: "taxonomies", polymorphic: poly }],
    });

    const record = makeRecord({
      host: makeNode(["Host"], { id: "h1" }),
      host_taxonomies: makeNode(["Taxonomy"], { id: "tx1", name: "TypeScript" }),
      // Simulate phlow's injected hasParent flag from the EXISTS(...-[:SPECIALISES]->())
      host_taxonomies_hasParent: true,
    });

    const [hostEntity] = factory.createGraphList({ model: hostModel, records: [record] });

    expect(hostEntity.taxonomies).toHaveLength(1);
    // Phlow uses the single (placeholder) model's mapper — discriminator runs
    // at SERIALIZE time, not map time
    expect(hostEntity.taxonomies[0].__mappedBy).toBe("taxonomy");
    expect(taxonomyModel.mapper).toHaveBeenCalledTimes(1);
    // The discriminator should NOT have been invoked during entity mapping
    // for the taxonomy (same-label) path
    expect(poly.discriminator).not.toHaveBeenCalled();
    // _hasParent flag is threaded onto the entity for the serializer to consume
    expect(hostEntity.taxonomies[0]._hasParent).toBe(true);
  });

  it("polymorphic multi-label (AssistantMessage.references): resolves model per row via discriminator", () => {
    // AssistantMessage's references: Order / Account / Person. Each has its own
    // mapper. The placeholder on the descriptor is the host itself.
    const hostModel = trackedModel("host", "Host");
    const orderModel = trackedModel("order", "Order");
    const accountModel = trackedModel("account", "Account");
    const personModel = trackedModel("person", "Person");
    modelRegistry.register(hostModel);
    modelRegistry.register(orderModel);
    modelRegistry.register(accountModel);
    modelRegistry.register(personModel);

    const poly: PolymorphicConfig = {
      candidates: [
        { type: "orders", endpoint: "orders", nodeName: "order", labelName: "Order" },
        { type: "accounts", endpoint: "accounts", nodeName: "account", labelName: "Account" },
        { type: "persons", endpoint: "persons", nodeName: "person", labelName: "Person" },
      ],
      discriminator: vi.fn((d: any) => {
        const labels: string[] = d.labels ?? [];
        if (labels.includes("Order")) return { type: "orders", endpoint: "orders", nodeName: "order", labelName: "Order" };
        if (labels.includes("Account")) return { type: "accounts", endpoint: "accounts", nodeName: "account", labelName: "Account" };
        if (labels.includes("Person")) return { type: "persons", endpoint: "persons", nodeName: "person", labelName: "Person" };
        throw new Error("unknown label");
      }),
      // No discriminatorRelationship — multi-label mode
    };

    const hostWithRefs = trackedModel("host", "Host", {
      childrenRelationships: [{ nodeName: "host", relationshipName: "references", polymorphic: poly }],
    });
    // Re-register host under the polymorphic descriptor so lookups land here
    modelRegistry.register(hostWithRefs);

    // Three rows from the flattened polymorphic OPTIONAL MATCH: one target per row.
    const records = [
      makeRecord({
        host: makeNode(["Host"], { id: "h1" }),
        host_references: makeNode(["Order"], { id: "ord-1", number: "ORD-1" }),
      }),
      makeRecord({
        host: makeNode(["Host"], { id: "h1" }),
        host_references: makeNode(["Account"], { id: "acc-1", name: "Acme" }),
      }),
      makeRecord({
        host: makeNode(["Host"], { id: "h1" }),
        host_references: makeNode(["Person"], { id: "per-1", fullName: "Ethan" }),
      }),
    ];

    const [hostEntity] = factory.createGraphList({ model: hostWithRefs, records });

    expect(hostEntity.references).toHaveLength(3);
    // Each row is mapped by its OWN model's mapper, selected by the discriminator
    const mappedBy = hostEntity.references.map((r: any) => r.__mappedBy).sort();
    expect(mappedBy).toEqual(["account", "order", "person"]);
    expect(orderModel.mapper).toHaveBeenCalledTimes(1);
    expect(accountModel.mapper).toHaveBeenCalledTimes(1);
    expect(personModel.mapper).toHaveBeenCalledTimes(1);
    // Placeholder host model's mapper was NOT used for any reference row
    // (it WAS used once for the root entity)
    expect(hostWithRefs.mapper).toHaveBeenCalledTimes(1);
    // Discriminator invoked once per row
    expect(poly.discriminator).toHaveBeenCalledTimes(3);
    // Each mapped reference carries the Order/Account/Person native props
    const order = hostEntity.references.find((r: any) => r.__mappedBy === "order");
    expect(order.orderProps.number).toBe("ORD-1");
    const account = hostEntity.references.find((r: any) => r.__mappedBy === "account");
    expect(account.accountProps.name).toBe("Acme");
    const person = hostEntity.references.find((r: any) => r.__mappedBy === "person");
    expect(person.personProps.fullName).toBe("Ethan");
  });

  it("polymorphic multi-label: falls back to placeholder mapper if the discriminator throws", () => {
    // A robustness guarantee: a bad or unknown label shouldn't crash the whole
    // query — it maps with the placeholder and the caller decides what to do.
    const hostModel = trackedModel("host", "Host", {
      childrenRelationships: [],
    });
    modelRegistry.register(hostModel);

    const poly: PolymorphicConfig = {
      candidates: [],
      discriminator: vi.fn(() => {
        throw new Error("unknown");
      }),
    };

    const hostWithRefs = trackedModel("host", "Host", {
      childrenRelationships: [{ nodeName: "host", relationshipName: "references", polymorphic: poly }],
    });
    modelRegistry.register(hostWithRefs);

    const record = makeRecord({
      host: makeNode(["Host"], { id: "h1" }),
      host_references: makeNode(["UnknownLabel"], { id: "x-1" }),
    });

    const [hostEntity] = factory.createGraphList({ model: hostWithRefs, records: [record] });

    expect(hostEntity.references).toHaveLength(1);
    // Placeholder mapper stood in because the discriminator threw
    expect(hostEntity.references[0].__mappedBy).toBe("host");
  });
});
