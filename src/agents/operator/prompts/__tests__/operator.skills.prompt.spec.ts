import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  OPERATOR_SKILLS_LIST_FRAMING,
  OPERATOR_SKILLS_LOADED_FRAMING,
  renderLoadedSkills,
  renderSkillList,
} from "../operator.skills.prompt";

describe("operator skills prompt", () => {
  const source = readFileSync(join(__dirname, "..", "operator.skills.prompt.ts"), "utf8");

  it("contains no backticks (template-literal safety)", () => {
    // The only backticks in the file are the delimiters of the two framing template literals.
    expect(source.split("`").length - 1).toBe(4);
    expect(OPERATOR_SKILLS_LIST_FRAMING.includes("`")).toBe(false);
    expect(OPERATOR_SKILLS_LOADED_FRAMING.includes("`")).toBe(false);
  });

  it("contains no dynamic placeholders (data travels via inputParams)", () => {
    expect(source).not.toMatch(/\$\{/);
    expect(OPERATOR_SKILLS_LIST_FRAMING).not.toMatch(/\$\{/);
    expect(OPERATOR_SKILLS_LOADED_FRAMING).not.toMatch(/\$\{/);
  });

  it("keeps the loaded framing free of curly braces (it is placed in a template)", () => {
    expect(OPERATOR_SKILLS_LOADED_FRAMING).not.toMatch(/[{}]/);
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

  it("renders loaded skills as delimited blocks", () => {
    expect(renderLoadedSkills([{ name: "email", instructions: "Sign off." }])).toBe("--- skill: email ---\nSign off.");
    expect(
      renderLoadedSkills([
        { name: "email", instructions: "Sign off." },
        { name: "humanizer", instructions: "Plain words." },
      ]),
    ).toBe("--- skill: email ---\nSign off.\n\n--- skill: humanizer ---\nPlain words.");
  });

  it("keeps the instructions byte for byte", () => {
    const instructions = "Use {a} and } then a ` and $" + "{x} here.";
    expect(renderLoadedSkills([{ name: "email", instructions }])).toBe("--- skill: email ---\n" + instructions);
  });

  it.each([
    ["list", OPERATOR_SKILLS_LIST_FRAMING],
    ["loaded", OPERATOR_SKILLS_LOADED_FRAMING],
  ])("the %s framing states the four limits and follow-without-reciting", (_label, framing) => {
    expect(framing).toMatch(/never skips? an approval/i);
    expect(framing).toMatch(/another workspace's data/i);
    expect(framing).toMatch(/record ids/i);
    expect(framing).toMatch(/never overrides? the rules above/i);
    expect(framing).toMatch(/follow a skill without reciting it/i);
  });
});
