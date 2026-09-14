import { NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentMessageType } from "../../../../common/enums/agentmessage.type";
import { HandbookThreadDescriptor } from "../../entities/handbook-thread";
import { handbookThreadMeta } from "../../entities/handbook-thread.meta";
import { HandbookThreadMessageDescriptor } from "../../entities/handbook-thread-message";
import { handbookThreadMessageMeta } from "../../entities/handbook-thread-message.meta";
import { HandbookThreadService } from "../handbook-thread.service";

type Message = { id: string; role: string; content: string; position: number; sources?: string[] };

function makeResponderResponse(overrides: Record<string, any> = {}) {
  return {
    answer: {
      title: "Company filtering",
      analysis: "",
      answer: "It is injected by buildDefaultMatch().",
      questions: [],
      hasAnswer: true,
    },
    sources: [],
    ...overrides,
  };
}

function build(
  params: {
    cls?: Record<string, unknown>;
    response?: any;
    paths?: string[];
    thread?: Record<string, any>;
    priorMessages?: Message[];
    nextPosition?: number;
  } = {},
) {
  const thread = params.thread ?? { id: "thread-1", title: "Company filtering", messages: [] };

  const jsonApiService = {
    buildSingle: vi.fn(async (model: any, record: any) => ({ single: { model: model.type, record } })),
    buildList: vi.fn(async (model: any, records: any[]) => ({ list: { model: model.type, records } })),
  };

  const threads = {
    create: vi.fn(async () => undefined),
    findById: vi.fn(async () => thread),
    patch: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    touch: vi.fn(async () => undefined),
  };

  const responder = { run: vi.fn(async () => params.response ?? makeResponderResponse()) };

  const messages = { createFromDTO: vi.fn(async () => ({})) };

  const written: Message[] = [];
  const messageRepository = {
    getNextPosition: vi.fn(async () => params.nextPosition ?? 0),
    findByRelated: vi.fn(async () => params.priorMessages ?? []),
    findByIds: vi.fn(async (p: { ids: string[] }) => p.ids.map((id) => written.find((m) => m.id === id) ?? { id })),
  };

  const pages = { findPathsByChunkIds: vi.fn(async () => params.paths ?? []) };

  const clsValues: Record<string, unknown> = params.cls ?? { userId: "admin-1" };
  const clsService = { get: vi.fn((key: string) => clsValues[key]) };

  // Record what each createFromDTO wrote so findByIds can answer with it.
  messages.createFromDTO.mockImplementation(async (call: any) => {
    written.push({ id: call.data.id, ...call.data.attributes });
    return {};
  });

  const service = new HandbookThreadService(
    jsonApiService as any,
    threads as any,
    clsService as any,
    responder as any,
    messages as any,
    messageRepository as any,
    pages as any,
  );

  return { service, jsonApiService, threads, responder, messages, messageRepository, pages, clsService, written };
}

/** Every `messages.createFromDTO` payload, in call order. */
function writtenMessages(harness: ReturnType<typeof build>) {
  return harness.messages.createFromDTO.mock.calls.map(([call]: any[]) => call.data);
}

