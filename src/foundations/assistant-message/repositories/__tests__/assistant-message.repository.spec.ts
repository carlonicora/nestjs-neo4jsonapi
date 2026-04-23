import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClsService } from "nestjs-cls";
import { AssistantMessageRepository } from "../assistant-message.repository";
import { modelRegistry } from "../../../../common/registries/registry";

describe("AssistantMessageRepository.getNextPosition", () => {
  let repo: AssistantMessageRepository;
  let neo4j: any;

  beforeEach(() => {
    neo4j = {
      initQuery: vi.fn(() => ({ query: "", queryParams: {} })),
      readOne: vi.fn(),
      read: vi.fn(),
      writeOne: vi.fn(),
    };
    const cls = { get: vi.fn(() => "u-1") } as unknown as ClsService;
    const security = {} as any;
    repo = new AssistantMessageRepository(neo4j, security, cls);
  });

  it("returns 0 for an empty thread", async () => {
    neo4j.read.mockResolvedValue({
      records: [{ get: (k: string) => (k === "next" ? 0 : undefined) }],
    });
    const next = await repo.getNextPosition({ assistantId: "a-1" });
    expect(next).toBe(0);
  });

  it("returns the value returned by the query for a populated thread", async () => {
    neo4j.read.mockResolvedValue({
      records: [{ get: (k: string) => (k === "next" ? 7 : undefined) }],
    });
    const next = await repo.getNextPosition({ assistantId: "a-1" });
    expect(next).toBe(7);
  });

  it("unwraps Neo4j Integer-like values via toNumber()", async () => {
    const int = { toNumber: () => 42 };
    neo4j.read.mockResolvedValue({
      records: [{ get: (k: string) => (k === "next" ? int : undefined) }],
    });
    const next = await repo.getNextPosition({ assistantId: "a-1" });
    expect(next).toBe(42);
  });

  it("defaults to 0 when no records are returned", async () => {
    neo4j.read.mockResolvedValue({ records: [] });
    const next = await repo.getNextPosition({ assistantId: "a-1" });
    expect(next).toBe(0);
  });
});

describe("AssistantMessageRepository.linkReferences", () => {
  let repo: AssistantMessageRepository;
  let neo4j: any;
  let writes: Array<{ query: string; queryParams: Record<string, unknown> }>;

  beforeEach(() => {
    writes = [];
    neo4j = {
      initQuery: vi.fn(() => ({ query: "", queryParams: {} })),
      readOne: vi.fn(),
      read: vi.fn(),
      writeOne: vi.fn(async (q: any) => {
        writes.push(q);
        return null;
      }),
    };
    const cls = { get: vi.fn(() => "u-1") } as unknown as ClsService;
    const security = {} as any;
    repo = new AssistantMessageRepository(neo4j, security, cls);

    // Seed the modelRegistry with a known type so resolveLabel works.
    modelRegistry.register({
      nodeName: "account",
      labelName: "Account",
      type: "accounts",
      entity: {} as any,
      mapper: (() => ({})) as any,
    } as any);
  });

  it("issues one MERGE per known reference with reason set on the edge", async () => {
    await repo.linkReferences({
      messageId: "m-1",
      references: [{ type: "accounts", id: "acc-1", reason: "primary match" }],
    });
    expect(writes).toHaveLength(1);
    expect(writes[0].query).toContain(":Account {id: $refId}");
    expect(writes[0].query).toContain("MERGE (m)-[r:REFERENCES]->(e)");
    expect(writes[0].query).toContain("SET r.reason = $reason");
    expect(writes[0].queryParams).toMatchObject({
      messageId: "m-1",
      refId: "acc-1",
      reason: "primary match",
    });
  });

  it("skips references whose type is not in modelRegistry", async () => {
    await repo.linkReferences({
      messageId: "m-1",
      references: [{ type: "unknowns", id: "u-1", reason: "n/a" }],
    });
    expect(writes).toHaveLength(0);
  });

  it("issues the same query shape on repeat calls (MERGE is idempotent in Neo4j)", async () => {
    const refs = [{ type: "accounts", id: "acc-1", reason: "first" }];
    await repo.linkReferences({ messageId: "m-1", references: refs });
    await repo.linkReferences({ messageId: "m-1", references: refs });
    expect(writes).toHaveLength(2);
    expect(writes[0].query).toEqual(writes[1].query);
  });

  it("no-ops on an empty references array", async () => {
    await repo.linkReferences({ messageId: "m-1", references: [] });
    expect(writes).toHaveLength(0);
  });
});

describe("AssistantMessageRepository.findReferencedTypeIdPairs", () => {
  let repo: AssistantMessageRepository;
  let neo4j: any;

  beforeEach(() => {
    neo4j = {
      initQuery: vi.fn(() => ({ query: "", queryParams: {} })),
      readOne: vi.fn(),
      read: vi.fn(),
      writeOne: vi.fn(),
    };
    const cls = { get: vi.fn(() => "u-1") } as unknown as ClsService;
    repo = new AssistantMessageRepository(neo4j, {} as any, cls);

    // Seed modelRegistry so getByLabelName resolves. register() is idempotent by nodeName,
    // so running across tests is safe.
    modelRegistry.register({
      nodeName: "account",
      labelName: "Account",
      type: "accounts",
      entity: {} as any,
      mapper: (() => ({})) as any,
    } as any);
    modelRegistry.register({
      nodeName: "order",
      labelName: "Order",
      type: "orders",
      entity: {} as any,
      mapper: (() => ({})) as any,
    } as any);
  });

  it("returns {messageId, type, id} per REFERENCES edge (resolving label → JSON:API type)", async () => {
    neo4j.read.mockResolvedValue({
      records: [
        {
          get: (k: string) =>
            k === "messageId" ? "msg-1" : k === "label" ? "Account" : k === "id" ? "acc-1" : undefined,
        },
        {
          get: (k: string) =>
            k === "messageId" ? "msg-1" : k === "label" ? "Order" : k === "id" ? "ord-1" : undefined,
        },
      ],
    });
    const result = await repo.findReferencedTypeIdPairs({ messageIds: ["msg-1"] });
    expect(result).toEqual(
      expect.arrayContaining([
        { messageId: "msg-1", type: "accounts", id: "acc-1" },
        { messageId: "msg-1", type: "orders", id: "ord-1" },
      ]),
    );
    expect(neo4j.read).toHaveBeenCalledWith(
      expect.stringContaining("MATCH (m:AssistantMessage)-[:REFERENCES]->(e)"),
      expect.objectContaining({ messageIds: ["msg-1"] }),
    );
  });

  it("returns [] when no messageIds are given (no query issued)", async () => {
    const result = await repo.findReferencedTypeIdPairs({ messageIds: [] });
    expect(result).toEqual([]);
    expect(neo4j.read).not.toHaveBeenCalled();
  });

  it("silently skips records whose label isn't in the registry", async () => {
    neo4j.read.mockResolvedValue({
      records: [
        {
          get: (k: string) =>
            k === "messageId" ? "msg-1" : k === "label" ? "Account" : k === "id" ? "acc-1" : undefined,
        },
        {
          get: (k: string) =>
            k === "messageId" ? "msg-1" : k === "label" ? "Unknown" : k === "id" ? "u-1" : undefined,
        },
      ],
    });
    const result = await repo.findReferencedTypeIdPairs({ messageIds: ["msg-1"] });
    expect(result).toEqual([{ messageId: "msg-1", type: "accounts", id: "acc-1" }]);
  });
});
