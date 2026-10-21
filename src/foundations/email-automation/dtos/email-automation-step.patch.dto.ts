import { Type } from "class-transformer";
import {
  Equals,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from "class-validator";
import { emailAutomationStepMeta } from "../entities/email-automation-step.meta";

export class EmailAutomationStepPatchAttributesDTO {
  @IsOptional()
  @IsNotEmpty()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  delayHours?: number;

  @IsOptional()
  @IsNumber()
  positionX?: number;

  @IsOptional()
  @IsNumber()
  positionY?: number;
}

export class EmailAutomationStepPatchDataDTO {
  @Equals(emailAutomationStepMeta.endpoint)
  type: string;

  @IsUUID()
  id: string;

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => EmailAutomationStepPatchAttributesDTO)
  attributes: EmailAutomationStepPatchAttributesDTO;
}

export class EmailAutomationStepPatchDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => EmailAutomationStepPatchDataDTO)
  data: EmailAutomationStepPatchDataDTO;
}
