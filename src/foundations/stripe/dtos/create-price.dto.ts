import { Type } from "class-transformer";
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  ValidateNested,
} from "class-validator";

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

export class CreatePriceDTO {
  @IsNotEmpty()
  @IsString()
  productId: string;

  @IsNotEmpty()
  @IsInt()
  unitAmount: number;

  @IsNotEmpty()
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
}

export class UpdatePriceDTO {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  nickname?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, string>;
}
