import { Type } from "class-transformer";
import { Equals, IsDefined, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, ValidateNested } from "class-validator";
import { companyMeta } from "../../company/entities/company.meta";
import { FeatureDataListDTO } from "../../feature/dtos/feature.dto";
import { ModuleDataListDTO } from "../../module/dtos/module.dto";

export class CompanyPostAttributesDTO {
  @IsDefined()
  @IsString()
  name: string;

  @IsOptional()
  @IsNumber()
  monthlyTokens?: number;

  @IsOptional()
  @IsNumber()
  availableMonthlyTokens?: number;

  @IsOptional()
  @IsNumber()
  availableExtraTokens?: number;

  @IsOptional()
  @IsString()
  configurations?: string;

  @IsOptional()
  @IsString()
  legal_address?: string;

  @IsOptional()
  @IsString()
  street_number?: string;

  @IsOptional()
  @IsString()
  street?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  province?: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsString()
  postcode?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  country_code?: string;

  @IsOptional()
  @IsString()
  fiscal_data?: string;
}

export class CompanyPostRelationshipsDTO {
  @ValidateNested({ each: true })
  @IsOptional()
  @Type(() => FeatureDataListDTO)
  features: FeatureDataListDTO;

  @ValidateNested({ each: true })
  @IsOptional()
  @Type(() => ModuleDataListDTO)
  modules: ModuleDataListDTO;
}

export class CompanyPostDataDTO {
  @Equals(companyMeta.endpoint)
  type: string;

  @IsUUID()
  id: string;

  @ValidateNested({ each: true })
  @IsNotEmpty()
  @Type(() => CompanyPostAttributesDTO)
  attributes: CompanyPostAttributesDTO;

  @ValidateNested({ each: true })
  @IsOptional()
  @Type(() => CompanyPostRelationshipsDTO)
  relationships: CompanyPostRelationshipsDTO;
}

export class CompanyPostDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => CompanyPostDataDTO)
  data: CompanyPostDataDTO;

  @IsOptional()
  included: any[];
}
