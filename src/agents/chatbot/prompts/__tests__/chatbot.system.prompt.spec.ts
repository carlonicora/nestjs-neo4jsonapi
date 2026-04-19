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

  it("contains the four required stage headers", () => {
    const out = renderChatbotSystemPrompt("any");
    expect(out).toContain("## How to answer");
    expect(out).toContain("Stage 1 — Classify");
    expect(out).toContain("Stage 2 — Plan and execute tools");
    expect(out).toContain("Stage 3 — Narrate");
    expect(out).toContain("Stage 4 — Suggest");
  });

  it("contains all six taxonomy type headers (T1–T6)", () => {
    const out = renderChatbotSystemPrompt("any");
    expect(out).toContain("## Question types");
    expect(out).toContain("T1. Identity");
    expect(out).toContain("T2. Activity / status");
    expect(out).toContain("T3. Drill-down");
    expect(out).toContain("T4. Listing / filter");
    expect(out).toContain("T5. Analytical / comparative");
    expect(out).toContain("T6. Ambiguous");
  });

  it("contains all answer-shape rule identifiers A1–A6", () => {
    const out = renderChatbotSystemPrompt("any");
    expect(out).toContain("## Answer shape");
    for (const id of ["A1", "A2", "A3", "A4", "A5", "A6"]) {
      expect(out).toContain(id);
    }
  });

  it("contains all suggested-question rule identifiers S1–S5", () => {
    const out = renderChatbotSystemPrompt("any");
    expect(out).toContain("## Suggested questions");
    for (const id of ["S1", "S2", "S3", "S4", "S5"]) {
      expect(out).toContain(id);
    }
  });

  it("contains the Tool discipline appendix with preserved rules", () => {
    const out = renderChatbotSystemPrompt("any");
    expect(out).toContain("## Tool discipline");
    expect(out).toMatch(/Literal-first/);
    expect(out).toMatch(/Deduplicate/);
    expect(out).toMatch(/matchMode/);
    expect(out).toMatch(/read-only/i);
  });

  it("advertises a 15-iteration budget in Stage 2", () => {
    const out = renderChatbotSystemPrompt("any");
    expect(out).toMatch(/15 tool iterations/);
  });
});
