import { IsNotEmpty, IsNumber, IsOptional, IsString, IsDateString, Min } from "class-validator";

export class ReportUsageDTO {
  @IsNotEmpty()
  @IsString()
  meterId: string;

  @IsNotEmpty()
  @IsString()
  meterEventName: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  quantity: number;

  @IsOptional()
  @IsDateString()
  timestamp?: string;
}
