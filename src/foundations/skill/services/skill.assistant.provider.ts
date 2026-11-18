import { Injectable } from "@nestjs/common";
import {
  AssistantLoadedSkill,
  AssistantSkillProvider,
  AssistantSkillSummary,
} from "../../../common/interfaces/assistant.skill.interface";
import { SkillRepository } from "../repositories/skill.repository";

/**
 * The Assistant's view of the skills active for the company the request runs as
 * (active global skills only when there is no company). Bound to
 * ASSISTANT_SKILL_PROVIDER by SkillModule.
 */
@Injectable()
export class SkillAssistantProvider implements AssistantSkillProvider {
  constructor(private readonly skillRepository: SkillRepository) {}

  async listActive(): Promise<AssistantSkillSummary[]> {
    const skills = await this.skillRepository.findActiveForCompany();
    return skills.map((skill) => ({ name: skill.name, description: skill.description }));
  }

  async load(params: { names: string[] }): Promise<AssistantLoadedSkill[]> {
    if (params.names.length === 0) return [];
    const skills = await this.skillRepository.findActiveByNames({ names: params.names });
    return skills.map((skill) => ({ name: skill.name, instructions: skill.instructions }));
  }
}
