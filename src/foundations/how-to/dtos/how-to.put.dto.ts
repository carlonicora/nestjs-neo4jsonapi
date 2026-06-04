import { Type } from "class-transformer";
import {
  Equals,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from "class-validator";
import { howToMeta } from "../entities/how-to.meta";

const HOW_TO_TYPES = ["tutorial", "how-to", "reference", "explanation"] as const;

export class HowToPutAttributesDTO {
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsDefined()
  @IsNotEmpty()
  @IsString()
  description: string;

  @IsOptional()
  @IsString()
  pages?: string;

  @IsOptional()
  @IsIn(HOW_TO_TYPES)
  howToType?: string;

  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsInt()
  order?: number;

  @IsOptional()
  @IsString()
  summary?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  contextualKeys?: string[];

  @IsOptional()
  @IsBoolean()
  draft?: boolean;
}

export class HowToPutDataDTO {
  @Equals(howToMeta.endpoint)
  type: string;

  @IsUUID()
  id: string;

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => HowToPutAttributesDTO)
  attributes: HowToPutAttributesDTO;
}

export class HowToPutDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => HowToPutDataDTO)
  data: HowToPutDataDTO;
}
