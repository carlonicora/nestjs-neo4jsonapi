import { GraphIndexManager } from "./graph.index.manager";

describe("GraphIndexManager", () => {
  const makeNeo4j = () => ({ writeOne: vi.fn().mockResolvedValue(undefined) });
  const makeModelService = (dims = 1536) => ({ getEmbedderDimensions: () => dims });

  it("creates a fulltext and a vector index for each chat-enabled descriptor", async () => {
    const neo4j = makeNeo4j();
    const catalog = {
      getAllChatEnabledEntities: vi.fn().mockReturnValue([
        { labelName: "Account", textSearchFields: ["name"] },
        { labelName: "Person", textSearchFields: ["first_name", "last_name"] },
      ]),
    };

    const mgr = new GraphIndexManager(neo4j as any, catalog as any, makeModelService() as any);
    await mgr.onApplicationBootstrap();

    const queries = neo4j.writeOne.mock.calls.map((c: any[]) => c[0].query as string);
    expect(queries.some((q) => q.includes("CREATE FULLTEXT INDEX `account_chat_fulltext`"))).toBe(true);
    expect(queries.some((q) => q.includes("ON EACH [n.`name`]"))).toBe(true);
    expect(queries.some((q) => q.includes("CREATE VECTOR INDEX `account_chat_embedding`"))).toBe(true);
    expect(queries.some((q) => q.includes("CREATE FULLTEXT INDEX `person_chat_fulltext`"))).toBe(true);
    expect(queries.some((q) => q.includes("ON EACH [n.`first_name`, n.`last_name`]"))).toBe(true);
    expect(queries.some((q) => q.includes("CREATE VECTOR INDEX `person_chat_embedding`"))).toBe(true);
    expect(queries.some((q) => q.includes("`vector.dimensions`: 1536"))).toBe(true);
    expect(queries.every((q) => q.includes("IF NOT EXISTS"))).toBe(true);
  });

  it("does nothing when there are no chat-enabled entities", async () => {
    const neo4j = makeNeo4j();
    const catalog = { getAllChatEnabledEntities: vi.fn().mockReturnValue([]) };

    const mgr = new GraphIndexManager(neo4j as any, catalog as any, makeModelService() as any);
    await mgr.onApplicationBootstrap();

    expect(neo4j.writeOne).not.toHaveBeenCalled();
  });

  it("skips entities with empty textSearchFields array", async () => {
    const neo4j = makeNeo4j();
    const catalog = {
      getAllChatEnabledEntities: vi.fn().mockReturnValue([{ labelName: "Empty", textSearchFields: [] }]),
    };

    const mgr = new GraphIndexManager(neo4j as any, catalog as any, makeModelService() as any);
    await mgr.onApplicationBootstrap();

    expect(neo4j.writeOne).not.toHaveBeenCalled();
  });
});