describe("HandbookThreadService.createWithFirstMessage", () => {
  let harness: ReturnType<typeof build>;

  beforeEach(() => {
    harness = build();
  });

  it("creates the thread before the messages that hang from it", async () => {
    await harness.service.createWithFirstMessage({ question: "How does company filtering work?" });

    expect(harness.threads.create).toHaveBeenCalledTimes(1);
    const [created] = harness.threads.create.mock.calls[0] as any[];
    expect(created.title).toBe("How does company filtering work?");
    expect(typeof created.id).toBe("string");
  });

  // `contextKey: "userId"` on the descriptor is what attaches CREATED_BY; the
  // service must not pass an owner of its own.
  it("takes the owner from CLS rather than from any client-supplied value", async () => {
    await harness.service.createWithFirstMessage({ question: "q" });

    const [created] = harness.threads.create.mock.calls[0] as any[];
    expect(created.owner).toBe("admin-1");
  });

  it("stores the question at position 0 and the answer at position 1", async () => {
    await harness.service.createWithFirstMessage({ question: "How does company filtering work?" });

    const [userMessage, assistantMessage] = writtenMessages(harness);

    expect(userMessage.type).toBe(handbookThreadMessageMeta.type);
    expect(userMessage.attributes).toMatchObject({
      role: "user",
      content: "How does company filtering work?",
      position: 0,
      sources: [],
    });
    expect(assistantMessage.attributes).toMatchObject({
      role: "assistant",
      content: "It is injected by buildDefaultMatch().",
      position: 1,
    });
  });

  it("attaches both messages to the thread it just created", async () => {
    await harness.service.createWithFirstMessage({ question: "q" });

    const threadId = (harness.threads.create.mock.calls[0] as any[])[0].id;
    for (const message of writtenMessages(harness)) {
      expect(message.relationships.thread).toEqual({ data: { type: handbookThreadMeta.type, id: threadId } });
    }
  });

  it("titles the thread from the answer", async () => {
    await harness.service.createWithFirstMessage({ question: "How does company filtering work?" });

    expect(harness.threads.patch).toHaveBeenCalledTimes(1);
    const [patched] = harness.threads.patch.mock.calls[0] as any[];
    expect(patched.title).toBe("Company filtering");
  });

  it("falls back to the question, cut on a word boundary, when the answer has no title", async () => {
    const noTitle = build({
      response: makeResponderResponse({ answer: { title: "", answer: "text", questions: [], hasAnswer: true } }),
    });
    const question =
      "How does the framework inject company filtering into every repository query without a developer asking for it?";

    await noTitle.service.createWithFirstMessage({ question });

    const [created] = noTitle.threads.create.mock.calls[0] as any[];
    expect(created.title).toBe("How does the framework inject company filtering into every");
    expect(created.title.length).toBeLessThanOrEqual(60);
    expect(question.startsWith(created.title)).toBe(true);
    expect(noTitle.threads.patch).not.toHaveBeenCalled();
  });

  it("keeps a short question whole as the fallback title", async () => {
    const noTitle = build({
      response: makeResponderResponse({ answer: { title: "", answer: "text", questions: [], hasAnswer: true } }),
    });

    await noTitle.service.createWithFirstMessage({ question: "  What is a chunk?  " });

    expect((noTitle.threads.create.mock.calls[0] as any[])[0].title).toBe("What is a chunk?");
  });

  it("runs the responder in handbook mode with no history on the opening turn", async () => {
    await harness.service.createWithFirstMessage({ question: "q" });

    expect(harness.responder.run).toHaveBeenCalledTimes(1);
    const [call] = harness.responder.run.mock.calls[0] as any[];
    expect(call.dataLimits).toEqual({ handbookMode: true });
    expect(call.messages).toEqual([]);
    expect(call.question).toBe("q");
    expect(call.userModuleIds).toEqual([]);
  });

  // The whole reason this is not the package Assistant: a platform
  // administrator has no Company. The turn must run anyway — no throw, no
  // substituted company.
  it("passes an undefined companyId through for a platform administrator", async () => {
    await harness.service.createWithFirstMessage({ question: "q" });

    const [call] = harness.responder.run.mock.calls[0] as any[];
    expect(call.companyId).toBeUndefined();
    expect(call.userId).toBe("admin-1");
  });

  it("collapses an empty-string companyId to undefined", async () => {
    const empty = build({ cls: { companyId: "", userId: "admin-1" } });

    await empty.service.createWithFirstMessage({ question: "q" });

    expect((empty.responder.run.mock.calls[0] as any[])[0].companyId).toBeUndefined();
  });

  it("answers with the thread and its messages, not a bare id", async () => {
    const result = await harness.service.createWithFirstMessage({ question: "q" });

    const [model, record] = harness.jsonApiService.buildSingle.mock.calls.at(-1) as any[];
    expect(model).toBe(HandbookThreadDescriptor.model);
    expect(record.id).toBe("thread-1");
    expect(record.messages).toBeDefined();
    expect(result).toMatchObject({ single: { model: handbookThreadMeta.type } });
  });
});

