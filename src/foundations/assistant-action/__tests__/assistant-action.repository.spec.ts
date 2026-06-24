import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClsService } from "nestjs-cls";
import { AssistantActionRepository } from "../repositories/assistant-action.repository";
import { AssistantActionDescriptor } from "../entities/assistant-action";
import { assistantActionMeta } from "../entities/assistant-action.meta";

describe("AssistantActionRepository.resolveStatus", () => {
  let repo: AssistantActionRepository;
  let neo4j: any;
  let securityService: any;
  let issued: Array<{ query: string; queryParams: Record<string, unknown> }>;

  const makeAction = (overrides: Partial<any> = {}) => ({
    id: "act-1",
    type: assistantActionMeta.type,
    status: "approved",
    toolName: "operator_test_action",
    toolArgs: "{}",
    summary: "Do the thing",
    threadId: "asst-1:msg-1",
    userModuleIds: "[]",
    expiresAt: new Date().toISOString(),
    company: { id: "c-1" },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  // Simulates the prefix Neo4jService.initQuery() emits on every
  // authenticated request (CLS holds companyId/userId). resolveStatus MUST
  // append to it (`+=`), never overwrite it, or the `company`/`currentUser`
  // bindings consumed by buildDefaultMatch() are lost at runtime.
  const initQueryPrefix = "MATCH (company:Company {id: $companyId})\n";

  beforeEach(() => {
    issued = [];
    neo4j = {
      initQuery: vi.fn(() => ({ query: initQueryPrefix, queryParams: {} })),
      writeOne: vi.fn(async (q: any) => {
        issued.push({ query: q.query, queryParams: q.queryParams });
        return null;
      }),
      readOne: vi.fn(),
      read: vi.fn(),
    };
    const cls = { get: vi.fn(() => undefined) } as unknown as ClsService;
    // Mirrors SecurityService.userHasAccess(): it simply invokes the
    // repository's buildUserHasAccess() validator and returns its Cypher.
    securityService = {
      userHasAccess: vi.fn((params: { validator: () => string }) => params.validator()),
    };
    repo = new AssistantActionRepository(neo4j, securityService, cls);
  });

  it("returns true when the guarded update matched and the entity is returned", async () => {
    neo4j.writeOne.mockImplementationOnce(async (q: any) => {
      issued.push({ query: q.query, queryParams: q.queryParams });
      return makeAction();
    });

    const won = await repo.resolveStatus({ id: "act-1", from: "pending", to: "approved" });

    expect(won).toBe(true);
    expect(neo4j.initQuery).toHaveBeenCalledWith(
      expect.objectContaining({ serialiser: AssistantActionDescriptor.model }),
    );
    expect(issued).toHaveLength(1);
    // The initQuery() prefix (company/currentUser MATCHes) must be preserved,
    // i.e. the custom Cypher is appended (+=), never assigned over it.
    expect(issued[0].query.startsWith(initQueryPrefix)).toBe(true);
    expect(issued[0].queryParams).toMatchObject({
      searchValue: "act-1",
      from: "pending",
      to: "approved",
    });
  });

  it("returns false when the status guard does not match (no entity returned)", async () => {
    const won = await repo.resolveStatus({ id: "act-1", from: "pending", to: "denied" });
    expect(won).toBe(false);
  });

  it("guards the transition in Cypher: status = $from AND expiresAt in the future", async () => {
    await repo.resolveStatus({ id: "act-1", from: "pending", to: "approved" });

    expect(issued).toHaveLength(1);
    const { query } = issued[0];
    const { nodeName, labelName } = assistantActionMeta;
    // initQuery() prefix preserved (query appended with +=, not overwritten)
    expect(query.startsWith(initQueryPrefix)).toBe(true);
    // company-scoped default match on id
    expect(query).toContain(`MATCH (${nodeName}:${labelName} {id: $searchValue})`);
    // owner-RBAC clause injected via securityService.userHasAccess(), exactly
    // like the framework's standard read/write paths
    expect(securityService.userHasAccess).toHaveBeenCalled();
    expect(query).toContain(
      `MATCH (${nodeName})<-[:HAS_ACTION]-(:Assistant)-[:CREATED_BY]->(:User {id: $currentUserId})`,
    );
    // CAS lock acquisition: the no-op SET (acquires the node's write lock)
    // MUST appear BEFORE the status guard, otherwise the guard is
    // check-then-set and two concurrent approves can both pass it
    const lockSet = `SET ${nodeName}.updatedAt = ${nodeName}.updatedAt`;
    const guard = `WHERE ${nodeName}.status = $from AND ${nodeName}.expiresAt > datetime()`;
    expect(query).toContain(lockSet);
    expect(query).toContain(guard);
    expect(query.indexOf(lockSet)).toBeLessThan(query.indexOf(guard));
    // transition + resolution timestamps written with the Cypher datetime() function
    expect(query).toContain(`SET ${nodeName}.status = $to`);
    expect(query).toContain(`${nodeName}.resolvedAt = datetime()`);
    expect(query).toContain(`${nodeName}.updatedAt = datetime()`);
    // Cypher requires WITH between the transition SET and buildReturnStatement's
    // leading MATCH ("WITH is required between SET and MATCH" — seen live in dev)
    const transitionSet = `SET ${nodeName}.status = $to`;
    const returnMatch = `MATCH (${nodeName}:AssistantAction)-[:BELONGS_TO]->(${nodeName}_company:Company)`;
    expect(query).toContain(returnMatch);
    const withBridge = query.indexOf(`WITH ${nodeName}`, query.indexOf(transitionSet));
    expect(withBridge).toBeGreaterThan(query.indexOf(transitionSet));
    expect(withBridge).toBeLessThan(query.indexOf(returnMatch));
    // no raw temporal strings passed as parameters
    expect(Object.keys(issued[0].queryParams)).not.toContain("resolvedAt");
  });

  it("lets only one of two concurrent approve attempts win", async () => {
    // Simulate the Cypher guard: the first write matches, every later one does not.
    let matched = false;
    neo4j.writeOne.mockImplementation(async (q: any) => {
      issued.push({ query: q.query, queryParams: q.queryParams });
      if (matched) return null;
      matched = true;
      return makeAction();
    });

    const [first, second] = await Promise.all([
      repo.resolveStatus({ id: "act-1", from: "pending", to: "approved" }),
      repo.resolveStatus({ id: "act-1", from: "pending", to: "approved" }),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(issued).toHaveLength(2);
    for (const { query } of issued) {
      expect(query.startsWith(initQueryPrefix)).toBe(true);
    }
  });
});

describe("AssistantActionRepository.expireAction", () => {
  let repo: AssistantActionRepository;
  let neo4j: any;
  let issued: Array<{ query: string; queryParams: Record<string, unknown> }>;

  beforeEach(() => {
    issued = [];
    neo4j = {
      initQuery: vi.fn(() => ({ query: "", queryParams: {} })),
      writeOne: vi.fn(async (q: any) => {
        issued.push({ query: q.query, queryParams: q.queryParams });
        return null;
      }),
      readOne: vi.fn(),
      read: vi.fn(),
    };
    const cls = { get: vi.fn(() => undefined) } as unknown as ClsService;
    const securityService = {
      userHasAccess: vi.fn((params: { validator: () => string }) => params.validator()),
    } as any;
    repo = new AssistantActionRepository(neo4j, securityService, cls);
  });

  it("guards on pending status AND overdue expiresAt, scoped to the company", async () => {
    await repo.expireAction({ assistantActionId: "act-1", companyId: "c-1" });

    expect(issued).toHaveLength(1);
    const { query, queryParams } = issued[0];
    const { nodeName, labelName } = assistantActionMeta;
    // company-scoped MATCH: the action node is bound by id AND anchored to the
    // company resolved by the sweep read
    expect(query).toContain(
      `MATCH (${nodeName}:${labelName} {id: $assistantActionId})-[:BELONGS_TO]->(company:Company {id: $companyId})`,
    );
    // BOTH guard predicates: still pending AND already overdue, so a
    // concurrent approval/denial between sweep and write is never overwritten
    expect(query).toContain(`${nodeName}.status = $pendingStatus`);
    expect(query).toContain(`${nodeName}.expiresAt < datetime()`);
    // transition to expired with Cypher-side timestamps
    expect(query).toContain(`SET ${nodeName}.status = $expiredStatus`);
    expect(query).toContain(`${nodeName}.resolvedAt = datetime()`);
    expect(queryParams).toMatchObject({
      assistantActionId: "act-1",
      companyId: "c-1",
      pendingStatus: "pending",
      expiredStatus: "expired",
    });
  });
});

describe("AssistantActionRepository.findAllOverduePendingActions", () => {
  let repo: AssistantActionRepository;
  let neo4j: any;

  beforeEach(() => {
    neo4j = {
      initQuery: vi.fn(() => ({ query: "", queryParams: {} })),
      writeOne: vi.fn(),
      readOne: vi.fn(),
      read: vi.fn(async () => ({ records: [] })),
    };
    const cls = { get: vi.fn(() => undefined) } as unknown as ClsService;
    const securityService = {
      userHasAccess: vi.fn((params: { validator: () => string }) => params.validator()),
    } as any;
    repo = new AssistantActionRepository(neo4j, securityService, cls);
  });

  it("filters on pending status and overdue expiresAt", async () => {
    await repo.findAllOverduePendingActions();

    expect(neo4j.read).toHaveBeenCalledTimes(1);
    const [query, queryParams] = neo4j.read.mock.calls[0];
    const { nodeName, labelName } = assistantActionMeta;
    // pending filter is bound as a parameter on the node MATCH
    expect(query).toContain(
      `MATCH (${nodeName}:${labelName} {status: $pendingStatus})-[:BELONGS_TO]->(company:Company)`,
    );
    expect(queryParams).toMatchObject({ pendingStatus: "pending" });
    // overdue filter
    expect(query).toContain(`${nodeName}.expiresAt < datetime()`);
    // returns id + companyId pairs so each subsequent write stays company-scoped
    expect(query).toContain(`RETURN ${nodeName}.id AS assistantActionId, company.id AS companyId`);
  });

  it("maps records to assistantActionId/companyId pairs", async () => {
    neo4j.read.mockResolvedValueOnce({
      records: [
        { get: (key: string) => ({ assistantActionId: "act-1", companyId: "c-1" })[key] },
        { get: (key: string) => ({ assistantActionId: "act-2", companyId: "c-2" })[key] },
      ],
    });

    const result = await repo.findAllOverduePendingActions();

    expect(result).toEqual([
      { assistantActionId: "act-1", companyId: "c-1" },
      { assistantActionId: "act-2", companyId: "c-2" },
    ]);
  });
});
