import { beforeAll, describe, expect, it, vi } from "vitest";
import { AssistantMessageService } from "../../services/assistant-message.service";
import { AssistantMessageDescriptor } from "../../entities/assistant-message";

/**
 * In-memory-stub integration for the AssistantMessage child entity. Covers:
 * - createFromDTO linking a message to its parent Assistant
 * - findByRelated returning the thread's messages ordered by position
 * - inherited delete removing a single message
 *
 * Real owner-RBAC / company scope are enforced by AbstractRepository +
 * buildUserHasAccess and exercised in the library's framework-level tests.
 * This integration focuses on the entity's own surface area.
 */
describe("AssistantMessage lifecycle (integration, in-memory stubs)", () => {
  let service: AssistantMessageService;
  let storage: Map<string, any>;

  beforeAll(() => {
    storage = new Map();

    const repo = {
      create: vi.fn(async (params: any) => {
        storage.set(params.id, {
          id: params.id,
          type: "assistant-messages",
          ...params,
          company: { id: "c" },
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }),
      patch: vi.fn(async () => undefined),
      findById: vi.fn(async (params: any) => {
        const m = storage.get(params.id);
        if (!m) throw new Error(`Not found: ${params.id}`);
        return m;
      }),
      findByRelated: vi.fn(async (_params: any) =>
        Array.from(storage.values()).sort((a: any, b: any) => a.position - b.position),
      ),
      find: vi.fn(async () => Array.from(storage.values())),
      delete: vi.fn(async (params: any) => {
        storage.delete(params.id);
      }),
    } as any;

    const jsonApi = {
      buildSingle: vi.fn(async (_model: any, r: any) => ({
        data: { type: "assistant-messages", id: r.id, attributes: r },
      })),
      buildList: vi.fn(async (_model: any, rs: any[]) => ({
        data: rs.map((r) => ({ type: "assistant-messages", id: r.id, attributes: r })),
      })),
    } as any;

    const cls = {
      get: (k: string) => (k === "userId" ? "u-1" : k === "companyId" ? "c" : undefined),
      has: () => true,
    } as any;

    service = new AssistantMessageService(jsonApi, repo, cls);
  });

  it("creates a child message linked to an assistant via createFromDTO", async () => {
    await service.createFromDTO({
      data: {
        type: "assistant-messages",
        id: "m-1",
        attributes: { role: "user", content: "hi", position: 0 },
        relationships: {
          assistant: { data: { type: "assistants", id: "a-1" } },
        },
      },
    });
    expect(storage.get("m-1")).toBeDefined();
    expect(storage.get("m-1").role).toBe("user");
    expect(storage.get("m-1").position).toBe(0);
  });

  it("lists messages by assistant ordered by position via findByRelated", async () => {
    await service.createFromDTO({
      data: {
        type: "assistant-messages",
        id: "m-2",
        attributes: { role: "assistant", content: "hello", position: 1 },
        relationships: {
          assistant: { data: { type: "assistants", id: "a-1" } },
        },
      },
    });
    const response = await service.findByRelated({
      relationship: AssistantMessageDescriptor.relationshipKeys.assistant,
      id: "a-1",
      query: {},
    });
    expect((response as any).data.length).toBe(2);
    expect((response as any).data[0].attributes.position).toBe(0);
    expect((response as any).data[1].attributes.position).toBe(1);
  });

  it("inherited findById returns a single message", async () => {
    const response = await service.findById({ id: "m-1" });
    expect((response as any).data).toMatchObject({ type: "assistant-messages", id: "m-1" });
  });

  it("inherited delete removes a message", async () => {
    await service.delete({ id: "m-1" });
    expect(storage.has("m-1")).toBe(false);
  });
});
