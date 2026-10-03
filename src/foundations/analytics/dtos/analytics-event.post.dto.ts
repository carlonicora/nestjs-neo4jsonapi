import { Type } from "class-transformer";
import {
  Equals,
  IsDefined,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { analyticsEventMeta } from "../entities/analytics-event.meta";

export class AnalyticsEventPostAttributesDTO {
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  @MaxLength(2048)
  path: string;

  @IsDefined()
  @IsIn(["public", "app"])
  section: "public" | "app";

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  referrer?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  utmSource?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  utmMedium?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  utmCampaign?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  utmTerm?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  utmContent?: string;

  @IsOptional()
  @IsUUID()
  visitorId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  screenWidth?: number;
}

export class AnalyticsEventPostDataDTO {
  @Equals(analyticsEventMeta.type)
  type: string;

  @IsOptional()
  @IsUUID()
  id?: string;

  @ValidateNested()
  @IsDefined()
  @Type(() => AnalyticsEventPostAttributesDTO)
  attributes: AnalyticsEventPostAttributesDTO;
}

export class AnalyticsEventPostDTO {
  @ValidateNested()
  @IsDefined()
  @Type(() => AnalyticsEventPostDataDTO)
  data: AnalyticsEventPostDataDTO;
}
