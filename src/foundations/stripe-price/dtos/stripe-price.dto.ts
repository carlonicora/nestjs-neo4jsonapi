import { Type } from "class-transformer";
import {
  Equals,
  IsDefined,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { stripePriceMeta } from "../entities/stripe-price.meta";

// Base DTO for reference with ID and type validation
export class StripePriceDTO {
  @Equals(stripePriceMeta.endpoint)
  type: string;

  @IsUUID()
  id: string;
}

// Recurring DTO (nested structure for attributes)
class RecurringDTO {
  @IsEnum(["day", "week", "month", "year"])
  interval: "day" | "week" | "month" | "year";

  @IsOptional()
  @IsInt()
  @IsPositive()
  intervalCount?: number;

  @IsOptional()
  @IsString()
  meter?: string;
}

// POST DTOs (for creating prices)
export class StripePricePostAttributesDTO {
  @IsDefined()
  @IsString()
  productId: string;

  @IsDefined()
  @IsInt()
  unitAmount: number;

  @IsDefined()
  @IsString()
  @MaxLength(3)
  currency: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  nickname?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  lookupKey?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => RecurringDTO)
  recurring?: RecurringDTO;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, string>;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  features?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  token?: number;
}

export class StripePricePostDataDTO {
  @Equals(stripePriceMeta.endpoint)
  type: string;

  @IsUUID()
  id: string;

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => StripePricePostAttributesDTO)
  attributes: StripePricePostAttributesDTO;
}

export class StripePricePostDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => StripePricePostDataDTO)
  data: StripePricePostDataDTO;

  @IsOptional()
  included?: any[];
}

// PUT DTOs (for updating prices)
export class StripePricePutAttributesDTO {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  nickname?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, string>;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  features?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  token?: number;
}

export class StripePricePutDataDTO {
  @Equals(stripePriceMeta.endpoint)
  type: string;

  @IsUUID()
  id: string;

  @ValidateNested()
  @IsOptional()
  @Type(() => StripePricePutAttributesDTO)
  attributes?: StripePricePutAttributesDTO;
}

export class StripePricePutDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => StripePricePutDataDTO)
  data: StripePricePutDataDTO;

  @IsOptional()
  included?: any[];
}
