import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import * as skillsPrompt from "../operator.skills.prompt";
import { OPERATOR_SKILLS_LIST_FRAMING, renderLoadedSkillResult, renderSkillList } from "../operator.skills.prompt";

describe("operator skills prompt", () => {
  const source = readFileSync(join(__dirname, "..", "operator.skills.prompt.ts"), "utf8");

  it("contains no backticks (template-literal safety)", () => {
    // The only backticks in the file are the delimiters of the list framing template literal.
    expect(source.split("`").length - 1).toBe(2);
    expect(OPERATOR_SKILLS_LIST_FRAMING.includes("`")).toBe(false);
  });

  it("contains no dynamic placeholders and no curly braces in the framing", () => {
    expect(source).not.toMatch(/\$\{/);
    expect(OPERATOR_SKILLS_LIST_FRAMING).not.toMatch(/[{}]/);
  });

  it("keeps the list framing short: what a skill is, when to load it, what it is not", () => {
    expect(OPERATOR_SKILLS_LIST_FRAMING).toMatch(
      /call load_skill with the skill's name when the request fits it, at any step, then follow it/i,
    );
    expect(OPERATOR_SKILLS_LIST_FRAMING).toContain(
      "Skills change how you work and write; they are not a source of facts and add no actions.",
    );
    expect(OPERATOR_SKILLS_LIST_FRAMING.endsWith("Available skills:")).toBe(true);
    expect(OPERATOR_SKILLS_LIST_FRAMING).not.toMatch(/never/i);
    expect(OPERATOR_SKILLS_LIST_FRAMING.length).toBeLessThan(450);
  });

  it("keeps the old loaded-skills exports for compatibility, unused by the operator", () => {
    // Deprecated: released in 8.31.0, so they stay exported within the major version.
    expect(skillsPrompt).toHaveProperty("OPERATOR_SKILLS_LOADED_FRAMING");
    expect(skillsPrompt).toHaveProperty("renderLoadedSkills");
    const operatorSource = readFileSync(join(__dirname, "..", "..", "services", "operator.service.ts"), "utf8");
    expect(operatorSource).not.toMatch(/OPERATOR_SKILLS_LOADED_FRAMING|renderLoadedSkills\b/);
  });

  it("renders the skill list one line per skill", () => {
    expect(renderSkillList([{ name: "email", description: "House rules" }])).toBe("- email: House rules");
    expect(
      renderSkillList([
        { name: "email", description: "House rules" },
        { name: "humanizer", description: "Plain words" },
      ]),
    ).toBe("- email: House rules\n- humanizer: Plain words");
  });

  it("renders a loaded skill as a one-line header followed by its instructions", () => {
    expect(renderLoadedSkillResult({ name: "email", instructions: "Sign off." })).toBe(
      "Skill email is loaded. Follow it in everything you do and write from here on, including your reply:\nSign off.",
    );
  });

  it("keeps the instructions byte for byte", () => {
    const instructions = "Use {a} and } then a ` and $" + "{x} here.\n\n- list\n";
    const rendered = renderLoadedSkillResult({ name: "email", instructions });
    expect(rendered.endsWith("\n" + instructions)).toBe(true);
    expect(rendered.split("\n")[0]).toBe(
      "Skill email is loaded. Follow it in everything you do and write from here on, including your reply:",
    );
  });
});
