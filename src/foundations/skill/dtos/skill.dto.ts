import { Type } from "class-transformer";
import { Equals, IsNotEmpty, IsUUID, ValidateNested } from "class-validator";
import { skillMeta } from "../entities/skill.meta";

export class SkillDTO {
  @Equals(skillMeta.endpoint)
  type: string;

  @IsUUID()
  id: string;
}

export class SkillDataDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => SkillDTO)
  data: SkillDTO;
}
