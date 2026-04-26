import { Injectable, Logger, Optional } from "@nestjs/common";
import { randomUUID } from "crypto";
import { ClsService } from "nestjs-cls";
import { LLMCallMetadata } from "../interfaces/llm-call-metadata.interface";

export interface DumpSessionStartParams {
  metadata?: LLMCallMetadata & Record<string, unknown>;
  model: string;
  provider: string;
  temperature?: number;
}

export interface DumpInputs {
  systemPrompts: string[];
  instructions: string;
  inputParams: Record<string, unknown>;
  history: Array<{ role: string; content: string }>;
  tools: Array<{ name: string; description: string; schema: unknown }>;
  outputSchemaName: string;
}

export interface DumpResponse {
  content?: string;
  toolCalls?: Array<{ id: string; name: string; args: unknown }>;
  tokenUsage?: { input: number; output: number };
  finishReason?: string;
}

export interface DumpCloseParams {
  finalStatus: "success" | "error" | "partial";
  errorMessage?: string;
  errorStack?: string;
  totalTokens: { input: number; output: number };
  warnings?: string[];
  parseFallbacks?: Array<"tool_calls" | "lenient" | "raw">;
}

export interface DumpSession {
  readonly isEnabled: boolean;
  recordInputs(inputs: DumpInputs): void;
  startIteration(kind: "tool-loop" | "final-structured", sentMessages: ReadonlyArray<unknown>): void;
  recordResponse(response: DumpResponse): void;
  recordToolResult(toolCallId: string, tool: string, content: string): void;
  close(params: DumpCloseParams): void;
}

const NO_OP_SESSION: DumpSession = {
  isEnabled: false,
  recordInputs: () => undefined,
  startIteration: () => undefined,
  recordResponse: () => undefined,
  recordToolResult: () => undefined,
  close: () => undefined,
};

interface SerializedMessage {
  role: string;
  bytes: number;
  approxTokens: number;
  content: string;
}

interface IterationRecord {
  index: number;
  kind: "tool-loop" | "final-structured";
  sentMessages: SerializedMessage[];
  sizesSummary: {
    totalBytes: number;
    totalApproxTokens: number;
    byRole: Record<string, number>;
  };
  response?: {
    content: string;
    toolCalls: Array<{ id: string; name: string; args: unknown }>;
    tokenUsage: { input: number; output: number };
    finishReason?: string;
  };
  toolResults: Array<{
    toolCallId: string;
    tool: string;
    bytes: number;
    approxTokens: number;
    content: string;
  }>;
}

function approxTokens(bytes: number): number {
  return Math.ceil(bytes / 4);
}

