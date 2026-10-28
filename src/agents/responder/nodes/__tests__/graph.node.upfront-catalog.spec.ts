import { describe, expect, it, vi } from "vitest";
import type { Mocked } from "vitest";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import type { ConfigService } from "@nestjs/config";
import {
  GraphNodeService,
  RETRY_INSTRUCTION,
  UPFRONT_CATALOG_MAX_TOKENS,
  UPFRONT_DATA_LOADING_RETRY_INSTRUCTION,
  UPFRONT_RETRY_INSTRUCTION,
} from "../graph.node.service";
import { renderGraphNodeSystemPrompt } from "../../../graph/prompts/graph.node.system.prompt";
import { ToolFactory } from "../../../graph/tools/tool.factory";
import type { ToolCallRecord, UserContext } from "../../../graph/tools/tool.factory";
import { DescribeEntityTool } from "../../../graph/tools/describe-entity.tool";
import { ReadEntityTool } from "../../../graph/tools/read-entity.tool";
import type { ResolveEntityTool } from "../../../graph/tools/resolve-entity.tool";
import type { SearchEntitiesTool } from "../../../graph/tools/search-entities.tool";
import type { TraverseTool } from "../../../graph/tools/traverse.tool";
import type { GraphCatalogService } from "../../../graph/services/graph.catalog.service";
import type { ToolFieldFormatterService } from "../../../graph/services/field-formatting";
import type { ScopeGuard } from "../../../graph/services/scope.guard";
import type { EntityServiceRegistry } from "../../../../common/registries/entity.service.registry";
import type { LLMService } from "../../../../core/llm/services/llm.service";
import type { CatalogEntity } from "../../../graph/interfaces/graph.catalog.interface";

/**
 * Up-front catalog: the lookup's system prompt carries every readable type's
 * description, those types pass the describe-first gate without a recorder
 * entry, and over the size limit the lookup behaves as before.
 */

const MODULE_ID = "11111111-1111-1111-1111-111111111111";
const things: CatalogEntity = {
  type: "things",
  moduleId: MODULE_ID,
  description: "A thing.",
  fields: [{ name: "name", type: "string", description: "Display name.", filterable: true, sortable: true }],
  relationships: [],
  nodeName: "thing",
  labelName: "Thing",
  summary: (d: any) => d.name,
} as CatalogEntity;
const TYPE_INDEX = "- things — A thing.";

// Records its call in the shared recorder, like the real tools do.
const recordingTool = (name: string) =>
  ({
    build: (_ctx: UserContext, recorder: ToolCallRecord[]) =>
      new DynamicStructuredTool({
        name,
        description: name,
        schema: z.object({}).passthrough(),
        func: async (input: Record<string, unknown>) => {
          recorder.push({ tool: name, input, durationMs: 1 });
          return JSON.stringify({ ok: true });
        },
      }),
  }) as unknown;

const buildService = (llmCall: (args: any) => Promise<any>) => {
  const catalog = {
    getTypeIndexFor: vi.fn(() => TYPE_INDEX),
    getAccessibleTypes: vi.fn(() => ["things"]),
    getEntityDetail: vi.fn((type: string) => (type === "things" ? things : null)),
  } as unknown as Mocked<GraphCatalogService>;
  const svc = { findRecordById: vi.fn(async () => ({ id: "t1", name: "Lantern" })) };
  const registry = { get: vi.fn(() => svc) } as unknown as Mocked<EntityServiceRegistry>;
  const formatter = {
    build: vi.fn(({ record }: any) => ({ fields: { name: record.name } })),
  } as unknown as Mocked<ToolFieldFormatterService>;
  const factory = new ToolFactory(catalog, registry);
  const describeTool = new DescribeEntityTool(factory);
  const readTool = new ReadEntityTool(factory, catalog, registry, {} as Mocked<ScopeGuard>, formatter);
  const llm = { call: vi.fn(llmCall) } as unknown as Mocked<LLMService>;
  const config = { get: vi.fn(() => undefined) } as unknown as Mocked<ConfigService>;
  const service = new GraphNodeService(
    llm,
    catalog,
    factory,
    recordingTool("resolve_entity") as ResolveEntityTool,
    describeTool,
    recordingTool("search_entities") as SearchEntitiesTool,
    readTool,
    recordingTool("traverse") as TraverseTool,
    config,
  );
  return { service, llm, describeTool };
};

const state = (question: string) =>
  ({ companyId: "c", userId: "u", userModuleIds: [MODULE_ID], question, chatHistory: [] }) as any;
const ctx: UserContext = { companyId: "c", userId: "u", userModuleIds: [MODULE_ID] };
const reply = { answer: "Lantern.", entities: [], stop: true, tokenUsage: { input: 1, output: 1 } };
const readThing = async (args: any) =>
  JSON.parse(
    await args.tools.find((t: DynamicStructuredTool) => t.name === "read_entity").func({ type: "things", id: "t1" }),
  );

