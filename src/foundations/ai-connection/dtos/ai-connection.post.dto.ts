import { Type } from "class-transformer";
import {
  Equals,
  IsBoolean,
  IsDefined,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from "class-validator";
import { AI_CONNECTION_TYPES } from "../../../core/llm/interfaces/ai-candidate.interface";
import { CompanyDataDTO } from "../../company/dtos/company.dto";
import { aiConnectionMeta } from "../entities/ai-connection.meta";

export class AiConnectionPostAttributesDTO {
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsDefined()
  @IsIn([...AI_CONNECTION_TYPES])
  connectionType: string;

  @IsDefined()
  @IsNotEmpty()
  @IsString()
  provider: string;

  @IsDefined()
  @IsNumber()
  position: number;

  @IsDefined()
  @IsBoolean()
  enabled: boolean;

  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsString() url?: string;
  @IsOptional() @IsString() apiKey?: string;
  @IsOptional() @IsString() region?: string;
  @IsOptional() @IsString() instance?: string;
  @IsOptional() @IsString() apiVersion?: string;
  @IsOptional() @IsString() googleCredentialsBase64?: string;
  @IsOptional() @IsBoolean() allowFallbacks?: boolean;
  @IsOptional() @IsString() reasoningEffort?: string;
  @IsOptional() @IsNumber() maxOutputTokens?: number;
  @IsOptional() @IsNumber() dimensions?: number;
  @IsOptional() @IsNumber() inputCostPer1MTokens?: number;
  @IsOptional() @IsNumber() outputCostPer1MTokens?: number;
  @IsOptional() @IsNumber() cachedInputCostPer1MTokens?: number;
  @IsOptional() @IsNumber() costPerMinute?: number;
  @IsOptional() @IsNumber() costPerPage?: number;
  @IsOptional() @IsString() directUrl?: string;
  @IsOptional() @IsString() language?: string;
  @IsOptional() @IsString() directFormat?: string;
  @IsOptional() @IsString() directProvider?: string;
}

export class AiConnectionPostRelationshipsDTO {
  @ValidateNested()
  @IsOptional()
  @Type(() => CompanyDataDTO)
  company?: CompanyDataDTO;
}

export class AiConnectionPostDataDTO {
  @Equals(aiConnectionMeta.endpoint)
  type: string;

  @IsUUID()
  id: string;

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => AiConnectionPostAttributesDTO)
  attributes: AiConnectionPostAttributesDTO;

  @ValidateNested()
  @IsOptional()
  @Type(() => AiConnectionPostRelationshipsDTO)
  relationships?: AiConnectionPostRelationshipsDTO;
}

export class AiConnectionPostDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => AiConnectionPostDataDTO)
  data: AiConnectionPostDataDTO;
}