describe("HandbookThreadService — sources", () => {
  it("stores the page paths of the cited chunks on the assistant message", async () => {
    const harness = build({
      response: makeResponderResponse({
        sources: [
          { chunkId: "chunk-a", relevance: 1, reason: "" },
          { chunkId: "chunk-b", relevance: 1, reason: "" },
        ],
      }),
      paths: ["03-backend/module-anatomy.md", "04-frontend/feature-anatomy.md"],
    });

    await harness.service.createWithFirstMessage({ question: "q" });

    expect(harness.pages.findPathsByChunkIds).toHaveBeenCalledWith({ chunkIds: ["chunk-a", "chunk-b"] });
    const [, assistantMessage] = writtenMessages(harness);
    expect(assistantMessage.attributes.sources).toEqual([
      "03-backend/module-anatomy.md",
      "04-frontend/feature-anatomy.md",
    ]);
  });

  it("deduplicates paths and preserves citation order", async () => {
    const harness = build({
      response: makeResponderResponse({
        sources: [
          { chunkId: "c1", relevance: 1, reason: "" },
          { chunkId: "c2", relevance: 1, reason: "" },
          { chunkId: "c3", relevance: 1, reason: "" },
        ],
      }),
      paths: ["b.md", "a.md", "b.md"],
    });

    await harness.service.createWithFirstMessage({ question: "q" });

    expect(writtenMessages(harness)[1].attributes.sources).toEqual(["b.md", "a.md"]);
  });

  // A chunk whose page cannot be resolved never comes back from the repository;
  // it must never be rendered as an empty source.
  it("never stores an empty string for an unresolvable chunk", async () => {
    const harness = build({
      response: makeResponderResponse({
        sources: [
          { chunkId: "orphan", relevance: 1, reason: "" },
          { chunkId: "c2", relevance: 1, reason: "" },
        ],
      }),
      paths: ["a.md"],
    });

    await harness.service.createWithFirstMessage({ question: "q" });

    const sources = writtenMessages(harness)[1].attributes.sources;
    expect(sources).toEqual(["a.md"]);
    expect(sources).not.toContain("");
  });

  it("asks for no paths at all when the answer cited nothing", async () => {
    const harness = build();

    await harness.service.createWithFirstMessage({ question: "q" });

    expect(harness.pages.findPathsByChunkIds).toHaveBeenCalledWith({ chunkIds: [] });
    expect(writtenMessages(harness)[1].attributes.sources).toEqual([]);
  });
});

