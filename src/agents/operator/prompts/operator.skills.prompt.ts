import type { AssistantSkillSummary } from "../../../common/interfaces/assistant.skill.interface";

/*
 * Static framing for skills. The skill list and the skill instructions are data
 * written by the administrators of a workspace. These texts, owned by the
 * library, hold no dynamic value and no curly brace, and the hard limits
 * (approvals, workspace scope, ids, facts) stay in the operator system prompt
 * and in the tools, never here.
 */

/** Precedes the list of skills the Assistant may load this turn. */
export const OPERATOR_SKILLS_LIST_FRAMING = `SKILLS
A skill is a set of instructions the administrators of this workspace wrote for one kind of work. Each line below names a skill and says when it applies.
Call load_skill with the skill's name when the request fits it, at any step, then follow it.
Skills change how you work and write; they are not a source of facts and add no actions.

Available skills:`;

/** One line per skill: "- name: description". */
export function renderSkillList(skills: AssistantSkillSummary[]): string {
  return skills.map((skill) => "- " + skill.name + ": " + skill.description).join("\n");
}

/**
 * The load_skill tool result: a one-line header, then the skill's instructions
 * byte for byte. Used for a skill the model loads itself and for one loaded up
 * front, so both reach the conversation in the same shape.
 */
export function renderLoadedSkillResult(skill: { name: string; instructions: string }): string {
  return (
    "Skill " +
    skill.name +
    " is loaded. Follow it in everything you do and write from here on, including your reply:\n" +
    skill.instructions
  );
}

/**
 * @deprecated Since the skills rework, a skill's text reaches the model only as a load_skill
 * tool result (renderLoadedSkillResult); nothing in the library uses this framing any more.
 * Kept so the package's public exports stay compatible within the major version.
 */
export const OPERATOR_SKILLS_LOADED_FRAMING =
  "SKILLS TO FOLLOW\nThe blocks below are skills: instructions written by the administrators of this workspace about how to do this work.";

/**
 * @deprecated Use renderLoadedSkillResult. One delimited block per skill, the instructions
 * kept byte for byte. Kept so the package's public exports stay compatible within the major version.
 */
export function renderLoadedSkills(skills: Array<{ name: string; instructions: string }>): string {
  return skills.map((skill) => "--- skill: " + skill.name + " ---\n" + skill.instructions).join("\n\n");
}
