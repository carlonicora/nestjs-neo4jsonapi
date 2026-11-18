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
import { SKILL_NAME_PATTERN } from "./skill.post.dto";

export class SkillPutAttributesDTO {
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

export class SkillPutDataDTO {
  @Equals(skillMeta.endpoint)
  type: string;

  @IsUUID()
  id: string;

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => SkillPutAttributesDTO)
  attributes: SkillPutAttributesDTO;
}

export class SkillPutDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => SkillPutDataDTO)
  data: SkillPutDataDTO;
}
