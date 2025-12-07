import { Type } from "class-transformer";
import { Equals, IsDefined, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, ValidateNested } from "class-validator";
import { companyMeta } from "../../company/entities/company.meta";
import { FeatureDataListDTO } from "../../feature/dtos/feature.dto";
import { ModuleDataListDTO } from "../../module/dtos/module.dto";

export class CompanyPutAttributesDTO {
  @IsDefined()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  logo?: string;

  @IsOptional()
  @IsNumber()
  availableTokens?: number;

  @IsOptional()
  @IsString()
  configurations?: string;
}

export class CompanyPutRelationshipsDTO {
  @ValidateNested({ each: true })
  @IsOptional()
  @Type(() => FeatureDataListDTO)
  features: FeatureDataListDTO;

  @ValidateNested({ each: true })
  @IsOptional()
  @Type(() => ModuleDataListDTO)
  modules: ModuleDataListDTO;
}

export class CompanyPutDataDTO {
  @Equals(companyMeta.endpoint)
  type: string;

  @IsUUID()
  id: string;

  @ValidateNested({ each: true })
  @IsNotEmpty()
  @Type(() => CompanyPutAttributesDTO)
  attributes: CompanyPutAttributesDTO;

  @ValidateNested({ each: true })
  @IsOptional()
  @Type(() => CompanyPutRelationshipsDTO)
  relationships: CompanyPutRelationshipsDTO;
}

export class CompanyPutDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => CompanyPutDataDTO)
  data: CompanyPutDataDTO;

  @IsOptional()
  included: any[];
}
