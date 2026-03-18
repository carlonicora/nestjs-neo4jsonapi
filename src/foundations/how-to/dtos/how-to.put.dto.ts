import { Type } from "class-transformer";
import { Equals, IsDefined, IsNotEmpty, IsOptional, IsString, IsUUID, ValidateNested } from "class-validator";
import { howToMeta } from "src/features/essentials/how-to/entities/how-to.meta";

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
  @IsString()
  abstract?: string;

  @IsOptional()
  @IsString()
  tldr?: string;

  @IsOptional()
  @IsString()
  aiStatus?: string;
}

export class HowToPutRelationshipsDTO {
  // No relationships (excluding contextKey relationships)
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

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => HowToPutRelationshipsDTO)
  relationships: HowToPutRelationshipsDTO;
}

export class HowToPutDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => HowToPutDataDTO)
  data: HowToPutDataDTO;
}