describe("GraphNodeService — up-front catalog", () => {
  it("puts the catalog in the system prompt under the size limit", async () => {
    const { service, llm, describeTool } = buildService(async () => reply);
    const catalog = describeTool.renderCatalog(ctx);
    expect(catalog.types).toEqual(["things"]);
    expect(catalog.approxTokens).toBeLessThanOrEqual(UPFRONT_CATALOG_MAX_TOKENS);

    await service.execute({ state: state("what is the lantern?") });

    const systemPrompts = llm.call.mock.calls[0][0].systemPrompts as string[];
    expect(systemPrompts[0]).toContain(catalog.text);
    expect(systemPrompts[0]).toBe(renderGraphNodeSystemPrompt(TYPE_INDEX, undefined, catalog.text));
  });

  it("system prompt is identical across two lookups of the same user", async () => {
    // Each lookup reads a record, so no retry pass adds a call.
    const { service, llm } = buildService(async (args) => {
      await readThing(args);
      return reply;
    });

    await service.execute({ state: state("what is the lantern?") });
    await service.execute({ state: state("who owns the lantern now?") });

    expect(llm.call).toHaveBeenCalledTimes(2);
    expect(llm.call.mock.calls[1][0].systemPrompts).toEqual(llm.call.mock.calls[0][0].systemPrompts);
  });

  it("pre-described types pass the gate without a recorder entry", async () => {
    let readResult: any;
    const { service } = buildService(async (args) => {
      readResult = await readThing(args);
      return reply;
    });

    const out: any = await service.execute({ state: state("what is the lantern?") });

    expect(readResult.error).toBeUndefined();
    expect(readResult).toMatchObject({ id: "t1", type: "things", fields: { name: "Lantern" } });
    const recorder = out.graphContext.toolCalls as ToolCallRecord[];
    expect(recorder.map((c) => c.tool)).toEqual(["read_entity"]);
    expect(recorder[0].error).toBeUndefined();
  });

  it("falls back to today's prompt and gate over the size limit", async () => {
    let readResult: any;
    const { service, llm, describeTool } = buildService(async (args) => {
      readResult ??= await readThing(args);
      return reply;
    });
    vi.spyOn(describeTool, "renderCatalog").mockReturnValue({
      text: "oversized",
      types: ["things"],
      approxTokens: UPFRONT_CATALOG_MAX_TOKENS + 1,
    });

    await service.execute({ state: state("what is the lantern?") });

    expect(llm.call.mock.calls[0][0].systemPrompts[0]).toBe(renderGraphNodeSystemPrompt(TYPE_INDEX, undefined));
    expect(readResult.error).toMatch(/You must call describe_entity/);
    expect(typeof readResult.schema).toBe("string");
  });

  it("retry texts drop the describe-first instruction in up-front mode", async () => {
    const upfront = buildService(async () => reply);
    await upfront.service.execute({ state: state("what is the lantern?") });
    expect(upfront.llm.call).toHaveBeenCalledTimes(2);
    const upfrontRetry = upfront.llm.call.mock.calls[1][0].systemPrompts[1];
    expect(upfrontRetry).toBe(UPFRONT_RETRY_INSTRUCTION);
    expect(upfrontRetry).not.toMatch(/call describe_entity/i);

    const fallback = buildService(async () => reply);
    vi.spyOn(fallback.describeTool, "renderCatalog").mockReturnValue({
      text: "oversized",
      types: ["things"],
      approxTokens: UPFRONT_CATALOG_MAX_TOKENS + 1,
    });
    await fallback.service.execute({ state: state("what is the lantern?") });
    expect(fallback.llm.call.mock.calls[1][0].systemPrompts[1]).toBe(RETRY_INSTRUCTION);
  });

  it("the data-loading retry uses the static up-front text in up-front mode", async () => {
    const { service, llm } = buildService(async (args) => {
      if (args.systemPrompts.length === 1) {
        await args.tools.find((t: DynamicStructuredTool) => t.name === "resolve_entity").func({ text: "lantern" });
      }
      return reply;
    });

    await service.execute({ state: state("what is the lantern?") });

    expect(llm.call).toHaveBeenCalledTimes(2);
    expect(llm.call.mock.calls[1][0].systemPrompts[1]).toBe(UPFRONT_DATA_LOADING_RETRY_INSTRUCTION);
    expect(UPFRONT_DATA_LOADING_RETRY_INSTRUCTION).not.toMatch(/call describe_entity/i);
  });

  it("up-front retry instructions contain no backticks and no dynamic placeholders", () => {
    for (const text of [UPFRONT_RETRY_INSTRUCTION, UPFRONT_DATA_LOADING_RETRY_INSTRUCTION]) {
      expect(text.includes("`")).toBe(false);
      expect(text).not.toMatch(/\$\{/);
    }
  });
});
