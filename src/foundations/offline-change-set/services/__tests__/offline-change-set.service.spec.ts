import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { entityDescriptorRegistry } from "../../../../common/registries/entity-descriptor.registry";
import { OfflineChangeSetDescriptor } from "../../entities/offline-change-set";
import { OfflineChangeSetService } from "../offline-change-set.service";

const TYPE = "offline-spec-npcs";

const block = (id: string, text: string) => ({
  id,
  type: "paragraph",
  props: {},
  content: [{ type: "text", text, styles: {} }],
  children: [],
});

const resource = (attributes: Record<string, unknown>, relationships: Record<string, unknown> = {}) => ({
  type: TYPE,
  id: "n1",
  attributes,
  relationships,
});

const doc = (data: unknown) => ({ data });

const request = { headers: { authorization: "Bearer abc" } } as any;

type Answer = { ran: true; status: number; body: any } | { ran: false; detail: string };

describe("OfflineChangeSetService", () => {
  let run: ReturnType<typeof vi.fn>;
  let buildSingle: ReturnType<typeof vi.fn>;
  let service: OfflineChangeSetService;
  let answers: Map<string, Answer[]>;
  let stored: Map<string, any>;
  let repository: {
    findById: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    deleteOlderThan: ReturnType<typeof vi.fn>;
  };

  const answer = (method: string, path: string, value: Answer) => {
    const key = `${method} ${path}`;
    answers.set(key, [...(answers.get(key) ?? []), value]);
  };

  const apply = async (changes: unknown[]) => {
    const document: any = await service.apply({
      data: { type: "offline-change-sets", id: "pkg-1", attributes: { changes } },
      request,
    });
    return document.results as any[];
  };

  beforeEach(() => {
    answers = new Map();
    run = vi.fn(async (p: { method: string; path: string }) => {
      const queue = answers.get(`${p.method} ${p.path}`);
      if (queue && queue.length > 0) return queue.length > 1 ? queue.shift() : queue[0];
      return { ran: true, status: 200, body: doc({ type: TYPE, id: "x" }) };
    });
    buildSingle = vi.fn(async (_model: unknown, record: unknown) => record);
    stored = new Map();
    repository = {
      // As the real repository answers: the stored node through the descriptor's mapper.
      findById: vi.fn(async ({ id }: { id: string }) =>
        stored.has(id)
          ? OfflineChangeSetDescriptor.model.mapper({
              data: stored.get(id),
              record: { has: () => false, get: () => undefined },
              entityFactory: {},
            } as any)
          : null,
      ),
      create: vi.fn(async (record: { id: string }) => void stored.set(record.id, record)),
      deleteOlderThan: vi.fn(async () => undefined),
    };
    service = new OfflineChangeSetService(
      { buildSingle } as any,
      repository as any,
      { get: vi.fn() } as any,
      { run } as any,
    );
    entityDescriptorRegistry.register({
      model: { type: TYPE, endpoint: "npcs" },
      fields: {
        name: { type: "string" },
        level: { type: "number" },
        description: { type: "string", kind: { type: "richtext" } },
        url: { type: "string", transform: async () => "signed" },
        aiStatus: { type: "string" },
        summary: { type: "string" },
        tldr: { type: "string" },
        opening: { type: "string", immutable: true },
      },
      relationships: {},
    } as any);
  });

  afterEach(() => {
    entityDescriptorRegistry.unregister(TYPE);
  });

  it("answers with the change-set model, the package id and one result per change", async () => {
    await apply([{ seq: 1, method: "POST", path: "npcs", body: doc({ type: TYPE, id: "n9" }) }]);
    expect(buildSingle).toHaveBeenCalledWith(OfflineChangeSetDescriptor.model, {
      id: "pkg-1",
      results: [expect.objectContaining({ seq: 1, status: "applied" })],
    });
  });

  it("handles changes in seq order", async () => {
    const results = await apply([
      { seq: 3, method: "POST", path: "c", body: {} },
      { seq: 1, method: "POST", path: "a", body: {} },
      { seq: 2, method: "POST", path: "b", body: {} },
    ]);
    expect(run.mock.calls.map((c) => c[0].path)).toEqual(["a", "b", "c"]);
    expect(results.map((r) => r.seq)).toEqual([1, 2, 3]);
  });

  it("POST runs as sent", async () => {
    const body = doc({ type: TYPE, id: "n9", attributes: { name: "New" } });
    answer("POST", "npcs", { ran: true, status: 201, body: doc({ type: TYPE, id: "n9" }) });

    const [result] = await apply([{ seq: 1, method: "POST", path: "npcs", body }]);

    expect(run).toHaveBeenCalledWith({ method: "POST", path: "npcs", body, request });
    expect(result).toEqual({ seq: 1, status: "applied", response: doc({ type: TYPE, id: "n9" }) });
  });

  it("PATCH/PUT: reads the current record through the runner (GET on the record path), merges with base and body, injects a PATCH carrying only `changed`", async () => {
    const base = resource({
      name: "A",
      level: 1,
      description: JSON.stringify([block("b1", "one"), block("b2", "two")]),
    });
    const theirs = resource({
      name: "A",
      level: 2,
      description: JSON.stringify([block("b1", "one"), block("b2", "two (theirs)")]),
    });
    const mine = resource({
      name: "B",
      level: 1,
      description: JSON.stringify([block("b1", "one (mine)"), block("b2", "two")]),
    });
    answer("GET", "npcs/n1", { ran: true, status: 200, body: doc(theirs) });
    answer("PATCH", "npcs/n1", { ran: true, status: 200, body: doc(resource({ name: "B" })) });

    const [result] = await apply([
      { seq: 1, method: "PUT", path: "npcs/n1", body: doc(mine), recordType: TYPE, recordId: "n1", base },
    ]);

    expect(run.mock.calls[0][0]).toEqual({ method: "GET", path: "npcs/n1", request });
    const patch = run.mock.calls[1][0];
    expect(patch.method).toBe("PATCH");
    expect(patch.path).toBe("npcs/n1");
    expect(Object.keys(patch.body.data.attributes).sort()).toEqual(["description", "name"]);
    expect(patch.body.data.attributes.name).toBe("B");
    expect(JSON.parse(patch.body.data.attributes.description)).toEqual([
      block("b1", "one (mine)"),
      block("b2", "two (theirs)"),
    ]);
    expect(patch.body.data.type).toBe(TYPE);
    expect(patch.body.data.id).toBe("n1");
    expect(result).toEqual({ seq: 1, status: "applied", response: doc(resource({ name: "B" })) });
  });

  it("nothing changed → applied without a write", async () => {
    const base = resource({ name: "A" });
    answer("GET", "npcs/n1", { ran: true, status: 200, body: doc(resource({ name: "C" })) });

    const [result] = await apply([
      {
        seq: 1,
        method: "PATCH",
        path: "npcs/n1",
        body: doc(resource({ name: "A" })),
        recordType: TYPE,
        recordId: "n1",
        base,
      },
    ]);

    expect(run).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ seq: 1, status: "applied", response: doc(resource({ name: "C" })) });
  });

  it("an edit with conflicting fields is a fields conflict and writes nothing", async () => {
    answer("GET", "npcs/n1", { ran: true, status: 200, body: doc(resource({ name: "C" })) });

    const [result] = await apply([
      {
        seq: 1,
        method: "PATCH",
        path: "npcs/n1",
        body: doc(resource({ name: "B" })),
        recordType: TYPE,
        recordId: "n1",
        base: resource({ name: "A" }),
      },
    ]);

    expect(run).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      seq: 1,
      status: "conflict",
      conflict: "fields",
      current: resource({ name: "C" }),
      merged: { name: "C" },
      conflictFields: ["name"],
      conflictBlocks: {},
    });
  });

  it("an edit of a deleted record is a deleted-on-server conflict", async () => {
    answer("GET", "npcs/n1", { ran: true, status: 404, body: { message: "not found" } });

    const [result] = await apply([
      {
        seq: 1,
        method: "PATCH",
        path: "npcs/n1",
        body: doc(resource({ name: "B" })),
        recordType: TYPE,
        recordId: "n1",
        base: resource({ name: "A" }),
      },
    ]);

    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls.some((c) => c[0].method === "POST")).toBe(false);
    expect(result).toEqual({ seq: 1, status: "conflict", conflict: "deleted-on-server", current: null });
  });

  it("DELETE of a record changed since base → changed-on-server conflict; unchanged → injected", async () => {
    answer("GET", "npcs/n1", { ran: true, status: 200, body: doc(resource({ name: "Changed" })) });
    answer("GET", "npcs/n2", { ran: true, status: 200, body: doc({ ...resource({ name: "A" }), id: "n2" }) });
    answer("DELETE", "npcs/n2", { ran: true, status: 204, body: undefined });

    const results = await apply([
      { seq: 1, method: "DELETE", path: "npcs/n1", recordType: TYPE, recordId: "n1", base: resource({ name: "A" }) },
      {
        seq: 2,
        method: "DELETE",
        path: "npcs/n2",
        recordType: TYPE,
        recordId: "n2",
        base: { ...resource({ name: "A" }), id: "n2" },
      },
    ]);

    expect(results[0]).toEqual({
      seq: 1,
      status: "conflict",
      conflict: "changed-on-server",
      current: resource({ name: "Changed" }),
    });
    expect(run.mock.calls.filter((c) => c[0].method === "DELETE").map((c) => c[0].path)).toEqual(["npcs/n2"]);
    expect(results[1]).toEqual({ seq: 2, status: "applied" });
  });

  it("a DELETE after an applied edit of the same record in the package is checked against the record as that edit left it", async () => {
    const base = resource({ name: "A", description: JSON.stringify([block("b1", "one")]) });
    const edited = resource({ name: "A", description: JSON.stringify([block("b1", "one (mine)")]) });
    // GET before the edit (theirs = base), then GET before the delete (the record after the edit).
    answer("GET", "npcs/n1", { ran: true, status: 200, body: doc(base) });
    answer("GET", "npcs/n1", { ran: true, status: 200, body: doc(edited) });
    answer("PATCH", "npcs/n1", { ran: true, status: 200, body: doc(edited) });
    answer("DELETE", "npcs/n1", { ran: true, status: 204, body: undefined });

    const results = await apply([
      { seq: 1, method: "PATCH", path: "npcs/n1", body: doc(edited), recordType: TYPE, recordId: "n1", base },
      { seq: 2, method: "DELETE", path: "npcs/n1", recordType: TYPE, recordId: "n1", base },
    ]);

    expect(results[0].status).toBe("applied");
    expect(results[1]).toEqual({ seq: 2, status: "applied" });
    expect(run.mock.calls.filter((c) => c[0].method === "DELETE").map((c) => c[0].path)).toEqual(["npcs/n1"]);
  });

  it("a DELETE after an applied edit still conflicts when someone else changed the record too", async () => {
    const base = resource({ name: "A", description: JSON.stringify([block("b1", "one")]) });
    const edited = resource({ name: "A", description: JSON.stringify([block("b1", "one (mine)")]) });
    const changedByOthers = resource({ name: "Renamed", description: JSON.stringify([block("b1", "one (mine)")]) });
    answer("GET", "npcs/n1", { ran: true, status: 200, body: doc(base) });
    answer("GET", "npcs/n1", { ran: true, status: 200, body: doc(changedByOthers) });
    answer("PATCH", "npcs/n1", { ran: true, status: 200, body: doc(edited) });

    const results = await apply([
      { seq: 1, method: "PATCH", path: "npcs/n1", body: doc(edited), recordType: TYPE, recordId: "n1", base },
      { seq: 2, method: "DELETE", path: "npcs/n1", recordType: TYPE, recordId: "n1", base },
    ]);

    expect(results[1]).toEqual({ seq: 2, status: "conflict", conflict: "changed-on-server", current: changedByOthers });
    expect(run.mock.calls.filter((c) => c[0].method === "DELETE")).toEqual([]);
  });

  it("a 'mine' resolution keeps the original base: a field only the server changed is not reverted", async () => {
    answer("GET", "npcs/n1", { ran: true, status: 200, body: doc(resource({ name: "C", level: 2 })) });

    const [result] = await apply([
      {
        seq: 1,
        method: "PATCH",
        path: "npcs/n1",
        body: doc(resource({ name: "B", level: 1 })),
        recordType: TYPE,
        recordId: "n1",
        base: resource({ name: "A", level: 1 }),
        resolution: { kind: "mine" },
      },
    ]);

    const patch = run.mock.calls[1][0];
    expect(patch.method).toBe("PATCH");
    expect(patch.body.data.attributes).toEqual({ name: "B" });
    expect(result.status).toBe("applied");
  });

  it("a 'merged' resolution takes each conflicting field's choice and the merged values from mergedBody", async () => {
    answer("GET", "npcs/n1", { ran: true, status: 200, body: doc(resource({ name: "C", level: 3 })) });

    const [result] = await apply([
      {
        seq: 1,
        method: "PATCH",
        path: "npcs/n1",
        body: doc(resource({ name: "B", level: 2 })),
        recordType: TYPE,
        recordId: "n1",
        base: resource({ name: "A", level: 1 }),
        resolution: {
          kind: "merged",
          choices: { name: "merged", level: "theirs" },
          mergedBody: doc(resource({ name: "B and C" })),
        },
      },
    ]);

    expect(run.mock.calls[1][0].body.data.attributes).toEqual({ name: "B and C" });
    expect(result.status).toBe("applied");
  });

  it("a DELETE with a resolution (delete anyway) runs the DELETE without the changed-on-server check, never a PATCH", async () => {
    answer("DELETE", "npcs/n1", { ran: true, status: 204, body: undefined });

    const [result] = await apply([
      {
        seq: 1,
        method: "DELETE",
        path: "npcs/n1",
        recordType: TYPE,
        recordId: "n1",
        base: resource({ name: "A" }),
        resolution: { kind: "mine" },
      },
    ]);

    expect(run.mock.calls.map((c) => c[0].method)).toEqual(["DELETE"]);
    expect(result).toEqual({ seq: 1, status: "applied" });
  });

  it("a DELETE ignores values nobody edits (updatedAt, transformed fields such as signed URLs)", async () => {
    answer("GET", "npcs/n1", {
      ran: true,
      status: 200,
      body: doc(resource({ name: "A", url: "https://signed/2", updatedAt: "2026-11-01T10:00:00Z" })),
    });
    answer("DELETE", "npcs/n1", { ran: true, status: 204, body: undefined });

    const [result] = await apply([
      {
        seq: 1,
        method: "DELETE",
        path: "npcs/n1",
        recordType: TYPE,
        recordId: "n1",
        base: resource({ name: "A", url: "https://signed/1", updatedAt: "2026-10-01T10:00:00Z" }),
      },
    ]);

    expect(result).toEqual({ seq: 1, status: "applied" });
    expect(run.mock.calls.map((c) => c[0].method)).toEqual(["GET", "DELETE"]);
  });

  it("a DELETE ignores fields only the server writes (aiStatus, summary, tldr, immutable fields)", async () => {
    answer("GET", "npcs/n1", {
      ran: true,
      status: 200,
      body: doc(resource({ name: "A", aiStatus: "done", summary: "new", tldr: "new", opening: "new" })),
    });
    answer("DELETE", "npcs/n1", { ran: true, status: 204, body: undefined });

    const [result] = await apply([
      {
        seq: 1,
        method: "DELETE",
        path: "npcs/n1",
        recordType: TYPE,
        recordId: "n1",
        base: resource({ name: "A", aiStatus: "pending", summary: "old", tldr: "old", opening: "old" }),
      },
    ]);

    expect(result).toEqual({ seq: 1, status: "applied" });
    expect(run.mock.calls.map((c) => c[0].method)).toEqual(["GET", "DELETE"]);
  });

  it("a DELETE of a record of an unknown type still ignores aiStatus, summary and tldr", async () => {
    answer("GET", "ghosts/g1", {
      ran: true,
      status: 200,
      body: doc({ type: "ghosts", id: "g1", attributes: { name: "A", aiStatus: "done", summary: "new", tldr: "new" } }),
    });
    answer("DELETE", "ghosts/g1", { ran: true, status: 204, body: undefined });

    const [result] = await apply([
      {
        seq: 1,
        method: "DELETE",
        path: "ghosts/g1",
        recordType: "ghosts",
        recordId: "g1",
        base: { type: "ghosts", id: "g1", attributes: { name: "A", aiStatus: "pending", summary: "old", tldr: "old" } },
      },
    ]);

    expect(result).toEqual({ seq: 1, status: "applied" });
  });

  it("each apply removes the company's stored change sets older than 7 days", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-08T12:00:00Z"));
    try {
      await apply([]);
    } finally {
      vi.useRealTimers();
    }
    expect(repository.deleteOlderThan).toHaveBeenCalledWith({ before: new Date("2026-11-01T12:00:00Z") });
  });

  it("a failed clean-up never stops the package", async () => {
    repository.deleteOlderThan.mockRejectedValueOnce(new Error("neo4j down"));
    const results = await apply([{ seq: 1, method: "POST", path: "npcs", body: doc({ type: TYPE, id: "n9" }) }]);
    expect(results.map((r) => r.status)).toEqual(["applied"]);
  });

  it("a DELETE on a custom path reads the record from its own path and runs", async () => {
    answer("GET", "campaigns/c1/npcs/n1", { ran: true, status: 404, body: {} });
    answer("GET", "npcs/n1", { ran: true, status: 200, body: doc(resource({ name: "A" })) });
    answer("DELETE", "campaigns/c1/npcs/n1", { ran: true, status: 204, body: undefined });

    const [result] = await apply([
      {
        seq: 1,
        method: "DELETE",
        path: "campaigns/c1/npcs/n1",
        recordType: TYPE,
        recordId: "n1",
        base: resource({ name: "A" }),
      },
    ]);

    expect(run.mock.calls.map((c) => `${c[0].method} ${c[0].path}`)).toEqual([
      "GET npcs/n1",
      "DELETE campaigns/c1/npcs/n1",
    ]);
    expect(result).toEqual({ seq: 1, status: "applied" });
  });

  it("a custom write on <endpoint>/<id>/... waits behind a conflict of that record", async () => {
    answer("GET", "npcs/n1", { ran: true, status: 404, body: {} });

    const results = await apply([
      {
        seq: 1,
        method: "PATCH",
        path: "npcs/n1",
        body: doc(resource({ name: "B" })),
        recordType: TYPE,
        recordId: "n1",
        base: resource({ name: "A" }),
      },
      { seq: 2, method: "POST", path: "npcs/n1/activate", body: {} },
      { seq: 3, method: "POST", path: "npcs/n2/activate", body: {} },
    ]);

    expect(results.map((r) => r.status)).toEqual(["conflict", "waiting", "applied"]);
  });

  it("a package sent again with the same id is answered with the stored results and runs nothing", async () => {
    const changes = [{ seq: 1, method: "POST", path: "npcs", body: doc({ type: TYPE, id: "n9" }) }];

    const first = await apply(changes);
    expect(repository.create).toHaveBeenCalledWith({ id: "pkg-1", resultsJson: JSON.stringify(first) });
    run.mockClear();

    const second = await apply(changes);

    expect(run).not.toHaveBeenCalled();
    expect(second).toEqual(first);
    expect(repository.create).toHaveBeenCalledTimes(1);
  });

  it("a custom write (no recordType) runs as sent; a non-2xx answer → could-not-apply with the error detail", async () => {
    answer("POST", "scenes/s1/playing", { ran: true, status: 200, body: doc({ type: "scenes", id: "s1" }) });
    answer("PATCH", "campaigns/c1/merge", {
      ran: true,
      status: 400,
      body: { errors: [{ status: "400", detail: "The scene is not part of the campaign" }] },
    });

    const results = await apply([
      { seq: 1, method: "POST", path: "scenes/s1/playing", body: {} },
      { seq: 2, method: "PATCH", path: "campaigns/c1/merge", body: {} },
    ]);

    expect(results[0]).toEqual({ seq: 1, status: "applied", response: doc({ type: "scenes", id: "s1" }) });
    expect(results[1]).toEqual({
      seq: 2,
      status: "could-not-apply",
      detail: "The scene is not part of the campaign",
    });
  });

  it("a route the runner refuses is could-not-apply with its reason", async () => {
    answer("POST", "discord/post", {
      ran: false,
      detail: "POST /discord/post cannot be run from an offline change set",
    });

    const [result] = await apply([{ seq: 1, method: "POST", path: "discord/post", body: {} }]);

    expect(result).toEqual({
      seq: 1,
      status: "could-not-apply",
      detail: "POST /discord/post cannot be run from an offline change set",
    });
  });

  it("after a conflict, later changes to the same record are waiting, others continue", async () => {
    answer("GET", "npcs/n1", { ran: true, status: 404, body: {} });

    const results = await apply([
      {
        seq: 1,
        method: "PATCH",
        path: "npcs/n1",
        body: doc(resource({ name: "B" })),
        recordType: TYPE,
        recordId: "n1",
        base: resource({ name: "A" }),
      },
      {
        seq: 2,
        method: "PATCH",
        path: "npcs/n1",
        body: doc(resource({ name: "C" })),
        recordType: TYPE,
        recordId: "n1",
        base: resource({ name: "A" }),
      },
      { seq: 3, method: "POST", path: "items", body: {} },
      { seq: 4, method: "DELETE", path: "npcs/n1", recordType: TYPE, recordId: "n1", base: resource({ name: "A" }) },
    ]);

    expect(results.map((r) => r.status)).toEqual(["conflict", "waiting", "applied", "waiting"]);
    expect(results[1]).toEqual({ seq: 2, status: "waiting" });
    expect(run.mock.calls.map((c) => `${c[0].method} ${c[0].path}`)).toEqual(["GET npcs/n1", "POST items"]);
  });

  it("a runner error on one change is could-not-apply, never dropped", async () => {
    run.mockRejectedValueOnce(new Error("socket hang up"));

    const results = await apply([
      { seq: 1, method: "POST", path: "a", body: {} },
      { seq: 2, method: "POST", path: "b", body: {} },
    ]);

    expect(results[0]).toEqual({ seq: 1, status: "could-not-apply", detail: "socket hang up" });
    expect(results[1].status).toBe("applied");
  });

  it("handles every change of a large package in one call, without paging", async () => {
    const changes = Array.from({ length: 2500 }, (_, index) => ({
      seq: index + 1,
      method: "POST",
      path: "a",
      body: {},
    }));
    const results = await apply(changes);
    expect(results).toHaveLength(2500);
    expect(run).toHaveBeenCalledTimes(2500);
  });
});
