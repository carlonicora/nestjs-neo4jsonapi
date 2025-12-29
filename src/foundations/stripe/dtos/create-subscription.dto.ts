import { IsInt, IsNotEmpty, IsOptional, IsPositive, IsString, IsUUID, Max, Min } from "class-validator";

export class CreateSubscriptionDTO {
  @IsNotEmpty()
  @IsString()
  @IsUUID()
  priceId: string;

  @IsOptional()
  @IsString()
  paymentMethodId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  trialPeriodDays?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  quantity?: number;
}

export class UpdateSubscriptionDTO {
  @IsOptional()
  @IsString()
  @IsUUID()
  priceId?: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  quantity?: number;
}

export class CancelSubscriptionDTO {
  @IsOptional()
  cancelImmediately?: boolean;
}
