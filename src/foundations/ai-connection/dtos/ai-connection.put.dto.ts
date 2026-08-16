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
import { aiConnectionMeta } from "../entities/ai-connection.meta";

export class AiConnectionPutAttributesDTO {
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

/**
 * No relationships block on PUT: a connection's scope (global vs. one company)
 * is chosen at creation and is immutable (spec § Decisions "Scope mutability").
 * The descriptor marks the `company` relationship `immutable: true`, so the
 * generic PUT path skips it entirely.
 */
export class AiConnectionPutDataDTO {
  @Equals(aiConnectionMeta.endpoint)
  type: string;

  @IsUUID()
  id: string;

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => AiConnectionPutAttributesDTO)
  attributes: AiConnectionPutAttributesDTO;
}

export class AiConnectionPutDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => AiConnectionPutDataDTO)
  data: AiConnectionPutDataDTO;
}
