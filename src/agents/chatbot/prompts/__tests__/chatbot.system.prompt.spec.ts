import { describe, it, expect } from "vitest";
import { renderChatbotSystemPrompt } from "../chatbot.system.prompt";

describe("renderChatbotSystemPrompt", () => {
  it("injects the graph map in place of {GRAPH_MAP}", () => {
    const out = renderChatbotSystemPrompt("## Entities (crm)\n- accounts");
    expect(out).toContain("## Entities (crm)");
    expect(out).not.toContain("{GRAPH_MAP}");
  });

  it("falls back to a refusal notice when graph map is empty", () => {
    const out = renderChatbotSystemPrompt("");
    expect(out).toMatch(/No accessible data/i);
  });

  it("has the four required top-level sections", () => {
    const out = renderChatbotSystemPrompt("any");
    expect(out).toContain("# Role");
    expect(out).toContain("## Your data");
    expect(out).toContain("## Tools");
    expect(out).toContain("## Output");
  });

  it("frames answering as graph traversal in the Role section", () => {
    const out = renderChatbotSystemPrompt("any");
    expect(out).toMatch(/by traversing this graph/i);
    expect(out).toMatch(/following at least one edge/i);
  });

  it("forbids invention in plain terms", () => {
    const out = renderChatbotSystemPrompt("any");
    expect(out).toMatch(/do not invent/i);
  });

  it("documents all five tools with their entry names", () => {
    const out = renderChatbotSystemPrompt("any");
    for (const name of ["resolve_entity", "describe_entity", "search_entities", "read_entity", "traverse"]) {
      expect(out).toContain(name);
    }
  });

  it("describes the matchMode values returned by resolve_entity", () => {
    const out = renderChatbotSystemPrompt("any");
    const resolveBlock = out.substring(out.indexOf("resolve_entity"));
    for (const mode of ["exact", "fuzzy", "semantic", "none"]) {
      expect(resolveBlock).toContain(mode);
    }
  });

  it("instructs recovery on tool error instead of apology", () => {
    const out = renderChatbotSystemPrompt("any");
    expect(out).toMatch(/recover within the same turn/i);
    expect(out).toMatch(/do not apologise/i);
  });

  it("documents all four output fields", () => {
    const out = renderChatbotSystemPrompt("any");
    for (const field of ["answer", "references", "suggestedQuestions", "needsClarification"]) {
      expect(out).toContain(field);
    }
  });

  it("contains no leftover taxonomy or rule identifiers from the previous version", () => {
    const out = renderChatbotSystemPrompt("any");
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
    const out = renderChatbotSystemPrompt("any");
    expect(out).not.toMatch(/\bMUST\b/);
    expect(out).not.toMatch(/\bNEVER\b/);
    expect(out).not.toMatch(/\bMANDATORY\b/);
    expect(out).not.toMatch(/\bCRITICAL\b/);
    expect(out).not.toMatch(/\bFORBIDDEN\b/);
  });

  it("references contract forbids including discarded search/traverse results", () => {
    const out = renderChatbotSystemPrompt("any");
    expect(out).toMatch(/contributes? to the meaning of your `?answer`?/i);
    expect(out).toMatch(/do not include[^.]*entities you retrieved, inspected, and discarded/i);
  });

  it("references contract warns the LLM that references are re-loaded next turn", () => {
    const out = renderChatbotSystemPrompt("any");
    expect(out).toMatch(/re-loaded as context on the next turn/i);
    expect(out).toMatch(/be strict/i);
  });

  it("Tools section tells the LLM to prefer entities already in context over resolve_entity", () => {
    const out = renderChatbotSystemPrompt("any");
    expect(out).toMatch(/Entities already in this conversation/);
    expect(out).toMatch(/treat that entity as resolved/i);
    expect(out).toMatch(/Do not call `?resolve_entity`? for a name that is already resolved/i);
  });

  it("search_entities description points the LLM at resolve_entity for name lookup", () => {
    const out = renderChatbotSystemPrompt("any");
    const searchBlock = out.substring(out.indexOf("search_entities"));
    expect(searchBlock).toMatch(/resolve_entity/);
  });

  it("Tools preamble makes resolve_entity the first step for user-named entities", () => {
    const out = renderChatbotSystemPrompt("any");
    const toolsIdx = out.indexOf("## Tools");
    const firstListIdx = out.indexOf("- `", toolsIdx);
    const preamble = out.substring(toolsIdx, firstListIdx);
    expect(preamble).toMatch(/first tool call .* `?resolve_entity/i);
    expect(preamble).toMatch(/do not guess a type/i);
  });

  it("resolve_entity entry gives explicit per-tier score-margin thresholds", () => {
    const out = renderChatbotSystemPrompt("any");
    const resolveBlock = out.substring(out.indexOf("resolve_entity"));
    expect(resolveBlock).toMatch(/0\.15/);
    expect(resolveBlock).toMatch(/0\.08/);
  });

  it("needsClarification contract covers resolve_entity tie within margin", () => {
    const out = renderChatbotSystemPrompt("any");
    const outputBlock = out.substring(out.indexOf("## Output"));
    expect(outputBlock).toMatch(/resolve_entity/);
    expect(outputBlock).toMatch(/margin/i);
  });
});
