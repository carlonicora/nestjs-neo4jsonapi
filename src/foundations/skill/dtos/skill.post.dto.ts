import { Type } from "class-transformer";
import {
  Equals,
  IsBoolean,
  IsDefined,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { skillMeta } from "../entities/skill.meta";
import { SkillDataDTO } from "./skill.dto";

/** 2 to 40 lowercase letters, digits or hyphens, starting with a letter (spec §5). */
export const SKILL_NAME_PATTERN = /^[a-z][a-z0-9-]{1,39}$/;

export class SkillPostAttributesDTO {
  @IsDefined()
  @IsString()
  @Matches(SKILL_NAME_PATTERN)
  name: string;

  @IsDefined()
  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  description: string;

  @IsDefined()
  @IsNotEmpty()
  @IsString()
  @MaxLength(20000)
  instructions: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SkillPostRelationshipsDTO {
  /** Present only to make a company copy of a global skill. */
  @IsOptional()
  @ValidateNested()
  @Type(() => SkillDataDTO)
  original?: SkillDataDTO;
}

export class SkillPostDataDTO {
  @Equals(skillMeta.endpoint)
  type: string;

  @IsUUID()
  id: string;

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => SkillPostAttributesDTO)
  attributes: SkillPostAttributesDTO;

  @IsOptional()
  @ValidateNested()
  @Type(() => SkillPostRelationshipsDTO)
  relationships?: SkillPostRelationshipsDTO;
}

export class SkillPostDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => SkillPostDataDTO)
  data: SkillPostDataDTO;
}
