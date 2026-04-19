import { vi } from "vitest";
import { ChatbotService } from "../chatbot.service";

describe("ChatbotService", () => {
  const llmResponse = {
    answer: "The last order is #O1 for 100 EUR.",
    references: [{ type: "orders", id: "o1", reason: "Most recent order for Acme Corp" }],
    needsClarification: false,
    suggestedQuestions: ["What was the previous order?"],
  };
  const llmService: any = {
    call: vi.fn(async () => ({ ...llmResponse, tokenUsage: { input: 500, output: 100 } })),
  };
  const graphCatalog: any = {
    getMapFor: vi.fn((m: string[]) => (m.length ? `## Entities\n- accounts\n` : "")),
  };
  const factory: any = {};
  // capturedRecorder will point at the recorder array the service created on the most recent run().
  // Tool.build is called by the service with (ctx, recorder), so we capture it there and tests can push to it.
  let capturedRecorder: any[] = [];
  const tools = {
    describeEntity: {
      build: (_ctx: any, recorder: any[]) => {
        capturedRecorder = recorder;
        return { name: "describe_entity" };
      },
    },
    searchEntities: {
      build: (_ctx: any, recorder: any[]) => {
        capturedRecorder = recorder;
        return { name: "search_entities" };
      },
    },
    readEntity: {
      build: (_ctx: any, recorder: any[]) => {
        capturedRecorder = recorder;
        return { name: "read_entity" };
      },
    },
    traverse: {
      build: (_ctx: any, recorder: any[]) => {
        capturedRecorder = recorder;
        return { name: "traverse" };
      },
    },
  };
  const svc = new ChatbotService(
    llmService,
    graphCatalog,
    factory,
    tools.describeEntity as any,
    tools.searchEntities as any,
    tools.readEntity as any,
    tools.traverse as any,
  );

  beforeEach(() => {
    llmService.call.mockReset();
    llmService.call.mockImplementation(async () => ({ ...llmResponse, tokenUsage: { input: 500, output: 100 } }));
    graphCatalog.getMapFor.mockClear();
    capturedRecorder = [];
  });

  it("assembles system prompt with graph map and invokes LLM", async () => {
    const out = await svc.run({
      companyId: "c1",
      userId: "u1",
      userModules: ["crm"],
      messages: [{ role: "user", content: "What is the last order from Acme?" }],
    });
    expect(graphCatalog.getMapFor).toHaveBeenCalledWith(["crm"]);
    expect(llmService.call).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompts: expect.arrayContaining([expect.stringContaining("accounts")]),
        tools: expect.arrayContaining([{ name: "describe_entity" }]),
        maxToolIterations: 15,
        temperature: 0.1,
      }),
    );
    expect(out.answer).toBe("The last order is #O1 for 100 EUR.");
    expect(out.references).toHaveLength(1);
    expect(out.needsClarification).toBe(false);
    expect(out.tokens).toEqual({ input: 500, output: 100 });
  });

  it("returns clean refusal when userModules is empty", async () => {
    const out = await svc.run({
      companyId: "c1",
      userId: "u1",
      userModules: [],
      messages: [{ role: "user", content: "anything" }],
    });
    expect(out.answer).toMatch(/no accessible data|no enabled modules/i);
    expect(llmService.call).not.toHaveBeenCalled();
  });

  it("retries once when the LLM returns zero tool calls and zero references", async () => {
    const firstAttempt = {
      answer: "I cannot fulfill this request.",
      references: [],
      needsClarification: false,
      suggestedQuestions: [],
      tokenUsage: { input: 500, output: 50 },
    };
    const retry = {
      answer: "Found it.",
      references: [{ type: "accounts", id: "a1", reason: "resolved via search" }],
      needsClarification: false,
      suggestedQuestions: [],
      tokenUsage: { input: 600, output: 70 },
    };
    llmService.call.mockImplementationOnce(async () => firstAttempt).mockImplementationOnce(async () => retry);

    const out = await svc.run({
      companyId: "c1",
      userId: "u1",
      userModules: ["crm"],
      messages: [{ role: "user", content: "Tell me about Acme." }],
    });

    expect(llmService.call).toHaveBeenCalledTimes(2);
    expect(out.answer).toBe("Found it.");
    expect(out.references).toHaveLength(1);

    // First call has only the base system prompt.
    const firstCallArgs = llmService.call.mock.calls[0][0];
    expect(firstCallArgs.systemPrompts).toHaveLength(1);

    // Second call should carry the retry instruction as a second systemPrompts entry.
    const secondCallArgs = llmService.call.mock.calls[1][0];
    expect(secondCallArgs.systemPrompts).toHaveLength(2);
    expect(secondCallArgs.systemPrompts[1]).toMatch(/MUST call at least one tool/);
  });

  it("does NOT retry if the first attempt called at least one tool", async () => {
    // First attempt returns no references but the recorder got populated (simulating a tool call happened).
    llmService.call.mockImplementationOnce(async () => {
      capturedRecorder.push({ tool: "search_entities", args: {}, result: {} } as any);
      return {
        answer: "No matches found.",
        references: [],
        needsClarification: false,
        suggestedQuestions: [],
        tokenUsage: { input: 500, output: 50 },
      };
    });

    const out = await svc.run({
      companyId: "c1",
      userId: "u1",
      userModules: ["crm"],
      messages: [{ role: "user", content: "Find something." }],
    });

    expect(llmService.call).toHaveBeenCalledTimes(1);
    expect(out.answer).toBe("No matches found.");
    expect(out.toolCalls).toHaveLength(1);
  });

  it("does NOT retry if the first attempt returned references", async () => {
    llmService.call.mockImplementationOnce(async () => ({
      answer: "Here's what I found.",
      references: [{ type: "accounts", id: "a1", reason: "from prior context" }],
      needsClarification: false,
      suggestedQuestions: [],
      tokenUsage: { input: 500, output: 50 },
    }));

    const out = await svc.run({
      companyId: "c1",
      userId: "u1",
      userModules: ["crm"],
      messages: [{ role: "user", content: "Tell me about that account." }],
    });

    expect(llmService.call).toHaveBeenCalledTimes(1);
    expect(out.answer).toBe("Here's what I found.");
    expect(out.references).toHaveLength(1);
  });

  describe("taxonomy behavior (plumbing regression)", () => {
    it("T1 Identity — records search → read → traverse sequence", async () => {
      llmService.call.mockImplementationOnce(async () => {
        capturedRecorder.push({ tool: "search_entities", input: { type: "T", text: "X" }, durationMs: 5 });
        capturedRecorder.push({ tool: "read_entity", input: { type: "T", id: "id1" }, durationMs: 3 });
        capturedRecorder.push({
          tool: "traverse",
          input: { fromType: "T", fromId: "id1", relationship: "R" },
          durationMs: 4,
        });
        return {
          answer: "X is <identity narration>.",
          references: [
            { type: "T", id: "id1", reason: "Primary record the user asked about." },
            { type: "U", id: "id2", reason: "Linked record supporting the identity answer." },
          ],
          needsClarification: false,
          suggestedQuestions: [
            "What records are linked to X via <other relationship>?",
            "Show recent activity associated with X.",
            "Who else is linked to X?",
          ],
          tokenUsage: { input: 800, output: 150 },
        };
      });

      const out = await svc.run({
        companyId: "c1",
        userId: "u1",
        userModules: ["crm"],
        messages: [{ role: "user", content: "Who is X?" }],
      });

      expect(out.toolCalls.map((t) => t.tool)).toEqual(["search_entities", "read_entity", "traverse"]);
      expect(out.references).toHaveLength(2);
      expect(out.suggestedQuestions).toHaveLength(3);
      expect(out.needsClarification).toBe(false);
    });

    it("T2 Activity — records search → read → traverse (sorted) sequence", async () => {
      llmService.call.mockImplementationOnce(async () => {
        capturedRecorder.push({ tool: "search_entities", input: { type: "T", text: "X" }, durationMs: 5 });
        capturedRecorder.push({ tool: "read_entity", input: { type: "T", id: "id1" }, durationMs: 3 });
        capturedRecorder.push({
          tool: "traverse",
          input: {
            fromType: "T",
            fromId: "id1",
            relationship: "activity",
            sort: [{ field: "createdAt", direction: "desc" }],
            limit: 5,
          },
          durationMs: 6,
        });
        return {
          answer: "Recent activity for X includes 5 records; the most recent is <narration>.",
          references: [
            { type: "T", id: "id1", reason: "Parent record the user asked about." },
            { type: "A", id: "a1", reason: "Most recent related record returned by the traversal." },
          ],
          needsClarification: false,
          suggestedQuestions: [
            "Show earlier activity for X.",
            "What does <record> link to?",
            "Who else appears on X's recent records?",
          ],
          tokenUsage: { input: 900, output: 170 },
        };
      });

      const out = await svc.run({
        companyId: "c1",
        userId: "u1",
        userModules: ["crm"],
        messages: [{ role: "user", content: "What's happening with X?" }],
      });

      expect(out.toolCalls.map((t) => t.tool)).toEqual(["search_entities", "read_entity", "traverse"]);
      expect(out.references).toHaveLength(2);
      expect(out.suggestedQuestions.length).toBeGreaterThanOrEqual(3);
    });

    it("T3 Drill-down — records search → traverse sequence", async () => {
      llmService.call.mockImplementationOnce(async () => {
        capturedRecorder.push({ tool: "search_entities", input: { type: "T", text: "X" }, durationMs: 5 });
        capturedRecorder.push({
          tool: "traverse",
          input: {
            fromType: "T",
            fromId: "id1",
            relationship: "children",
            sort: [{ field: "date", direction: "desc" }],
            limit: 1,
          },
          durationMs: 4,
        });
        return {
          answer: "The last child record for X is <record summary>.",
          references: [
            { type: "T", id: "id1", reason: "Parent record the user asked about." },
            { type: "C", id: "c1", reason: "Specific child record requested by the qualifier 'last'." },
          ],
          needsClarification: false,
          suggestedQuestions: [
            "Show the previous child record for X.",
            "What other records connect to X?",
            "Who else is linked to <child>?",
          ],
          tokenUsage: { input: 700, output: 120 },
        };
      });

      const out = await svc.run({
        companyId: "c1",
        userId: "u1",
        userModules: ["crm"],
        messages: [{ role: "user", content: "Last child of X?" }],
      });

      expect(out.toolCalls.map((t) => t.tool)).toEqual(["search_entities", "traverse"]);
      expect(out.references).toHaveLength(2);
    });

    it("T4 Listing — records a single search_entities call with filters/sort", async () => {
      llmService.call.mockImplementationOnce(async () => {
        capturedRecorder.push({
          tool: "search_entities",
          input: {
            type: "T",
            filters: [{ field: "status", op: "eq", value: "open" }],
            sort: [{ field: "updatedAt", direction: "desc" }],
            limit: 10,
          },
          durationMs: 6,
        });
        return {
          answer: "Found 7 matching records; the top ones are <summary>.",
          references: [
            { type: "T", id: "id1", reason: "Top matching record for the applied filter." },
            { type: "T", id: "id2", reason: "Second matching record for the applied filter." },
          ],
          needsClarification: false,
          suggestedQuestions: [
            "Show closed records with the same filter.",
            "Sort the same list by another field.",
            "Filter by a different value on the same field.",
          ],
          tokenUsage: { input: 600, output: 110 },
        };
      });

      const out = await svc.run({
        companyId: "c1",
        userId: "u1",
        userModules: ["crm"],
        messages: [{ role: "user", content: "Show me all open records." }],
      });

      expect(out.toolCalls).toHaveLength(1);
      expect(out.toolCalls[0].tool).toBe("search_entities");
      expect(out.references.length).toBeGreaterThanOrEqual(1);
    });

    it("T5 Analytical — records multiple traversals driving a ranking", async () => {
      llmService.call.mockImplementationOnce(async () => {
        capturedRecorder.push({ tool: "search_entities", input: { type: "T" }, durationMs: 5 });
        capturedRecorder.push({
          tool: "traverse",
          input: { fromType: "T", fromId: "id1", relationship: "children" },
          durationMs: 4,
        });
        capturedRecorder.push({
          tool: "traverse",
          input: { fromType: "T", fromId: "id2", relationship: "children" },
          durationMs: 4,
        });
        capturedRecorder.push({
          tool: "traverse",
          input: { fromType: "T", fromId: "id3", relationship: "children" },
          durationMs: 4,
        });
        return {
          answer: "Among the 3 candidates, id1 has the most children (12), followed by id3 (7) and id2 (3).",
          references: [
            { type: "T", id: "id1", reason: "Top-ranked candidate by child count." },
            { type: "T", id: "id2", reason: "Candidate compared during ranking." },
            { type: "T", id: "id3", reason: "Candidate compared during ranking." },
          ],
          needsClarification: false,
          suggestedQuestions: [
            "Show the children of the top-ranked candidate.",
            "Rank the same candidates by a different relationship.",
            "Compare id1's most recent child to id3's.",
          ],
          tokenUsage: { input: 1200, output: 220 },
        };
      });

      const out = await svc.run({
        companyId: "c1",
        userId: "u1",
        userModules: ["crm"],
        messages: [{ role: "user", content: "Which T has the most children?" }],
      });

      expect(out.toolCalls.length).toBeGreaterThanOrEqual(3);
      expect(out.toolCalls.filter((c) => c.tool === "traverse").length).toBeGreaterThanOrEqual(3);
      expect(out.references.length).toBeGreaterThanOrEqual(2);
    });

    it("T6 Ambiguous — records at most one search and sets needsClarification", async () => {
      llmService.call.mockImplementationOnce(async () => {
        capturedRecorder.push({ tool: "search_entities", input: { type: "T", text: "vague" }, durationMs: 5 });
        return {
          answer: "The query matches multiple distinct records. Which one did you mean?",
          references: [
            { type: "T", id: "id1", reason: "Candidate match presented for user confirmation." },
            { type: "T", id: "id2", reason: "Candidate match presented for user confirmation." },
          ],
          needsClarification: true,
          suggestedQuestions: [],
          tokenUsage: { input: 500, output: 80 },
        };
      });

      const out = await svc.run({
        companyId: "c1",
        userId: "u1",
        userModules: ["crm"],
        messages: [{ role: "user", content: "Tell me about the thing." }],
      });

      expect(out.toolCalls.length).toBeLessThanOrEqual(1);
      expect(out.needsClarification).toBe(true);
      expect(out.suggestedQuestions).toEqual([]);
    });
  });
});
