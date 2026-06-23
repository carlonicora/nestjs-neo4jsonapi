import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readdir } from "fs/promises";
import { join } from "path";
import { LLMCallDumper } from "../llm-call-dumper.service";

async function waitForFile(dir: string, timeoutMs: number): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const subs = await readdir(dir);
      for (const sub of subs) {
        const inner = await readdir(join(dir, sub));
        if (inner.length > 0) return join(dir, sub, inner[0]);
      }
    } catch {
      // dir may not exist yet
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  return null;
}

describe("LLMCallDumper", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    delete process.env.ASSISTANT_DUMP_LLM_CALLS;
    delete process.env.ASSISTANT_DUMP_LLM_CALLS_DIR;
    delete process.env.ASSISTANT_DUMP_LLM_REDACT;
    delete process.env.ASSISTANT_DUMP_LLM_KEEP_FIELDS;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  describe("when ASSISTANT_DUMP_LLM_CALLS is unset", () => {
    it("startSession returns a no-op session that ignores all calls", () => {
      const dumper = new LLMCallDumper(null as any);
      const session = dumper.startSession({
        metadata: { nodeName: "graph", agentName: "responder" },
        model: "gemini-2.5-pro",
        provider: "requesty",
        temperature: 0.1,
      });

      expect(session.isEnabled).toBe(false);
      // None of these should throw or do work:
      session.recordInputs({
        systemPrompts: ["x"],
        instructions: "y",
        inputParams: { q: "z" },
        history: [],
        tools: [],
        outputSchemaName: "S",
      });
      session.startIteration("tool-loop", []);
      session.recordResponse({ content: "" });
      session.recordToolResult("call_1", "tool", "result");
      session.close({ finalStatus: "success", totalTokens: { input: 0, output: 0 } });
    });
  });

  describe("when ASSISTANT_DUMP_LLM_CALLS is set to 1", () => {
    beforeEach(() => {
      process.env.ASSISTANT_DUMP_LLM_CALLS = "1";
    });

    it("startSession returns an enabled session", () => {
      const dumper = new LLMCallDumper(null as any);
      const session = dumper.startSession({
        metadata: { nodeName: "graph", agentName: "responder" },
        model: "gemini-2.5-pro",
        provider: "requesty",
        temperature: 0.1,
      });

      expect(session.isEnabled).toBe(true);
    });

    it("records inputs, iterations, responses, and tool results in order", async () => {
      const tmp = `${process.cwd()}/.tmp-dumper-test-${Date.now()}`;
      process.env.ASSISTANT_DUMP_LLM_CALLS_DIR = tmp;

      const { LLMCallDumper } = await import("../llm-call-dumper.service");
      const dumper = new LLMCallDumper(null as any);
      const session: any = dumper.startSession({
        metadata: { nodeName: "graph", agentName: "responder", userQuestion: "Q" },
        model: "gemini-2.5-pro",
        provider: "requesty",
        temperature: 0.1,
      });

      session.recordInputs({
        systemPrompts: ["sys-prompt"],
        instructions: "instr",
        inputParams: { question: "Q" },
        history: [{ role: "user", content: "hi" }],
        tools: [{ name: "resolve_entity", description: "d", schema: {} }],
        outputSchemaName: "graphOutputSchema",
      });

      session.startIteration("tool-loop", [
        { _getType: () => "system", content: "S" },
        { _getType: () => "human", content: "H" },
      ]);
      session.recordResponse({
        content: "",
        toolCalls: [{ id: "call_1", name: "read_entity", args: { id: "x" } }],
        tokenUsage: { input: 100, output: 50 },
        finishReason: "tool_calls",
      });
      session.recordToolResult("call_1", "read_entity", '{"error":"missing schema"}');

      session.startIteration("final-structured", []);
      session.recordResponse({
        content: '{"answer":"yes"}',
        tokenUsage: { input: 50, output: 20 },
        finishReason: "stop",
      });

      // Inspect in-memory state via the new debug accessor.
      const snap = session.__snapshot();
      expect(snap.iterations).toHaveLength(2);
      expect(snap.iterations[0].kind).toBe("tool-loop");
      expect(snap.iterations[0].sentMessages.map((m: any) => m.role)).toEqual(["system", "user"]);
      expect(snap.iterations[0].response.toolCalls).toHaveLength(1);
      expect(snap.iterations[0].toolResults).toHaveLength(1);
      expect(snap.iterations[0].toolResults[0].tool).toBe("read_entity");
      expect(snap.iterations[1].kind).toBe("final-structured");
    });

    it("close() writes a JSON file with meta + inputs + iterations", async () => {
      const fs = await import("fs/promises");
      const path = await import("path");
      const tmp = path.join(process.cwd(), `.tmp-dumper-test-${Date.now()}`);
      process.env.ASSISTANT_DUMP_LLM_CALLS_DIR = tmp;

      const { LLMCallDumper } = await import("../llm-call-dumper.service");
      const dumper = new LLMCallDumper(null as any);
      const session = dumper.startSession({
        metadata: { nodeName: "graph", agentName: "responder", userQuestion: "Q" },
        model: "gemini-2.5-pro",
        provider: "requesty",
        temperature: 0.1,
      });

      session.recordInputs({
        systemPrompts: ["sys"],
        instructions: "i",
        inputParams: { q: "Q" },
        history: [],
        tools: [],
        outputSchemaName: "S",
      });
      session.startIteration("final-structured", [{ _getType: () => "system", content: "S" }]);
      session.recordResponse({ content: "{}", tokenUsage: { input: 1, output: 2 } });
      session.close({ finalStatus: "success", totalTokens: { input: 1, output: 2 } });

      const found = await waitForFile(tmp, 2000);
      expect(found).toBeTruthy();

      const json = JSON.parse(await fs.readFile(found!, "utf8"));
      expect(json.meta.nodeName).toBe("graph");
      expect(json.meta.userQuestion).toBe("Q");
      expect(json.meta.finalStatus).toBe("success");
      expect(json.meta.totalTokens).toEqual({ input: 1, output: 2 });
      expect(json.inputs.systemPrompts).toEqual(["sys"]);
      expect(json.iterations).toHaveLength(1);
      expect(json.iterations[0].kind).toBe("final-structured");

      await fs.rm(tmp, { recursive: true, force: true });
    });

    it("close() with finalStatus=error writes errorMessage and errorStack", async () => {
      const fs = await import("fs/promises");
      const path = await import("path");
      const tmp = path.join(process.cwd(), `.tmp-dumper-test-${Date.now()}`);
      process.env.ASSISTANT_DUMP_LLM_CALLS_DIR = tmp;

      const { LLMCallDumper } = await import("../llm-call-dumper.service");
      const dumper = new LLMCallDumper(null as any);
      const session = dumper.startSession({
        metadata: { nodeName: "planner", agentName: "responder" },
        model: "m",
        provider: "p",
      });
      session.close({
        finalStatus: "error",
        errorMessage: "boom",
        errorStack: "at foo (bar.ts:1:1)",
        totalTokens: { input: 0, output: 0 },
      });

      const found = await waitForFile(tmp, 2000);
      const json = JSON.parse(await fs.readFile(found!, "utf8"));
      expect(json.meta.finalStatus).toBe("error");
      expect(json.meta.errorMessage).toBe("boom");
      expect(json.meta.errorStack).toMatch(/at foo/);

      await fs.rm(tmp, { recursive: true, force: true });
    });

    describe("redaction (ASSISTANT_DUMP_LLM_REDACT)", () => {
      const SECRET_MESSAGE = "SUPER_SECRET_USER_MESSAGE_42";
      const SECRET_HISTORY = "SECRET_HISTORY_CONTENT_99";

      async function writeDump(tmp: string) {
        const { LLMCallDumper } = await import("../llm-call-dumper.service");
        const dumper = new LLMCallDumper(null as any);
        const session = dumper.startSession({
          metadata: {
            nodeName: "graph",
            agentName: "responder",
            gameId: "game-abc",
            roundId: "round-xyz",
            userId: "user-123",
          } as any,
          model: "m",
          provider: "p",
        });
        session.recordInputs({
          systemPrompts: ["ordinary system prompt", "You must respect consent and ethical boundaries at all times."],
          instructions: "instr",
          inputParams: { userMessage: SECRET_MESSAGE, locale: "en" },
          history: [{ role: "user", content: SECRET_HISTORY }],
          tools: [],
          outputSchemaName: "S",
          metadata: { gameId: "game-abc", roundId: "round-xyz", userId: "user-123" },
        } as any);
        session.startIteration("final-structured", [{ _getType: () => "system", content: "S" }]);
        session.recordResponse({ content: SECRET_MESSAGE, tokenUsage: { input: 1, output: 2 } });
        session.close({ finalStatus: "success", totalTokens: { input: 1, output: 2 } });

        const found = await waitForFile(tmp, 2000);
        expect(found).toBeTruthy();
        const fs = await import("fs/promises");
        const raw = await fs.readFile(found!, "utf8");
        return { raw, json: JSON.parse(raw) };
      }

      it("redacts userMessage, history content and policy systemPrompts; raw secret appears nowhere", async () => {
        const path = await import("path");
        const fs = await import("fs/promises");
        const tmp = path.join(process.cwd(), `.tmp-dumper-redact-${Date.now()}`);
        process.env.ASSISTANT_DUMP_LLM_CALLS_DIR = tmp;
        process.env.ASSISTANT_DUMP_LLM_REDACT = "true";

        const { raw, json } = await writeDump(tmp);

        expect(json.inputs.inputParams.userMessage).toBe("[REDACTED]");
        expect(json.inputs.history[0].content).toBe("[REDACTED]");
        // policy prompt redacted, ordinary one kept
        expect(json.inputs.systemPrompts[0]).toBe("ordinary system prompt");
        expect(json.inputs.systemPrompts[1]).toBe("[REDACTED]");
        // iteration response.content redacted
        expect(json.iterations[0].response.content).toBe("[REDACTED]");
        // the raw secret text must appear NOWHERE in the file
        expect(raw).not.toContain(SECRET_MESSAGE);
        expect(raw).not.toContain(SECRET_HISTORY);
        // non-secret field preserved
        expect(json.inputs.inputParams.locale).toBe("en");

        await fs.rm(tmp, { recursive: true, force: true });
      });

      it("keeps dot-paths listed in ASSISTANT_DUMP_LLM_KEEP_FIELDS but still redacts others", async () => {
        const path = await import("path");
        const fs = await import("fs/promises");
        const tmp = path.join(process.cwd(), `.tmp-dumper-keep-${Date.now()}`);
        process.env.ASSISTANT_DUMP_LLM_CALLS_DIR = tmp;
        process.env.ASSISTANT_DUMP_LLM_REDACT = "true";
        process.env.ASSISTANT_DUMP_LLM_KEEP_FIELDS = "metadata.gameId,metadata.roundId";

        const { json } = await writeDump(tmp);

        expect(json.inputs.metadata.gameId).toBe("game-abc");
        expect(json.inputs.metadata.roundId).toBe("round-xyz");
        // userId not in keep-list -> redacted
        expect(json.inputs.metadata.userId).toBe("[REDACTED]");
        // userMessage still redacted regardless of keep-list
        expect(json.inputs.inputParams.userMessage).toBe("[REDACTED]");

        await fs.rm(tmp, { recursive: true, force: true });
      });

      it("does NOT redact when ASSISTANT_DUMP_LLM_REDACT is unset (default off)", async () => {
        const path = await import("path");
        const fs = await import("fs/promises");
        const tmp = path.join(process.cwd(), `.tmp-dumper-noredact-${Date.now()}`);
        process.env.ASSISTANT_DUMP_LLM_CALLS_DIR = tmp;
        delete process.env.ASSISTANT_DUMP_LLM_REDACT;

        const { raw, json } = await writeDump(tmp);

        expect(json.inputs.inputParams.userMessage).toBe(SECRET_MESSAGE);
        expect(json.inputs.history[0].content).toBe(SECRET_HISTORY);
        expect(json.iterations[0].response.content).toBe(SECRET_MESSAGE);
        expect(raw).toContain(SECRET_MESSAGE);

        await fs.rm(tmp, { recursive: true, force: true });
      });
    });

    it("close() does not throw when the disk write fails", async () => {
      const fs = await import("fs/promises");
      const path = await import("path");
      const blocker = path.join(process.cwd(), `.tmp-blocker-${Date.now()}`);
      await fs.writeFile(blocker, "x");
      // Setting the dir under a regular file makes mkdir fail.
      process.env.ASSISTANT_DUMP_LLM_CALLS_DIR = path.join(blocker, "dumps");

      const { LLMCallDumper } = await import("../llm-call-dumper.service");
      const dumper = new LLMCallDumper(null as any);
      const session = dumper.startSession({
        metadata: { nodeName: "graph", agentName: "responder" },
        model: "m",
        provider: "p",
      });
      // Should not throw, even though the underlying write will fail.
      expect(() => session.close({ finalStatus: "success", totalTokens: { input: 0, output: 0 } })).not.toThrow();
      // Wait briefly so the async catch fires before the test exits.
      await new Promise((r) => setTimeout(r, 100));

      await fs.rm(blocker, { force: true });
    });
  });

  describe("websocket emit (flag on)", () => {
    function makeStartParams() {
      return { model: "m", provider: "p", metadata: { nodeName: "direct", agentName: "game" } };
    }

    it("emits a reply-focused llm:dump to the resolved user on close", () => {
      process.env.ASSISTANT_DUMP_LLM_CALLS = "1";
      const sent: any[] = [];
      const ws = { sendMessageToUser: (uid: string, ev: string, data: any) => sent.push({ uid, ev, data }) } as any;
      const cls = {
        has: (k: string) => k === "userId",
        get: (k: string) => (k === "userId" ? "user-1" : undefined),
      } as any;
      const dumper = new LLMCallDumper(cls, ws);

      const session = dumper.startSession(makeStartParams());
      session.startIteration("tool-loop", []);
      session.recordResponse({
        content: "",
        toolCalls: [{ id: "1", name: "direct_scene", args: { lead: "Mara" } }],
        tokenUsage: { input: 3, output: 4 },
        finishReason: "tool_calls",
      });
      session.close({ finalStatus: "success", totalTokens: { input: 3, output: 4 } });

      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ uid: "user-1", ev: "llm:dump" });
      expect(sent[0].data).toMatchObject({
        nodeName: "direct",
        agentName: "game",
        finalStatus: "success",
        totalTokens: { input: 3, output: 4 },
        reply: { content: "", toolCalls: [{ name: "direct_scene", args: { lead: "Mara" } }] },
      });
    });

    it("includes cached tokens in the dump event and passes them to costFn", () => {
      process.env.ASSISTANT_DUMP_LLM_CALLS = "1";
      const sent: any[] = [];
      const ws = { sendMessageToUser: (uid: string, ev: string, data: any) => sent.push({ uid, ev, data }) } as any;
      const cls = {
        has: (k: string) => k === "userId",
        get: (k: string) => (k === "userId" ? "user-1" : undefined),
      } as any;
      const dumper = new LLMCallDumper(cls, ws);

      const costFn = vi.fn().mockReturnValue(0.001);
      const session = dumper.startSession({ ...makeStartParams(), costFn });
      session.startIteration("final-structured", []);
      session.recordResponse({ content: "{}", tokenUsage: { input: 1000, output: 200 } });
      session.close({
        finalStatus: "success",
        totalTokens: { input: 1000, output: 200, cached: 300 },
        warnings: [],
        parseFallbacks: [],
      });

      expect(costFn).toHaveBeenCalledWith({ input: 1000, output: 200, cached: 300 });
      expect(sent).toHaveLength(1);
      const event = sent[0].data;
      expect(event.totalTokens.cached).toBe(300);
      expect(event.cost).toBe(0.001);
    });

    it("does not emit when there is no userId in CLS", () => {
      process.env.ASSISTANT_DUMP_LLM_CALLS = "1";
      const sent: any[] = [];
      const ws = { sendMessageToUser: (uid: string, ev: string, data: any) => sent.push({ uid, ev, data }) } as any;
      const dumper = new LLMCallDumper({ has: () => false, get: () => undefined } as any, ws);
      const session = dumper.startSession(makeStartParams());
      session.startIteration("tool-loop", []);
      session.recordResponse({ content: "x" });
      session.close({ finalStatus: "success", totalTokens: { input: 0, output: 0 } });
      expect(sent).toHaveLength(0);
    });

    it("does not emit (and does not throw) when no websocket is provided", () => {
      process.env.ASSISTANT_DUMP_LLM_CALLS = "1";
      const cls = { has: (k: string) => k === "userId", get: () => "user-1" } as any;
      const dumper = new LLMCallDumper(cls);
      const session = dumper.startSession(makeStartParams());
      session.startIteration("tool-loop", []);
      session.recordResponse({ content: "x" });
      expect(() => session.close({ finalStatus: "success", totalTokens: { input: 0, output: 0 } })).not.toThrow();
    });
  });
});
