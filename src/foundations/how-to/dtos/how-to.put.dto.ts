import { Type } from "class-transformer";
import { Equals, IsDefined, IsNotEmpty, IsOptional, IsString, IsUUID, ValidateNested } from "class-validator";
import { howToMeta } from "../entities/how-to.meta";

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