function byteLength(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

function serializeMessage(m: any): SerializedMessage {
  // LangChain BaseMessage exposes _getType() ("system" | "human" | "ai" | "tool").
  // Plain {role,content} objects (used in unit tests) are also accepted.
  let role: string;
  if (typeof m?._getType === "function") {
    const t = m._getType();
    role = t === "human" ? "user" : t === "ai" ? "assistant" : t;
  } else {
    role = String(m?.role ?? m?.type ?? "unknown");
  }
  let content: string;
  if (typeof m?.content === "string") {
    content = m.content;
  } else if (m?.content != null) {
    try {
      content = JSON.stringify(m.content);
    } catch {
      content = String(m.content);
    }
  } else {
    content = "";
  }
  const bytes = byteLength(content);
  return { role, bytes, approxTokens: approxTokens(bytes), content };
}

class RealDumpSession implements DumpSession {
  readonly isEnabled = true;
  readonly callId = randomUUID();
  readonly startedAt = new Date();
  private inputs?: DumpInputs;
  private iterations: IterationRecord[] = [];
  private current?: IterationRecord;

  constructor(
    private readonly start: DumpSessionStartParams,
    private readonly outputDir: string,
    private readonly logger: Logger,
    private readonly clsContext: {
      requestId?: string;
      userId?: string;
      companyId?: string;
      assistantId?: string;
      turnStartedAt?: string;
    },
    private readonly fileWriter: (path: string, body: string) => Promise<void>,
    private readonly mkdirp: (dir: string) => Promise<void>,
  ) {}

  recordInputs(inputs: DumpInputs): void {
    this.inputs = inputs;
  }

  startIteration(kind: "tool-loop" | "final-structured", sentMessages: ReadonlyArray<unknown>): void {
    const serialized = sentMessages.map(serializeMessage);
    const byRole: Record<string, number> = {};
    let totalBytes = 0;
    for (const m of serialized) {
      totalBytes += m.bytes;
      byRole[m.role] = (byRole[m.role] ?? 0) + m.bytes;
    }
    this.current = {
      index: this.iterations.length,
      kind,
      sentMessages: serialized,
      sizesSummary: { totalBytes, totalApproxTokens: approxTokens(totalBytes), byRole },
      toolResults: [],
    };
    this.iterations.push(this.current);
  }

  recordResponse(response: DumpResponse): void {
    if (!this.current) return;
    this.current.response = {
      content: response.content ?? "",
      toolCalls: response.toolCalls ?? [],
      tokenUsage: response.tokenUsage ?? { input: 0, output: 0 },
      finishReason: response.finishReason,
    };
  }

  recordToolResult(toolCallId: string, tool: string, content: string): void {
    if (!this.current) return;
    const bytes = byteLength(content);
    this.current.toolResults.push({
      toolCallId,
      tool,
      bytes,
      approxTokens: approxTokens(bytes),
      content,
    });
  }

  close(params: DumpCloseParams): void {
    const completedAt = new Date();
    const meta = {
      callId: this.callId,
      requestId: this.clsContext.requestId,
      nodeName: (this.start.metadata?.nodeName as string) ?? "unknown",
      agentName: (this.start.metadata?.agentName as string) ?? "unknown",
      userId: this.clsContext.userId,
      companyId: this.clsContext.companyId,
      userQuestion: (this.start.metadata?.userQuestion as string | undefined) ?? undefined,
      model: this.start.model,
      provider: this.start.provider,
      temperature: this.start.temperature,
      startedAt: this.startedAt.toISOString(),
      durationMs: completedAt.getTime() - this.startedAt.getTime(),
      iterationCount: this.iterations.length,
      finalStatus: params.finalStatus,
      errorMessage: params.errorMessage,
      errorStack: params.errorStack,
      totalTokens: params.totalTokens,
      warnings: params.warnings ?? [],
      parseFallbacks: params.parseFallbacks ?? [],
    };
    const payload = {
      meta,
      inputs: this.inputs,
      iterations: this.iterations,
    };

    const body = JSON.stringify(payload, null, 2);
    const yyyyMmDd = this.startedAt.toISOString().slice(0, 10);
    const hhMmSsMs = this.startedAt.toISOString().slice(11, 23).replace(/[:.]/g, "-");
    // Group dumps under the originating assistant + turn whenever the caller
    // (assistant.service.ts.runAgentTurn) has set the CLS context. Falls back
    // to a flat per-day layout for any LLM call outside the assistant flow.
    const assistantId = this.clsContext.assistantId;
    const turnStartedAt = this.clsContext.turnStartedAt;
    const dir =
      assistantId && turnStartedAt
        ? `${this.outputDir}/${yyyyMmDd}/${assistantId}/${turnStartedAt}`
        : `${this.outputDir}/${yyyyMmDd}`;
    const file = `${dir}/${hhMmSsMs}-${meta.nodeName}-${this.callId}.json`;

    // Fire-and-forget; do not await. Errors are caught and logged.
    this.mkdirp(dir)
      .then(() => this.fileWriter(file, body))
      .catch((err) => {
        this.logger.warn(
          `[LLMCallDumper] Failed to write dump ${file}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }

  /** Test-only: peek at in-memory state. Not part of the public DumpSession interface. */
  __snapshot() {
    return { meta: this.start.metadata, inputs: this.inputs, iterations: this.iterations };
  }
}

@Injectable()
export class LLMCallDumper {
  private readonly logger = new Logger(LLMCallDumper.name);
  private readonly enabled: boolean;
  private readonly outputDir: string;

  constructor(@Optional() private readonly cls?: ClsService) {
    this.enabled = process.env.ASSISTANT_DUMP_LLM_CALLS === "1";
    // Default to `<cwd>/.llm-dumps`. When the API runs via
    // `pnpm --filter neural-erp-api dev`, cwd is `apps/api/`, so this lands at
    // `apps/api/.llm-dumps/` (which is gitignored). For any other cwd, set
    // ASSISTANT_DUMP_LLM_CALLS_DIR to an absolute path.
    this.outputDir = process.env.ASSISTANT_DUMP_LLM_CALLS_DIR ?? `${process.cwd()}/.llm-dumps`;
  }

  startSession(params: DumpSessionStartParams): DumpSession {
    if (!this.enabled) return NO_OP_SESSION;

    const log = this.cls?.has?.("logContext") ? (this.cls.get("logContext") as any) : undefined;
    const turn = this.cls?.has?.("assistantTurnContext") ? (this.cls.get("assistantTurnContext") as any) : undefined;
    const clsContext = {
      requestId: log?.requestId,
      userId: log?.userId,
      companyId: log?.companyId,
      assistantId: turn?.assistantId,
      turnStartedAt: turn?.turnStartedAt,
    };

    // fs is loaded lazily so the no-op path stays I/O-free.

    const fs = require("fs/promises") as typeof import("fs/promises");
    return new RealDumpSession(
      params,
      this.outputDir,
      this.logger,
      clsContext,
      (path, body) => fs.writeFile(path, body, "utf8"),
      (dir) => fs.mkdir(dir, { recursive: true }).then(() => undefined),
    );
  }
}
