import { IsOptional, IsString } from "class-validator";

export class CreateSetupIntentDTO {
  @IsOptional()
  @IsString()
  paymentMethodType?: string;
}
