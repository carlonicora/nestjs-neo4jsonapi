import { describe, it, expect } from "vitest";
import { renderGraphNodeSystemPrompt } from "../graph.node.system.prompt";

describe("renderGraphNodeSystemPrompt", () => {
  it("injects the graph map in place of {GRAPH_MAP}", () => {
    const out = renderGraphNodeSystemPrompt("## Entities (crm)\n- accounts");
    expect(out).toContain("## Entities (crm)");
    expect(out).not.toContain("{GRAPH_MAP}");
  });

  it("falls back to a refusal notice when graph map is empty", () => {
    const out = renderGraphNodeSystemPrompt("");
    expect(out).toMatch(/No accessible data/i);
  });

  it("has the four required top-level sections", () => {
    const out = renderGraphNodeSystemPrompt("any");
    expect(out).toContain("# Role");
    expect(out).toContain("## Your data");
    expect(out).toContain("## Tools");
    expect(out).toContain("## Output");
  });

  it("frames answering as graph traversal in the Role section", () => {
    const out = renderGraphNodeSystemPrompt("any");
    expect(out).toMatch(/by traversing this graph/i);
    expect(out).toMatch(/following at least one edge/i);
  });

  it("forbids invention in plain terms", () => {
    const out = renderGraphNodeSystemPrompt("any");
    expect(out).toMatch(/do not invent/i);
  });

  it("documents all five tools with their entry names", () => {
    const out = renderGraphNodeSystemPrompt("any");
    for (const name of ["resolve_entity", "describe_entity", "search_entities", "read_entity", "traverse"]) {
      expect(out).toContain(name);
    }
  });

  it("describes the matchMode values returned by resolve_entity", () => {
    const out = renderGraphNodeSystemPrompt("any");
    const resolveBlock = out.substring(out.indexOf("resolve_entity"));
    for (const mode of ["exact", "fuzzy", "semantic", "none"]) {
      expect(resolveBlock).toContain(mode);
    }
  });

  it("instructs recovery on tool error instead of apology", () => {
    const out = renderGraphNodeSystemPrompt("any");
    expect(out).toMatch(/recover within the same turn/i);
    expect(out).toMatch(/do not apologise/i);
  });

  it("documents the three output fields and drops the legacy ones", () => {
    const out = renderGraphNodeSystemPrompt("any");
    const outputBlock = out.substring(out.indexOf("## Output"));
    // The three current fields are listed as backticked field bullets.
    expect(outputBlock).toContain("`answer`");
    expect(outputBlock).toContain("`entities`");
    expect(outputBlock).toContain("`stop`");
    // Legacy fields removed by the unified-assistant migration must not reappear
    // as backticked field names.
    expect(out).not.toContain("`suggestedQuestions`");
    expect(out).not.toContain("`needsClarification`");
    expect(out).not.toMatch(/suggestedQuestions/);
    expect(out).not.toMatch(/needsClarification/);
  });

  it("contains no leftover taxonomy or rule identifiers from the previous version", () => {
    const out = renderGraphNodeSystemPrompt("any");
    expect(out).not.toContain("## How to answer");
    expect(out).not.toContain("Stage 1");
    expect(out).not.toContain("## Question types");
    expect(out).not.toContain("## Answer shape");
    expect(out).not.toContain("## Suggested questions");
    expect(out).not.toContain("## Tool discipline");
    for (const id of [
      "T1.",
      "T2.",
      "T3.",
      "T4.",
      "T5.",
      "T6.",
      "A1.",
      "A2.",
      "A3.",
      "A4.",
      "A5.",
      "A6.",
      "S1.",
      "S2.",
      "S3.",
      "S4.",
      "S5.",
    ]) {
      expect(out).not.toContain(id);
    }
  });

  it("uses no shouting capitalisations", () => {
    const out = renderGraphNodeSystemPrompt("any");
    expect(out).not.toMatch(/\bMUST\b/);
    expect(out).not.toMatch(/\bNEVER\b/);
    expect(out).not.toMatch(/\bMANDATORY\b/);
    expect(out).not.toMatch(/\bCRITICAL\b/);
    expect(out).not.toMatch(/\bFORBIDDEN\b/);
  });

  it("entities contract forbids including discarded search/traverse results", () => {
    const out = renderGraphNodeSystemPrompt("any");
    expect(out).toMatch(/contributes to the meaning of/i);
    expect(out).toMatch(/do not include[^.]*entities you retrieved, inspected, and discarded/i);
    expect(out).toMatch(/be strict/i);
  });

  it("entities contract instructs the LLM to populate `fields` with quoted values", () => {
    const out = renderGraphNodeSystemPrompt("any");
    const outputBlock = out.substring(out.indexOf("## Output"));
    expect(outputBlock).toContain("`fields`");
    expect(outputBlock).toMatch(/values you quoted in `?answer`?/i);
  });

  it("Tools section instructs describe-first + error recovery (do not stop on first error)", () => {
    const out = renderGraphNodeSystemPrompt("any");
    const toolsBlock = out.substring(out.indexOf("## Tools"), out.indexOf("## Output"));
    expect(toolsBlock).toMatch(/before calling `?read_entity`?, `?search_entities`?, or `?traverse`?/i);
    expect(toolsBlock).toMatch(/the error response includes the type's schema/i);
    expect(toolsBlock).toMatch(/never stop on the first error/i);
  });

  it("contains no entity-type-specific examples (regression guard against overly-specific prompts)", () => {
    const out = renderGraphNodeSystemPrompt("any");
    // Specific entity names that previously crept in via worked examples — must never reappear.
    const forbidden = [
      "BoM",
      "bom-entries",
      "line-items",
      "WO-RSET-",
      "Faby and Carlo",
      "Acme",
      "scheduled_start_date",
      "work_order_type",
    ];
    for (const token of forbidden) {
      expect(out).not.toContain(token);
    }
  });

  it("Tools section tells the LLM to prefer entities already in context over resolve_entity", () => {
    const out = renderGraphNodeSystemPrompt("any");
    expect(out).toMatch(/Entities already in this conversation/);
    expect(out).toMatch(/treat that entity as resolved/i);
    expect(out).toMatch(/Do not call `?resolve_entity`? for a name that is already resolved/i);
  });

  it("search_entities description points the LLM at resolve_entity for name lookup", () => {
    const out = renderGraphNodeSystemPrompt("any");
    const searchBlock = out.substring(out.indexOf("search_entities"));
    expect(searchBlock).toMatch(/does not search by name/i);
    expect(searchBlock).toMatch(/resolve_entity/);
  });

  it("Tools preamble makes resolve_entity the first step for user-named entities", () => {
    const out = renderGraphNodeSystemPrompt("any");
    const toolsIdx = out.indexOf("## Tools");
    const firstListIdx = out.indexOf("- `", toolsIdx);
    const preamble = out.substring(toolsIdx, firstListIdx);
    expect(preamble).toMatch(/first tool call .* `?resolve_entity/i);
    expect(preamble).toMatch(/do not guess a type/i);
  });

  it("resolve_entity entry gives explicit per-tier score-margin thresholds", () => {
    const out = renderGraphNodeSystemPrompt("any");
    const resolveBlock = out.substring(out.indexOf("resolve_entity"));
    expect(resolveBlock).toMatch(/0\.15/);
    expect(resolveBlock).toMatch(/0\.08/);
  });

  it("Output section instructs the LLM to write a complete prose answer for the user's question", () => {
    const out = renderGraphNodeSystemPrompt("any");
    const outputBlock = out.substring(out.indexOf("## Output"));
    expect(outputBlock).toMatch(/`?answer`?[^]*complete[^]*prose reply/i);
    expect(outputBlock).toMatch(/markdown bullet list|enumeration/i);
  });

  it("does not contain predecessor's dead-end patches", () => {
    const out = renderGraphNodeSystemPrompt("any");
    expect(out).not.toContain("Important — `fields`");
    expect(out).not.toContain("Important — container queries");
    expect(out).not.toContain("resolve_entity is step 1 of a chain");
    expect(out).not.toContain("do not split a multi-word phrase");
    expect(out).not.toContain("you are a retrieval step, not a writer");
    expect(out).not.toContain("a separate synthesizer downstream will phrase the user-facing answer");
  });
});