describe("HandbookThreadService.appendMessage", () => {
  const priorMessages: Message[] = [
    { id: "m-0", role: "user", content: "How does company filtering work?", position: 0 },
    { id: "m-1", role: "assistant", content: "It is injected.", position: 1, sources: ["a.md"] },
  ];

  it("replays the thread's prior messages as history, oldest first", async () => {
    const harness = build({ priorMessages: [...priorMessages].reverse(), nextPosition: 2 });

    await harness.service.appendMessage({ threadId: "thread-1", question: "And for a global entity?" });

    const [call] = harness.responder.run.mock.calls[0] as any[];
    expect(call.messages).toEqual([
      { type: AgentMessageType.User, content: "How does company filtering work?" },
      { type: AgentMessageType.Assistant, content: "It is injected." },
    ]);
    expect(call.question).toBe("And for a global entity?");
    expect(call.dataLimits).toEqual({ handbookMode: true });
  });

  it("loads the history from the thread it was asked about", async () => {
    const harness = build({ priorMessages, nextPosition: 2 });

    await harness.service.appendMessage({ threadId: "thread-1", question: "q" });

    expect(harness.messageRepository.findByRelated).toHaveBeenCalledWith({
      relationship: HandbookThreadMessageDescriptor.relationshipKeys.thread,
      id: "thread-1",
      fetchAll: true,
      orderBy: "position ASC",
    });
  });

  it("continues the numbering from the thread's highest position", async () => {
    const harness = build({ priorMessages, nextPosition: 2 });

    await harness.service.appendMessage({ threadId: "thread-1", question: "And for a global entity?" });

    const [userMessage, assistantMessage] = writtenMessages(harness);
    expect(userMessage.attributes).toMatchObject({ role: "user", position: 2 });
    expect(assistantMessage.attributes).toMatchObject({ role: "assistant", position: 3 });
  });

  // Owner gate: the read happens before anything is written.
  it("refuses to write into a thread the caller cannot read", async () => {
    const harness = build();
    harness.threads.findById.mockRejectedValueOnce(Object.assign(new Error("Forbidden"), { status: 403 }));

    await expect(harness.service.appendMessage({ threadId: "thread-1", question: "q" })).rejects.toThrow("Forbidden");
    expect(harness.messages.createFromDTO).not.toHaveBeenCalled();
    expect(harness.responder.run).not.toHaveBeenCalled();
  });

  it("treats an unknown thread as absent", async () => {
    const harness = build();
    harness.threads.findById.mockResolvedValueOnce(null as any);

    await expect(harness.service.appendMessage({ threadId: "nope", question: "q" })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("bumps the thread so it rises to the top of the list", async () => {
    const harness = build({ priorMessages, nextPosition: 2 });

    await harness.service.appendMessage({ threadId: "thread-1", question: "q" });

    expect(harness.threads.touch).toHaveBeenCalledWith({ id: "thread-1" });
  });

  it("answers with the two new messages, in position order", async () => {
    const harness = build({ priorMessages, nextPosition: 2 });

    const result = await harness.service.appendMessage({ threadId: "thread-1", question: "q" });

    const [model, records] = harness.jsonApiService.buildList.mock.calls[0] as any[];
    expect(model).toBe(HandbookThreadMessageDescriptor.model);
    expect(records.map((r: Message) => r.role)).toEqual(["user", "assistant"]);
    expect(records.map((r: Message) => r.position)).toEqual([2, 3]);
    expect(result).toEqual({ list: { model: handbookThreadMessageMeta.type, records } });
  });
});

describe("HandbookThreadService — reads, renames and deletes", () => {
  it("returns a thread's messages in position order regardless of traversal order", async () => {
    const harness = build({
      thread: {
        id: "thread-1",
        title: "t",
        messages: [
          { id: "m-2", role: "assistant", content: "b", position: 3 },
          { id: "m-0", role: "user", content: "a", position: 0 },
          { id: "m-1", role: "assistant", content: "c", position: 1 },
        ],
      },
    });

    await harness.service.findThreadWithMessages({ threadId: "thread-1" });

    const [, record] = harness.jsonApiService.buildSingle.mock.calls[0] as any[];
    expect(record.messages.map((m: Message) => m.position)).toEqual([0, 1, 3]);
  });

  it("refuses to read a thread the caller does not own", async () => {
    const harness = build();
    harness.threads.findById.mockResolvedValueOnce(null as any);

    await expect(harness.service.findThreadWithMessages({ threadId: "thread-1" })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  // AbstractRepository.patch matches on id alone — it never applies
  // buildUserHasAccess. Without the read first, one administrator could rename
  // another's thread and merely be refused the response.
  it("checks ownership BEFORE writing a rename", async () => {
    const harness = build();
    const order: string[] = [];
    harness.threads.findById.mockImplementation(async () => {
      order.push("read");
      return { id: "thread-1", title: "t", messages: [] };
    });
    harness.threads.patch.mockImplementation(async () => {
      order.push("write");
    });

    await harness.service.patch({ id: "thread-1", title: "Renamed" });

    expect(order[0]).toBe("read");
    expect(order).toContain("write");
  });

  it("does not rename a thread the caller cannot read", async () => {
    const harness = build();
    harness.threads.findById.mockResolvedValueOnce(null as any);

    await expect(harness.service.patch({ id: "thread-1", title: "Renamed" })).rejects.toBeInstanceOf(NotFoundException);
    expect(harness.threads.patch).not.toHaveBeenCalled();
  });

  // The inherited AbstractService.delete compares `(companyId ?? "")` against
  // `entity.company?.id`. For a company-less entity and a company-less user
  // that is `"" !== undefined` — always true — so every delete would 403.
  it("deletes an owned thread instead of 403-ing on a company that does not exist", async () => {
    const harness = build();

    await harness.service.delete({ id: "thread-1" });

    expect(harness.threads.findById).toHaveBeenCalledWith({ id: "thread-1" });
    expect(harness.threads.delete).toHaveBeenCalledWith({ id: "thread-1" });
  });

  it("does not delete a thread the caller cannot read", async () => {
    const harness = build();
    harness.threads.findById.mockResolvedValueOnce(null as any);

    await expect(harness.service.delete({ id: "thread-1" })).rejects.toBeInstanceOf(NotFoundException);
    expect(harness.threads.delete).not.toHaveBeenCalled();
  });
});

describe("HandbookThreadService — page-scoped ask", () => {
  it("restricts retrieval to one page when handbookPageId is supplied", async () => {
    const harness = build();

    await harness.service.createWithFirstMessage({
      question: "How do migrations run?",
      handbookPageId: "page-1",
    });

    expect(harness.responder.run).toHaveBeenCalledWith(
      expect.objectContaining({
        dataLimits: { handbookMode: true, limitToHandbookPageId: "page-1" },
      }),
    );
  });

  it("leaves retrieval across the whole handbook when it is not supplied", async () => {
    const harness = build();

    await harness.service.createWithFirstMessage({ question: "How do migrations run?" });

    expect(harness.responder.run).toHaveBeenCalledWith(
      expect.objectContaining({
        dataLimits: { handbookMode: true, limitToHandbookPageId: undefined },
      }),
    );
  });

  it("carries the page scope through a follow-up question", async () => {
    const harness = build({ nextPosition: 2 });

    await harness.service.appendMessage({
      threadId: "thread-1",
      question: "And for a global entity?",
      handbookPageId: "page-1",
    });

    expect(harness.responder.run).toHaveBeenCalledWith(
      expect.objectContaining({
        dataLimits: { handbookMode: true, limitToHandbookPageId: "page-1" },
      }),
    );
  });
});
